import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { layoutKey, getSettings, collectTargets, emptyInfo, type Spacer, type Brk, type LayoutInfo } from './plugin'
import { pageDims, type PageSettings, type HF } from '../model/types'
import { fmtNum, esc } from '../util'

export interface PageBox {
  i: number; sec: number; top: number; left: number; w: number; h: number
  m: PageSettings['margin']; n: number; label: string; landscape: boolean
  fn: string[]; fnH: number; cTop: number; cBot: number; secStart: boolean
}

export interface Layout {
  pages: PageBox[]; flowW: number; flowH: number; idPage: Record<string, string>
  titles: string[]; continuous: boolean; gap: number
}

export interface DocMetaLite { title: string; subtitle: string; author: string; date: string }

type B = { kind: 'w'; pos: number } | { kind: 'i'; blockPos: number; resolve: () => number | null } | { kind: 'row'; pos: number } | { kind: 'toc'; id: string; index: number } | { kind: 'en'; index: number }

interface Unit {
  top: number; bottom: number; brk: B; sec: number
  keepNext?: boolean; force?: boolean; forceBefore?: boolean; fn?: string[]
  blk?: number; li?: number; ln?: number
}

export const FN_SEP = 10

export function paginate(view: EditorView, root: HTMLElement, opts: { scale: number; gap: number; mode: 'edit' | 'export'; meta: DocMetaLite }): Layout {
  let prev = ''
  let L: Layout | null = null
  for (let pass = 0; pass < 4; pass++) {
    L = onePass(view, root, opts)
    const key = JSON.stringify(L.idPage)
    if (key === prev) break
    prev = key
  }
  renderPages(root, L!, getSettings(view.state.doc), opts.meta, opts.mode)
  return L!
}

function onePass(view: EditorView, root: HTMLElement, opts: { scale: number; gap: number }): Layout {
  const doc = view.state.doc
  const s = getSettings(doc)
  const cont = s.layout === 'continuous'
  const gap = cont ? 0 : opts.gap
  const prevInfo = layoutKey.getState(view.state)?.info || emptyInfo()

  const secs: { node: PMNode; pos: number; land: boolean }[] = []
  doc.forEach((n, off) => secs.push({ node: n, pos: off, land: cont ? s.landscape : (n.attrs.landscape ?? s.landscape) }))
  const [pw] = pageDims(s, false)
  const [lw] = pageDims(s, true)
  const flowW = Math.max(...secs.map(x => (x.land ? lw : pw)))
  const m = s.margin
  const set = (k: string, v: number) => root.style.setProperty(k, v + 'px')
  const [bw] = pageDims(s)
  set('--cw', bw - m.left - m.right); set('--ml', (flowW - bw) / 2 + m.left)
  set('--cw-p', (cont ? bw : pw) - m.left - m.right); set('--ml-p', (flowW - (cont ? bw : pw)) / 2 + m.left)
  set('--cw-l', (cont ? bw : lw) - m.left - m.right); set('--ml-l', (flowW - (cont ? bw : lw)) / 2 + m.left)
  root.style.width = flowW + 'px'

  view.dispatch(view.state.tr.setMeta(layoutKey, { spacers: [], info: { ...prevInfo, tocBreaks: {}, endBreaks: [] } }).setMeta('addToHistory', false))

  const scale = opts.scale
  const rootTop = root.getBoundingClientRect().top
  const Y = (v: number) => (v - rootTop) / scale
  const R = (el: Element) => { const r = el.getBoundingClientRect(); return { top: Y(r.top), bottom: Y(r.bottom) } }

  const targets = collectTargets(doc, s)
  const fnSec = new Map<string, number>()
  const units: Unit[][] = secs.map(() => [])
  let blk = 0
  const range = document.createRange()

  const charTop = (t: Text, i: number) => {
    range.setStart(t, i); range.setEnd(t, i + 1)
    const r = range.getClientRects()
    return r.length ? Y(r[r.length - 1].top) : -1e9
  }

  const measureLines = (el: HTMLElement) => {
    const texts: Text[] = []
    const rects: { top: number; bottom: number }[] = []
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement?.closest('[data-abs]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    })
    for (let n = tw.nextNode() as Text | null; n; n = tw.nextNode() as Text | null) {
      if (!n.length) continue
      const ce = n.parentElement?.closest('[contenteditable=false]')
      if (!ce || ce === el || !el.contains(ce)) texts.push(n)
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.height > 0) rects.push({ top: Y(r.top), bottom: Y(r.bottom) })
    }
    rects.sort((a, b) => a.top - b.top)
    const lines: { top: number; bottom: number }[] = []
    for (const r of rects) {
      const c = lines[lines.length - 1]
      if (c && r.top < c.bottom - Math.min(r.bottom - r.top, c.bottom - c.top) * 0.5) { c.top = Math.min(c.top, r.top); c.bottom = Math.max(c.bottom, r.bottom) }
      else lines.push({ ...r })
    }
    return { lines, texts }
  }

  const lineStart = (texts: Text[], thresh: number): number | null => {
    for (const t of texts) {
      const n = t.length
      if (charTop(t, n - 1) < thresh) continue
      let lo = 0, hi = n - 1
      while (lo < hi) { const mid = (lo + hi) >> 1; if (charTop(t, mid) >= thresh) hi = mid; else lo = mid + 1 }
      let pos: number
      try { pos = view.posAtDOM(t, lo) } catch { return null }
      let $p = view.state.doc.resolve(pos)
      while ($p.nodeBefore && $p.nodeBefore.isInline && $p.nodeBefore.isAtom) {
        const dom = view.nodeDOM(pos - $p.nodeBefore.nodeSize) as HTMLElement | null
        if (dom && dom.getBoundingClientRect && Y(dom.getBoundingClientRect().top) >= thresh - 2) { pos -= $p.nodeBefore.nodeSize; $p = view.state.doc.resolve(pos) } else break
      }
      return pos
    }
    return null
  }

  const textblock = (n: PMNode, pos: number, sec: number, out: Unit[]) => {
    const el = view.nodeDOM(pos) as HTMLElement
    if (!el) return
    const rr = R(el)
    const { lines, texts } = measureLines(el)
    const b = blk++
    if (lines.length <= 1) {
      const u: Unit = { top: rr.top, bottom: rr.bottom, brk: { kind: 'w', pos }, sec, blk: b, li: 0, ln: 1 }
      out.push(u)
    } else {
      const cs = getComputedStyle(el)
      const cTop = rr.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop)
      const cBot = rr.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom)
      const bounds = [cTop]
      for (let k = 1; k < lines.length; k++) bounds.push((lines[k - 1].bottom + lines[k].top) / 2)
      bounds.push(Math.max(cBot, lines[lines.length - 1].bottom))
      for (let k = 0; k < lines.length; k++) {
        const th = bounds[k]
        out.push({
          top: k === 0 ? rr.top : bounds[k], bottom: k === lines.length - 1 ? Math.max(rr.bottom, bounds[k + 1]) : bounds[k + 1], sec, blk: b, li: k, ln: lines.length,
          brk: k === 0 ? { kind: 'w', pos } : { kind: 'i', blockPos: pos, resolve: () => lineStart(texts, th) }
        })
      }
    }
    const mine = out.slice(out.length - Math.max(1, lines.length))
    n.forEach((c, off) => {
      if (c.type.name !== 'footnote' || c.attrs.kind === 'end') return
      fnSec.set(c.attrs.id, sec)
      const d = view.nodeDOM(pos + 1 + off) as HTMLElement | null
      if (!d) return
      const t = R(d).top
      let u = mine[0]
      for (const x of mine) if (x.top <= t + 1) u = x
      ;(u.fn ||= []).push(c.attrs.id)
    })
    if (n.attrs.breakBefore) mine[0].forceBefore = true
    if (n.attrs.keepNext) out[out.length - 1].keepNext = true
    if (n.type.name === 'heading' || n.attrs.kind === 'title' || n.attrs.kind === 'subtitle' || (n.attrs.kind === 'caption' && n.attrs.label === 'table')) out[out.length - 1].keepNext = true
  }

  const block = (n: PMNode, pos: number, sec: number, out: Unit[], next: PMNode | null) => {
    const ty = n.type.name
    if (n.isTextblock) return textblock(n, pos, sec, out)
    const el = view.nodeDOM(pos) as HTMLElement | null
    if (!el) return
    if (ty === 'bulletList' || ty === 'orderedList') {
      n.forEach((li, lo) => { const lp = pos + 1 + lo; children(li, lp + 1, sec, out) })
      return
    }
    if (ty === 'blockquote' || ty === 'callout') {
      const start = out.length
      children(n, pos + 1, sec, out)
      if (out[start]) { out[start].brk = { kind: 'w', pos }; out[start].top = R(el).top }
      return
    }
    if (ty === 'table') {
      const start = out.length
      n.forEach((_row, ro) => {
        const rp = pos + 1 + ro
        const tr = view.nodeDOM(rp) as HTMLElement | null
        if (!tr) return
        const r = R(tr)
        out.push({ top: r.top, bottom: r.bottom, sec, brk: ro === 0 ? { kind: 'w', pos } : { kind: 'row', pos: rp } })
      })
      if (out[start]) out[start].top = R(el).top
      return
    }
    if (ty === 'toc') {
      const id = n.attrs.id
      const kids = Array.from(el.children).filter(c => !c.classList.contains('ca-sp'))
      kids.forEach((c, i) => {
        const r = R(c)
        out.push({ top: i === 0 ? R(el).top : r.top, bottom: r.bottom, sec, brk: i === 0 ? { kind: 'w', pos } : { kind: 'toc', id, index: i - 1 }, keepNext: i === 0 })
      })
      return
    }
    const r = R(el)
    if (ty === 'pageBreak') { out.push({ top: r.top, bottom: r.top, sec, brk: { kind: 'w', pos }, force: true }); return }
    const u: Unit = { top: r.top, bottom: r.bottom, sec, brk: { kind: 'w', pos } }
    if ((ty === 'image' || ty === 'chart') && next?.type.name === 'paragraph' && next.attrs.kind === 'caption') u.keepNext = true
    out.push(u)
  }

  const children = (n: PMNode, start: number, sec: number, out: Unit[]) => {
    const list: [PMNode, number][] = []
    n.forEach((c, off) => list.push([c, start + off]))
    list.forEach(([c, p], i) => block(c, p, sec, out, list[i + 1]?.[0] || null))
  }

  secs.forEach((x, i) => children(x.node, x.pos + 1, i, units[i]))

  const en = root.querySelector('.ca-endnotes')
  if (en) {
    const last = units[units.length - 1]
    Array.from(en.children).filter(c => !c.classList.contains('ca-sp')).forEach((c, i) => {
      const r = R(c)
      last.push({ top: i === 0 ? R(en).top : r.top, bottom: r.bottom, sec: secs.length - 1, brk: { kind: 'en', index: i - 1 }, keepNext: i === 0 })
    })
  }

  const fnH = new Map<string, number>()
  const meas = root.querySelector('.ca-measure') as HTMLElement
  meas.innerHTML = ''
  for (const [id, si] of fnSec) {
    const t = targets.get(id)
    const d = document.createElement('div')
    d.className = 'ca-fnb'
    d.style.width = `var(${secs[si].land && !cont ? '--cw-l' : '--cw-p'})`
    d.innerHTML = `<span class="ca-fnn">${esc(t?.num || '')}</span><span>${esc(t?.text || '')}</span>`
    meas.append(d)
    fnH.set(id, d.getBoundingClientRect().height / scale)
  }
  meas.innerHTML = ''

  const idY: [string, number][] = []
  root.querySelectorAll('.ProseMirror [id]').forEach(e => idY.push([e.id, R(e).top]))
  const h1Y: [string, number][] = []
  root.querySelectorAll('.ProseMirror h1').forEach(e => {
    const hn = e.querySelector('.ca-hn')?.textContent
    const tx = Array.from(e.childNodes).filter(c => !(c as Element).classList?.contains('ca-hn')).map(c => c.textContent).join('')
    h1Y.push([(hn ? hn + ' ' : '') + tx.trim(), R(e).top])
  })

  const pages: PageBox[] = []
  const spacers: Spacer[] = []
  const tocBreaks: Record<string, Brk[]> = {}
  const endBreaks: Brk[] = []
  const events: { y: number; h: number }[] = []
  let shift = 0, cum = 0, num = s.numberStart - 1
  const fa = (ids: string[]) => (ids.length ? FN_SEP + ids.reduce((a, id) => a + (fnH.get(id) || 0), 0) : 0)

  const newPage = (sec: number, land: boolean, secStart: boolean) => {
    const [w, h] = pageDims(s, land)
    const restart = secStart ? secs[sec].node.attrs.restart : null
    num = restart != null ? restart : num + 1
    const p: PageBox = { i: pages.length, sec, top: cum, left: (flowW - w) / 2, w, h, m, n: num, label: fmtNum(num, s.numberFormat), landscape: land, fn: [], fnH: 0, cTop: cum + m.top, cBot: cum + h - m.bottom, secStart }
    pages.push(p)
    cum += h + gap
    return p
  }

  const addSpacer = (u: Unit, h: number, pos?: number) => {
    const b = u.brk
    if (b.kind === 'w' || b.kind === 'row') spacers.push({ kind: b.kind, pos: b.pos, h })
    else if (b.kind === 'i') spacers.push({ kind: 'i', pos: pos!, h })
    else if (b.kind === 'toc') (tocBreaks[b.id] ||= []).push({ index: b.index, h })
    else endBreaks.push({ index: b.index, h })
    events.push({ y: u.top, h })
    shift += h
  }

  if (cont) {
    const p = newPage(0, s.landscape, true)
    p.h = 1e9
    let first = true
    let lastBot = p.cTop
    for (const list of units) for (const u of list) {
      if (first) { addSpacer(u, Math.max(0, p.cTop - u.top), undefined); first = false }
      if (u.fn) p.fn.push(...u.fn)
      lastBot = Math.max(lastBot, u.bottom + shift)
    }
    p.fnH = fa(p.fn)
    p.h = Math.ceil(lastBot + m.bottom + p.fnH + 4)
    p.cBot = p.h - m.bottom
    cum = p.h
  } else {
    units.forEach((list, si) => {
      let p = newPage(si, secs[si].land, true)
      let start = 0
      let force = false
      let i = 0
      if (!list.length) return
      const firstH = p.cTop - list[0].top - shift
      addSpacer(list[0], Math.max(0, firstH))
      if (list[0].fn) p.fn.push(...list[0].fn)
      force = !!list[0].force
      i = 1
      while (i < list.length) {
        const u = list[i]
        const bot = u.bottom + shift
        const add = (u.fn || []).filter(id => !p.fn.includes(id))
        const limit = p.cBot - fa([...p.fn, ...add])
        const hard = force || !!u.forceBefore
        if (hard || (bot > limit + 0.01 && i > start)) {
          let j = i
          if (!hard) {
            while (j - 1 > start && list[j - 1].keepNext) j--
            const uj = list[j]
            if (uj.li === 1 && (uj.ln || 0) >= 2 && j - 1 > start) j--
            else if (uj.ln && uj.li === uj.ln - 1 && uj.ln >= 3 && list[j - 1].li! >= 2 && j - 1 > start + 1) j--
          }
          let pos: number | undefined
          if (list[j].brk.kind === 'i') {
            const r = (list[j].brk as any).resolve()
            if (r == null) {
              while (j > start + 1 && list[j].brk.kind === 'i') j--
              if (list[j].brk.kind === 'i') { const bp = (list[j].brk as any).blockPos; list[j] = { ...list[j], brk: { kind: 'w', pos: bp } } }
            } else pos = r
          }
          for (let k = j; k < i; k++) for (const id of list[k].fn || []) p.fn = p.fn.filter(x => x !== id)
          p.fnH = fa(p.fn)
          p = newPage(si, secs[si].land, false)
          const uj = list[j]
          addSpacer(uj, Math.max(0, p.cTop - (uj.top + shift)), pos)
          if (uj.fn) p.fn.push(...uj.fn)
          force = !!uj.force
          start = j
          i = j + 1
          continue
        }
        if (u.fn) p.fn.push(...add)
        force = !!u.force
        i++
      }
      p.fnH = fa(p.fn)
    })
  }

  const shiftAt = (y: number) => { let t = 0; for (const e of events) if (e.y <= y + 0.5) t += e.h; return t }
  const pageAt = (y: number) => { let p = pages[0]; for (const q of pages) if (q.top <= y) p = q; return p }
  const idPage: Record<string, string> = {}
  for (const [id, y] of idY) { const p = pageAt(y + shiftAt(y)); if (p) idPage[id] = p.label }
  const titles: string[] = pages.map(() => '')
  const h1p = h1Y.map(([t, y]) => [t, pageAt(y + shiftAt(y))?.i ?? 0] as [string, number])
  let cur = ''
  for (const p of pages) {
    const on = h1p.find(x => x[1] === p.i)
    const before = h1p.filter(x => x[1] < p.i)
    if (before.length) cur = before[before.length - 1][0]
    titles[p.i] = on ? on[0] : cur
  }

  const info: LayoutInfo = { idPage, tocBreaks, endBreaks, pages: pages.length }
  view.dispatch(view.state.tr.setMeta(layoutKey, { spacers, info }).setMeta('addToHistory', false))
  const flowH = cont ? cum : Math.max(0, cum - gap)
  return { pages, flowW, flowH, idPage, titles, continuous: cont, gap }
}

function hfHTML(t: HF, page: PageBox, L: Layout, meta: DocMetaLite) {
  const sub = (x: string) => esc(x).replace(/\{(\w+)\}/g, (all, k) => {
    switch (k) {
      case 'page': return page.label
      case 'pages': return String(L.pages.length)
      case 'title': return esc(meta.title)
      case 'subtitle': return esc(meta.subtitle)
      case 'author': return esc(meta.author)
      case 'date': return esc(meta.date)
      case 'section': return esc(L.titles[page.i] || '')
      default: return all
    }
  })
  return `<span>${sub(t.left)}</span><span>${sub(t.center)}</span><span>${sub(t.right)}</span>`
}

export function renderPages(root: HTMLElement, L: Layout, s: PageSettings, meta: DocMetaLite, mode: 'edit' | 'export') {
  const under = root.querySelector('.ca-under') as HTMLElement
  const over = root.querySelector('.ca-over') as HTMLElement
  root.style.height = L.flowH + 'px'
  root.style.setProperty('--paper', s.background)
  let u = '', o = ''
  const targets = new Map<string, { num: string; text: string }>()
  if (L.pages.some(p => p.fn.length)) {
    root.querySelectorAll<HTMLElement>('.ProseMirror sup.ca-fn').forEach(e => targets.set(e.dataset.id!, { num: e.textContent || '', text: e.title }))
  }
  for (const p of L.pages) {
    const first = p.i === 0 && s.firstDifferent
    const even = !first && s.oddEven && p.n % 2 === 0
    const hd = first ? s.firstHeader : even ? s.evenHeader : s.header
    const ft = first ? s.firstFooter : even ? s.evenFooter : s.footer
    u += `<div class="ca-sheet" style="top:${p.top}px;left:${p.left}px;width:${p.w}px;height:${p.h}px;background:${s.background}"></div>`
    const hm = Math.min(p.m.top * 0.42, 28)
    const fm = Math.min(p.m.bottom * 0.42, 28)
    let inner = ''
    if (s.headerOn && (hd.left || hd.center || hd.right)) inner += `<div class="ca-hf ca-hd" style="margin-bottom:${hm}px">${hfHTML(hd, p, L, meta)}</div>`
    if (s.footerOn && (ft.left || ft.center || ft.right)) inner += `<div class="ca-hf ca-ft" style="margin-top:${fm}px">${hfHTML(ft, p, L, meta)}</div>`
    if (p.fn.length) {
      inner += `<div class="ca-fns" style="background:${s.background}"><div class="ca-fnsep"></div>` + p.fn.map(id => {
        const t = targets.get(id)
        return `<div class="ca-fnb" id="fn-${id}"><a class="ca-fnn" href="#fnr-${id}">${esc(t?.num || '')}</a><span>${esc(t?.text || '')}</span></div>`
      }).join('') + `</div>`
    }
    if (mode === 'edit' && p.secStart && p.sec > 0) inner += `<div class="ca-seclbl" style="top:${-p.m.top + 10}px;left:${-p.m.left + 12}px">Section ${p.sec + 1}${p.landscape ? ' · Landscape' : ''}</div>`
    o += `<div class="ca-frame" data-page="${p.i}" style="top:${p.top}px;left:${p.left}px;width:${p.w}px;height:${p.h}px;border-width:${p.m.top}px ${p.m.right}px ${p.m.bottom}px ${p.m.left}px;--gap:${L.gap / 2 + 1}px">${inner}</div>`
  }
  under.innerHTML = u
  over.innerHTML = o
}

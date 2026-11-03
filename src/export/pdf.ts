import { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFNull, PDFNumber, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, setCharacterSpacing, type PDFFont, type PDFPage, type PDFRef, type PDFImage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { DocView } from '../editor/docview'
import type { CADocument } from '../model/types'
import { FONT_METRICS, fontKey } from '../model/types'
import { fontBytes, fontFile } from '../layout/fonts'
import { assets } from '../editor/registry'
import type { PageBox } from '../layout/paginate'

type RGBA = { r: number; g: number; b: number; a: number }

function parseColor(c: string): RGBA | null {
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
  const a = p.length > 3 ? p[3] : 1
  if (a <= 0.001) return null
  return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a }
}

const BLOCKY = new Set(['block', 'flex', 'list-item', 'table-cell', 'table', 'grid', 'flow-root', 'table-row'])

interface Item { y0: number; y1: number; draw: (pg: PDFPage, ox: number, oy: number, ph: number) => void }

export interface PDFProgress { (p: number, msg: string): void }

export async function buildPDF(dv: DocView, doc: CADocument, progress: PDFProgress = () => {}): Promise<Uint8Array> {
  const L = dv.layout!
  const root = dv.root
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const fonts = new Map<string, Promise<PDFFont>>()
  const getFont = (file: string) => {
    let f = fonts.get(file)
    if (!f) {
      f = fontBytes(file).then(b => pdf.embedFont(b, { subset: !file.startsWith('inter'), features: { liga: false, kern: false, calt: false } as any }))
        .catch(() => pdf.embedFont(StandardFonts.Helvetica))
      fonts.set(file, f)
    }
    return f
  }
  const images = new Map<string, Promise<PDFImage | null>>()
  const getImage = (img: HTMLImageElement) => {
    const id = img.dataset.asset || img.src
    let p = images.get(id)
    if (!p) { p = embedImage(pdf, img); images.set(id, p) }
    return p
  }

  const rr = root.getBoundingClientRect()
  const sc = rr.width / root.offsetWidth || 1
  const X = (v: number) => (v - rr.left) / sc
  const Y = (v: number) => (v - rr.top) / sc

  const pages = L.pages
  const content: Item[][] = pages.map(() => [])
  const over: Item[][] = pages.map(() => [])
  const anchors = new Map<string, { page: number; y: number }>()
  const links: { page: number; x0: number; y0: number; x1: number; y1: number; href: string }[] = []
  const pending: Promise<any>[] = []

  const pageOfY = (y: number) => {
    let lo = 0, hi = pages.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pages[mid].top <= y) lo = mid; else hi = mid - 1 }
    return lo
  }
  const contentBottom = (p: PageBox) => p.top + p.h - p.m.bottom

  const place = (target: 'c' | number, it: Item) => {
    if (target === 'c') {
      const a = pageOfY(it.y0), b = pageOfY(Math.max(it.y0, it.y1 - 0.01))
      for (let i = a; i <= b; i++) {
        const p = pages[i]
        if (it.y1 > p.cTop - 0.5 && it.y0 < contentBottom(p) + 0.5) content[i].push(it)
      }
    } else over[target].push(it)
  }

  const fill = (c: RGBA) => ({ color: rgb(c.r, c.g, c.b), opacity: c.a })
  const rectItem = (x: number, y: number, w: number, hh: number, c: RGBA): Item => ({
    y0: y, y1: y + hh,
    draw: (pg, ox, oy, ph) => pg.drawRectangle({ x: x - ox, y: ph - (y + hh - oy), width: w, height: hh, ...fill(c) })
  })

  const range = document.createRange()
  const gridColor = parseColor(toRgb(getComputedStyle(root).getPropertyValue('--grid').trim() || '#c9ced6'))

  const walk = (el: Element, target: 'c' | number) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { text(n as Text, target); continue }
      if (n.nodeType !== 1) continue
      const e = n as HTMLElement
      if (e.classList.contains('ca-under') || e.classList.contains('ca-measure') || e.classList.contains('ProseMirror-gapcursor') || e.classList.contains('ProseMirror-separator')) continue
      const s = getComputedStyle(e)
      if (s.display === 'none' || s.visibility === 'hidden') continue
      let tg = target
      if (e.classList.contains('ca-frame')) {
        tg = +e.dataset.page!
        walk(e, tg)
        continue
      }
      box(e, s, tg)
      if (e.id) {
        const r = e.getBoundingClientRect()
        const y = Y(r.top)
        anchors.set(e.id, { page: typeof tg === 'number' ? tg : pageOfY(y), y })
      }
      if (e.tagName === 'A') {
        const href = e.getAttribute('href') || ''
        if (href && href !== '#') for (const r of Array.from(e.getClientRects())) {
          if (r.width < 0.5) continue
          const y0 = Y(r.top), y1 = Y(r.bottom)
          links.push({ page: typeof tg === 'number' ? tg : pageOfY((y0 + y1) / 2), x0: X(r.left), x1: X(r.right), y0, y1, href })
        }
      }
      if (e.tagName === 'IMG') { image(e as HTMLImageElement, tg); continue }
      walk(e, tg)
    }
  }

  const box = (e: HTMLElement, s: CSSStyleDeclaration, tg: 'c' | number) => {
    const isCell = e.tagName === 'TD' || e.tagName === 'TH'
    const bg = parseColor(s.backgroundColor)
    const inline = s.display === 'inline'
    if (bg) {
      if (inline) for (const r of Array.from(e.getClientRects())) place(tg, rectItem(X(r.left), Y(r.top), r.width / sc, r.height / sc, bg))
      else {
        const r = e.getBoundingClientRect()
        let x = X(r.left), y = Y(r.top), w = r.width / sc, hh = r.height / sc
        if (s.backgroundClip === 'padding-box') {
          const bt = parseFloat(s.borderTopWidth), bl = parseFloat(s.borderLeftWidth)
          x += bl; y += bt; w -= bl + parseFloat(s.borderRightWidth); hh -= bt + parseFloat(s.borderBottomWidth)
        }
        if (w > 0 && hh > 0) place(tg, rectItem(x, y, w, hh, bg))
      }
    }
    if (isCell) {
      const gc = gridColor
      if (gc) {
        const r = e.getBoundingClientRect()
        const bt = parseFloat(s.borderTopWidth)
        const x = X(r.left), y = Y(r.top) + bt, w = r.width / sc, hh = r.height / sc - bt
        const lw = 0.75
        place(tg, rectItem(x, y, w, lw, gc))
        place(tg, rectItem(x, y + hh - lw, w, lw, gc))
        place(tg, rectItem(x, y, lw, hh, gc))
        place(tg, rectItem(x + w - lw, y, lw, hh, gc))
      }
      return
    }
    if (inline) return
    const sides: ['Top' | 'Right' | 'Bottom' | 'Left', number][] = [['Top', 0], ['Right', 1], ['Bottom', 2], ['Left', 3]]
    let r: DOMRect | null = null
    for (const [side] of sides) {
      const w = parseFloat((s as any)['border' + side + 'Width'])
      const st = (s as any)['border' + side + 'Style']
      if (!w || st === 'none' || st === 'hidden') continue
      const c = parseColor((s as any)['border' + side + 'Color'])
      if (!c) continue
      r ||= e.getBoundingClientRect()
      const x = X(r.left), y = Y(r.top), W = r.width / sc, H = r.height / sc
      if (st === 'dotted' || st === 'dashed') {
        const y0 = side === 'Bottom' ? y + H - w / 2 : side === 'Top' ? y + w / 2 : y
        const dash = st === 'dotted' ? [w, w * 2] : [w * 3, w * 2]
        if (side === 'Top' || side === 'Bottom') place(tg, { y0: y0 - w, y1: y0 + w, draw: (pg, ox, oy, ph) => pg.drawLine({ start: { x: x - ox, y: ph - (y0 - oy) }, end: { x: x + W - ox, y: ph - (y0 - oy) }, thickness: w, dashArray: dash, ...fill(c) }) })
        continue
      }
      if (side === 'Top') place(tg, rectItem(x, y, W, w, c))
      if (side === 'Bottom') place(tg, rectItem(x, y + H - w, W, w, c))
      if (side === 'Left') place(tg, rectItem(x, y, w, H, c))
      if (side === 'Right') place(tg, rectItem(x + W - w, y, w, H, c))
    }
  }

  const image = (img: HTMLImageElement, tg: 'c' | number) => {
    const boxEl = img.parentElement!
    const br = boxEl.getBoundingClientRect()
    const bx = X(br.left), by = Y(br.top), bw = br.width / sc, bh = br.height / sc
    if (bw < 1 || bh < 1) return
    const nw = img.naturalWidth || bw, nh = img.naturalHeight || bh
    const k = Math.max(bw / nw, bh / nh)
    const dw = nw * k, dh = nh * k
    const dx = bx + (bw - dw) / 2, dy = by + (bh - dh) / 2
    const pr = getImage(img)
    pending.push(pr)
    place(tg, {
      y0: by, y1: by + bh,
      draw: (pg, ox, oy, ph) => {
        const im = (pr as any).value as PDFImage | null
        if (!im) return
        pg.pushOperators(pushGraphicsState(), rectangle(bx - ox, ph - (by + bh - oy), bw, bh), clip(), endPath())
        pg.drawImage(im, { x: dx - ox, y: ph - (dy + dh - oy), width: dw, height: dh })
        pg.pushOperators(popGraphicsState())
      }
    })
  }

  const decoCache = new WeakMap<Element, { u: boolean; s: boolean; c: RGBA | null; th: number; off: number }>()
  const decoOf = (p: Element) => {
    let r = decoCache.get(p)
    if (r) return r
    let u = false, st = false, c: RGBA | null = null, th = 0, off = 0
    for (let e: Element | null = p; e && e !== root; e = e.parentElement) {
      const s = getComputedStyle(e)
      const l = s.textDecorationLine
      if (l.includes('underline') && !u) { u = true; c ||= parseColor(s.textDecorationColor); th = parseFloat(s.textDecorationThickness) || 0; off = parseFloat(s.textUnderlineOffset) || 0 }
      if (l.includes('line-through') && !st) { st = true; c ||= parseColor(s.textDecorationColor) }
      if (BLOCKY.has(s.display)) break
    }
    r = { u, s: st, c, th, off }
    decoCache.set(p, r)
    return r
  }

  const text = (t: Text, tg: 'c' | number) => {
    const data = t.data
    if (!data.trim()) return
    const p = t.parentElement!
    const ps = getComputedStyle(p)
    const key = fontKey(ps.fontFamily)
    const weight = parseInt(ps.fontWeight) || 400
    const italic = ps.fontStyle === 'italic' || ps.fontStyle.startsWith('oblique')
    const file = fontFile(key, weight, italic)
    const fp = getFont(file)
    pending.push(fp)
    const size = parseFloat(ps.fontSize)
    const col = parseColor(ps.color) || { r: 0, g: 0, b: 0, a: 1 }
    const asc = FONT_METRICS[key].asc * size
    const ls = ps.letterSpacing === 'normal' ? 0 : parseFloat(ps.letterSpacing) || 0
    const tt = ps.textTransform
    const tf = (x: string) => (tt === 'uppercase' ? x.toUpperCase() : tt === 'lowercase' ? x.toLowerCase() : tt === 'capitalize' ? x.replace(/\b\p{L}/gu, m => m.toUpperCase()) : x)
    let blk: Element | null = p
    while (blk && !BLOCKY.has(getComputedStyle(blk).display)) blk = blk.parentElement
    const justify = blk ? getComputedStyle(blk).textAlign === 'justify' : false

    const runs: { x: number; top: number; bottom: number; str: string }[] = []
    const re = /\S+/g
    let m: RegExpExecArray | null
    let cur: { x: number; top: number; bottom: number; str: string; end: number; right: number } | null = null
    while ((m = re.exec(data))) {
      range.setStart(t, m.index); range.setEnd(t, m.index + m[0].length)
      const rs = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0)
      if (!rs.length) continue
      if (rs.length === 1) {
        const r = rs[0]
        const x = X(r.left), top = Y(r.top), bottom = Y(r.bottom)
        if (!justify && cur && Math.abs(cur.top - top) < 0.5 && x >= cur.right - 0.5) {
          cur.str += data.slice(cur.end, m.index) + m[0]
          cur.end = m.index + m[0].length
          cur.right = X(r.right)
        } else {
          if (cur) runs.push(cur)
          cur = { x, top, bottom, str: m[0], end: m.index + m[0].length, right: X(r.right) }
        }
      } else {
        if (cur) { runs.push(cur); cur = null }
        for (let i = 0; i < m[0].length; i++) {
          range.setStart(t, m.index + i); range.setEnd(t, m.index + i + 1)
          const r = range.getClientRects()[0]
          if (r) runs.push({ x: X(r.left), top: Y(r.top), bottom: Y(r.bottom), str: m[0][i] })
        }
      }
    }
    if (cur) runs.push(cur)
    for (const r of runs) {
      const str = tf(r.str)
      const base = r.top + asc
      place(tg, {
        y0: r.top, y1: r.bottom,
        draw: (pg, ox, oy, ph) => {
          const font = (fp as any).value as PDFFont
          if (!font) return
          if (ls) pg.pushOperators(setCharacterSpacing(ls))
          pg.drawText(safeText(font, str), { x: r.x - ox, y: ph - (base - oy), size, font, ...fill(col) })
          if (ls) pg.pushOperators(setCharacterSpacing(0))
        }
      })
    }
    const d = decoOf(p)
    if (d.u || d.s) {
      range.selectNodeContents(t)
      const dc = d.c || col
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 0.5) continue
        const x = X(r.left), w = r.width / sc, top = Y(r.top), base = top + asc
        if (d.u) {
          const th = d.th || Math.max(0.5, size * 0.07)
          const y = base + (d.off || size * 0.12)
          place(tg, rectItem(x, y, w, th, dc))
        }
        if (d.s) place(tg, rectItem(x, base - size * 0.3, w, Math.max(0.5, size * 0.065), dc))
      }
    }
  }

  progress(0.05, 'Laying out pages…')
  walk(root, 'c')
  progress(0.4, 'Embedding fonts and images…')
  await Promise.all(pending.map(p => p.then((v: any) => { (p as any).value = v }, () => { (p as any).value = null })))

  progress(0.55, 'Drawing pages…')
  const pdfPages: PDFPage[] = []
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const pg = pdf.addPage([p.w, p.h])
    pdfPages.push(pg)
    const bg = parseColor(toRgb(getComputedStyle(root).getPropertyValue('--paper').trim() || '#ffffff'))
    if (bg && !(bg.r === 1 && bg.g === 1 && bg.b === 1)) pg.drawRectangle({ x: 0, y: 0, width: p.w, height: p.h, ...fill(bg) })
    const ox = p.left, oy = p.top
    const cy = p.cTop, cb = contentBottom(p)
    pg.pushOperators(pushGraphicsState(), rectangle(p.m.left, p.h - (cb - oy), p.w - p.m.left - p.m.right, cb - cy), clip(), endPath())
    for (const it of content[i]) it.draw(pg, ox, oy, p.h)
    pg.pushOperators(popGraphicsState())
    for (const it of over[i]) it.draw(pg, ox, oy, p.h)
    if (i % 10 === 0) { progress(0.55 + 0.35 * (i / pages.length), `Drawing page ${i + 1} of ${pages.length}…`); await new Promise(r => setTimeout(r)) }
  }

  const ctx = pdf.context
  const dest = (page: number, y: number) => {
    const p = pages[page]
    return ctx.obj([pdfPages[page].ref, PDFName.of('XYZ'), PDFNull, PDFNumber.of(Math.round(p.h - (y - p.top) + 6)), PDFNull])
  }
  for (const l of links) {
    const p = pages[l.page]
    const pg = pdfPages[l.page]
    if (!p || !pg) continue
    const rect = [l.x0 - p.left, p.h - (l.y1 - p.top), l.x1 - p.left, p.h - (l.y0 - p.top)]
    let action: any = null
    if (l.href.startsWith('#page=')) {
      const n = l.href.slice(6)
      const idx = pages.findIndex(q => q.label === n)
      const pi = idx >= 0 ? idx : Math.min(pages.length - 1, Math.max(0, (parseInt(n) || 1) - 1))
      action = { Dest: dest(pi, pages[pi].top) }
    } else if (l.href.startsWith('#')) {
      const a = anchors.get(decodeURIComponent(l.href.slice(1)))
      if (!a) continue
      action = { Dest: dest(a.page, a.y) }
    } else {
      action = { A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(l.href) }) }
    }
    const annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...action })
    pg.node.addAnnot(ctx.register(annot))
  }

  const heads: { title: string; level: number; page: number; y: number }[] = []
  root.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4').forEach(e => {
    const a = e.id ? anchors.get(e.id) : null
    const y = a ? a.y : Y(e.getBoundingClientRect().top)
    const hn = e.querySelector('.ca-hn')?.textContent
    const tx = Array.from(e.childNodes).filter(c => !(c as Element).classList?.contains('ca-hn')).map(c => c.textContent).join('').trim()
    heads.push({ title: (hn ? hn + ' ' : '') + (tx || 'Untitled'), level: +e.tagName[1], page: a ? a.page : pageOfY(y), y })
  })
  if (heads.length) addOutline(pdf, heads, dest)

  const m = doc.meta
  pdf.setTitle(m.title || 'Untitled', { showInWindowTitleBar: true })
  if (m.author) pdf.setAuthor(m.author)
  if (m.subject || m.subtitle) pdf.setSubject(m.subject || m.subtitle)
  if (m.keywords) pdf.setKeywords(m.keywords.split(',').map(k => k.trim()).filter(Boolean))
  pdf.setCreator('CocoaAuthor')
  pdf.setProducer('CocoaAuthor')
  pdf.setLanguage(navigator.language || 'en')
  pdf.setCreationDate(new Date(m.created))
  pdf.setModificationDate(new Date())
  progress(0.95, 'Saving…')
  return pdf.save()
}

function toRgb(hex: string): string {
  if (hex.startsWith('rgb')) return hex
  const m = hex.replace('#', '')
  const f = m.length === 3 ? m.split('').map(c => c + c).join('') : m
  const n = parseInt(f.slice(0, 6), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

function safeText(font: PDFFont, s: string) {
  try { font.encodeText(s); return s } catch { return s.replace(/[^\x20-\x7E -ɏ‐-‧‰-⁞]/g, '?') }
}

async function embedImage(pdf: PDFDocument, img: HTMLImageElement): Promise<PDFImage | null> {
  const id = img.dataset.asset
  let blob = id ? assets.blob(id) : null
  if (!blob) {
    try { blob = await (await fetch(img.src)).blob() } catch { return null }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8
  try {
    if (isJpg) return await pdf.embedJpg(bytes)
    if (isPng) return await pdf.embedPng(bytes)
  } catch {}
  const w = Math.min(4096, img.naturalWidth || 1200), hh = Math.round(w * ((img.naturalHeight || 900) / (img.naturalWidth || 1200)))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = Math.min(4096, hh)
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
  const png = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'))
  return png ? pdf.embedPng(new Uint8Array(await png.arrayBuffer())) : null
}

function addOutline(pdf: PDFDocument, heads: { title: string; level: number; page: number; y: number }[], dest: (p: number, y: number) => any) {
  const ctx = pdf.context
  type N = { h: typeof heads[0] | null; kids: N[]; ref: PDFRef; parent?: N }
  const root: N = { h: null, kids: [], ref: ctx.nextRef() }
  const stack: N[] = [root]
  for (const hd of heads) {
    while (stack.length > 1 && stack[stack.length - 1].h!.level >= hd.level) stack.pop()
    const n: N = { h: hd, kids: [], ref: ctx.nextRef(), parent: stack[stack.length - 1] }
    n.parent!.kids.push(n)
    stack.push(n)
  }
  const countOf = (n: N): number => n.kids.reduce((a, k) => a + 1 + countOf(k), 0)
  const emit = (n: N) => {
    n.kids.forEach((k, i) => {
      const d: Record<string, any> = {
        Title: PDFHexString.fromText(k.h!.title),
        Parent: n.ref,
        Dest: dest(k.h!.page, k.h!.y)
      }
      if (i > 0) d.Prev = n.kids[i - 1].ref
      if (i < n.kids.length - 1) d.Next = n.kids[i + 1].ref
      if (k.kids.length) { d.First = k.kids[0].ref; d.Last = k.kids[k.kids.length - 1].ref; d.Count = PDFNumber.of(k.h!.level >= 2 ? -countOf(k) : countOf(k)) }
      ctx.assign(k.ref, ctx.obj(d))
      emit(k)
    })
  }
  emit(root)
  ctx.assign(root.ref, ctx.obj({ Type: 'Outlines', First: root.kids[0].ref, Last: root.kids[root.kids.length - 1].ref, Count: PDFNumber.of(countOf(root)) }))
  pdf.catalog.set(PDFName.of('Outlines'), root.ref)
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

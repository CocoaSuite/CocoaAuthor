// Images and text boxes placed freely on pages, and the text wrap around them.
import { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { boxExtensions } from '../editor/extensions'
import { assets } from '../editor/registry'
import { placeImage } from '../editor/imagegeom'
import type { FrameData } from '../model/types'
import type { Layout, PageBox } from './paginate'
import { uid } from '../util'

// ---------------------------------------------------------------------------------------------
// Text wrap: a float of the frame's width is placed at the line where the frame starts, in each
// paragraph the frame overlaps, so text flows beside it across paragraph boundaries.

export interface Wrap { key: string; pos: number; side: 'left' | 'right'; w: number; h: number }
export const wrapKey = new PluginKey<{ wraps: Wrap[]; deco: DecorationSet }>('caWrap')

function buildWraps(doc: any, wraps: Wrap[]) {
  const d = wraps.filter(w => w.pos >= 0 && w.pos <= doc.content.size).map(w => Decoration.widget(w.pos, () => {
    const s = document.createElement('span')
    s.className = 'ca-wrapx'
    s.dataset.abs = ''
    s.contentEditable = 'false'
    s.style.cssText = `float:${w.side};width:${w.w}px;height:${w.h}px`
    return s
  }, { side: -1, key: `wr-${w.side}-${Math.round(w.w * 10)}-${Math.round(w.h * 10)}`, ignoreSelection: true, marks: [] }))
  return DecorationSet.create(doc, d)
}

export function wrapPlugin() {
  return new Plugin({
    key: wrapKey,
    state: {
      init: () => ({ wraps: [] as Wrap[], deco: DecorationSet.empty }),
      apply(tr, v, _o, ns) {
        const m = tr.getMeta(wrapKey) as Wrap[] | undefined
        if (m) return { wraps: m, deco: buildWraps(ns.doc, m) }
        if (!tr.docChanged) return v
        const wraps = v.wraps.map(w => ({ ...w, pos: tr.mapping.map(w.pos, -1) }))
        return { wraps, deco: v.deco.map(tr.mapping, tr.doc) }
      }
    },
    props: { decorations: st => wrapKey.getState(st)?.deco }
  })
}

export const framesOf = (doc: any): FrameData[] => (Array.isArray(doc.attrs.frames) ? doc.attrs.frames : [])

export function sameWraps(a: Wrap[], b: Wrap[]) {
  if (a.length !== b.length) return false
  return a.every((w, i) => { const o = b[i]; return o.key === w.key && o.pos === w.pos && o.side === w.side && Math.abs(o.w - w.w) < 0.5 && Math.abs(o.h - w.h) < 0.5 })
}

/**
 * Lay out the text wrap for the current pages and apply it. Paragraphs are handled top to bottom:
 * each gets floats as tall as the frames it meets, then the floats are cut back to where its text
 * ends (cutting back never moves its lines), and the next paragraph is measured in the new layout.
 */
export function applyWraps(view: EditorView, root: HTMLElement, scale: number, layout: Layout): Wrap[] {
  const frames = framesOf(view.state.doc).filter(f => f.wrap === 'around' && layout.pages[f.page])
  const set = (w: Wrap[]) => view.dispatch(view.state.tr.setMeta(wrapKey, w).setMeta('addToHistory', false))
  const prev = wrapKey.getState(view.state)?.wraps || []
  if (!frames.length) { if (prev.length) set([]); return [] }
  set([])
  const rr = () => root.getBoundingClientRect()
  const range = document.createRange()
  const rects = frames.map(f => {
    const p: PageBox = layout.pages[f.page]
    const g = f.gap ?? 8
    return { id: f.id, L: p.left + f.x - g, R: p.left + f.x + f.w + g, T: p.top + f.y - g, B: p.top + f.y + f.h + g }
  })
  const minT = Math.min(...rects.map(r => r.T)), maxB = Math.max(...rects.map(r => r.B))

  const blockPos: number[] = []
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'table') return false
    if (n.isTextblock) { blockPos.push(pos); return false }
    return true
  })

  const textsOf = (el: HTMLElement) => {
    const out: Text[] = []
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const pe = n.parentElement
        if (!pe || pe.closest('[data-abs]')) return NodeFilter.FILTER_REJECT
        const ce = pe.closest('[contenteditable=false]')
        return ce && el.contains(ce) && ce !== el ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      }
    })
    for (let n = tw.nextNode() as Text | null; n; n = tw.nextNode() as Text | null) if (n.length) out.push(n)
    return out
  }

  const all: Wrap[] = []
  // Block positions do not change: wraps are decorations, not document edits.
  for (const bpos of blockPos) {
    const el = view.nodeDOM(bpos) as HTMLElement | null
    if (!el?.getBoundingClientRect) continue
    const R0 = rr()
    const Y = (v: number) => (v - R0.top) / scale, X = (v: number) => (v - R0.left) / scale
    const r = el.getBoundingClientRect()
    const top = Y(r.top), bottom = Y(r.bottom)
    if (bottom <= minT) continue
    if (top >= maxB) break
    const cs = getComputedStyle(el)
    const left = X(r.left) + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)
    const right = X(r.right) - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
    const width = right - left
    const texts = textsOf(el)
    if (!texts.length || width < 20) continue
    const charBox = (t: Text, i: number) => {
      range.setStart(t, i); range.setEnd(t, i + 1)
      const rs = range.getClientRects()
      const q = rs[rs.length - 1]
      return q ? { top: Y(q.top), bottom: Y(q.bottom) } : { top: -1e9, bottom: -1e9 }
    }
    const lineAt = (y: number): { pos: number; top: number } | null => {
      for (const t of texts) {
        const n = t.length
        if (charBox(t, n - 1).bottom <= y) continue
        let lo = 0, hi = n - 1
        while (lo < hi) { const mid = (lo + hi) >> 1; if (charBox(t, mid).bottom > y) hi = mid; else lo = mid + 1 }
        const tp = charBox(t, lo).top
        let a = 0, b = lo
        while (a < b) { const mid = (a + b) >> 1; if (charBox(t, mid).top >= tp - 1) b = mid; else a = mid + 1 }
        try { return { pos: view.posAtDOM(t, a), top: tp } } catch { return null }
      }
      return null
    }
    const mine: (Wrap & { full: number; top: number })[] = []
    for (const f of rects) {
      if (bottom <= f.T || top >= f.B || f.R <= left || f.L >= right) continue
      const at = lineAt(f.T + 0.5)
      if (!at) continue
      const lineTop = Math.max(at.top, top)
      const ls = f.L - left, rs = right - f.R
      let side: 'left' | 'right', w: number
      if (Math.max(ls, rs) < 40) { side = 'left'; w = width }
      else if (rs >= ls) { side = 'left'; w = Math.min(width, f.R - left) }
      else { side = 'right'; w = Math.min(width, right - f.L) }
      const full = f.B - lineTop
      if (w > 0.5 && full > 1) mine.push({ key: f.id + '@' + bpos, pos: at.pos, side, w, h: full, full, top: lineTop })
    }
    if (!mine.length) continue
    // Too little room left between frames on both sides: clear them all.
    const used = Math.max(0, ...mine.filter(w => w.side === 'left').map(w => w.w)) + Math.max(0, ...mine.filter(w => w.side === 'right').map(w => w.w))
    let list = mine
    if (mine.length > 1 && width - used < 40) {
      const t0 = mine.reduce((a, b) => (b.top < a.top ? b : a))
      const full = Math.max(...mine.map(w => w.top + w.full)) - t0.top
      list = [{ key: t0.key, pos: Math.min(...mine.map(w => w.pos)), side: 'left', w: width, h: full, full, top: t0.top }]
    }
    // Full height first, then cut back to the end of this paragraph's text.
    set([...all, ...list])
    const R1 = rr()
    let last = -1e9
    // The update re-rendered the paragraph, so its text nodes are new.
    const el2 = (view.nodeDOM(bpos) as HTMLElement | null) || el
    for (const t of textsOf(el2)) { range.selectNodeContents(t); for (const q of range.getClientRects()) if (q.height > 0) last = Math.max(last, (q.bottom - R1.top) / scale) }
    for (const w of list) {
      const h = Math.min(w.full, last - w.top)
      if (h > 1) all.push({ key: w.key, pos: w.pos, side: w.side, w: w.w, h })
    }
    set(all)
  }
  return all
}

// ---------------------------------------------------------------------------------------------
// The layer that draws frames over the pages and lets you move and resize them.

interface Item { el: HTMLElement; box: HTMLElement; img?: HTMLImageElement; ed?: Editor; key: string }

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export class FrameLayer {
  el: HTMLElement
  selected: string | null = null
  private items = new Map<string, Item>()
  private layout: Layout | null = null
  private saveT: any = 0

  constructor(private view: () => EditorView, private root: HTMLElement, private mode: 'edit' | 'export', private scale: () => number) {
    this.el = document.createElement('div')
    this.el.className = 'ca-objs'
    root.append(this.el)
    if (mode === 'edit') {
      this.el.addEventListener('pointerdown', this.down)
      this.el.addEventListener('dblclick', e => {
        const it = (e.target as HTMLElement).closest('.ca-obj') as HTMLElement | null
        if (it?.classList.contains('k-img')) this.root.dispatchEvent(new CustomEvent('ca-frame-crop', { detail: it.dataset.id }))
      })
      document.addEventListener('keydown', this.key)
      document.addEventListener('pointerdown', this.outside, true)
    }
  }

  frames(): FrameData[] { return framesOf(this.view().state.doc) }
  get(id: string | null) { return this.frames().find(f => f.id === id) || null }

  commit(list: FrameData[]) {
    const v = this.view()
    v.dispatch(v.state.tr.setDocAttribute('frames', list))
  }
  update(id: string, patch: Partial<FrameData>) {
    this.commit(this.frames().map(f => (f.id === id ? { ...f, ...patch } : f)))
  }
  add(f: Omit<FrameData, 'id'>) {
    const n = { ...f, id: uid('f') } as FrameData
    this.commit([...this.frames(), n])
    this.select(n.id)
    return n
  }
  remove(id: string) {
    this.commit(this.frames().filter(f => f.id !== id))
    if (this.selected === id) this.select(null)
  }
  order(id: string, front: boolean) {
    const list = this.frames()
    const f = list.find(x => x.id === id)
    if (!f) return
    const rest = list.filter(x => x.id !== id)
    this.commit(front ? [...rest, f] : [f, ...rest])
  }

  select(id: string | null) {
    if (this.selected === id) return
    this.selected = id
    for (const [k, it] of this.items) it.el.classList.toggle('sel', k === id)
    this.root.dispatchEvent(new CustomEvent('ca-frame-select', { detail: id }))
  }

  /** The text editor of a text box, for applying styles from the inspector. */
  editorOf(id: string) { return this.items.get(id)?.ed || null }

  render(layout: Layout) {
    this.layout = layout
    const list = this.frames()
    const seen = new Set<string>()
    list.forEach((f, z) => {
      const p = layout.pages[f.page]
      seen.add(f.id)
      let it = this.items.get(f.id)
      if (it && it.key !== f.kind) { this.drop(f.id); it = undefined }
      if (!it) it = this.create(f)
      if (!p) { it.el.style.display = 'none'; return }
      it.el.style.display = ''
      this.place(it, f, p)
      it.el.style.zIndex = String((f.wrap === 'behind' ? 0 : 3))
      it.el.style.order = String(z)
      this.el.append(it.el) // keep stacking order equal to list order
    })
    for (const k of [...this.items.keys()]) if (!seen.has(k)) this.drop(k)
    if (this.selected && !seen.has(this.selected)) this.select(null)
  }

  private place(it: Item, f: FrameData, p: PageBox) {
    const e = it.el
    e.dataset.page = String(f.page)
    e.className = `ca-obj k-${f.kind === 'image' ? 'img' : 'text'} w-${f.wrap}${this.selected === f.id ? ' sel' : ''}`
    e.style.left = p.left + f.x + 'px'
    e.style.top = p.top + f.y + 'px'
    e.style.width = f.w + 'px'
    e.style.height = f.h + 'px'
    if (f.kind === 'image' && it.img) {
      const src = String(f.src || '')
      const url = src.startsWith('asset:') ? assets.url(src.slice(6)) : src
      if (it.img.getAttribute('src') !== url) it.img.src = url
      it.img.dataset.asset = src.startsWith('asset:') ? src.slice(6) : ''
      it.img.alt = f.alt || ''
      this.geom(it.img, f, f.w, f.h)
    } else if (it.ed) {
      const b = it.box
      b.style.padding = (f.pad ?? 0) + 'px'
      b.style.background = f.fill || ''
      b.style.border = f.border ? `${f.border}px solid ${f.borderColor || '#1d1d1f'}` : ''
      b.style.justifyContent = f.valign === 'middle' ? 'center' : f.valign === 'bottom' ? 'flex-end' : 'flex-start'
      const want = f.content || EMPTY
      if (!it.ed.isFocused && JSON.stringify(it.ed.getJSON()) !== JSON.stringify(want)) it.ed.commands.setContent(want, { emitUpdate: false })
    }
  }

  private geom(img: HTMLImageElement, f: FrameData, w: number, h: number) {
    const a = { w: f.iw || 800, h: f.ih || 600, fit: f.fit, cx: f.cx, cy: f.cy, zoom: f.zoom, cropRect: f.cropRect }
    const fr = h / Math.max(1, w)
    const g = placeImage(a as any, a.w, a.h, 1, fr)
    img.style.left = g.dx * 100 + '%'
    img.style.top = (g.dy / fr) * 100 + '%'
    img.style.width = g.dw * 100 + '%'
    img.style.height = (g.dh / fr) * 100 + '%'
  }

  private create(f: FrameData): Item {
    const el = document.createElement('div')
    el.dataset.id = f.id
    const box = document.createElement('div')
    el.append(box)
    const it: Item = { el, box, key: f.kind }
    if (f.kind === 'image') {
      box.className = 'ca-imgb'
      const img = document.createElement('img')
      img.draggable = false
      box.append(img)
      it.img = img
    } else {
      box.className = 'ca-tb'
      const host = document.createElement('div')
      box.append(host)
      it.ed = new Editor({ element: host, extensions: boxExtensions(), content: f.content || EMPTY, editable: this.mode === 'edit', editorProps: { attributes: { spellcheck: 'false' } } })
      it.ed.on('update', () => {
        clearTimeout(this.saveT)
        this.saveT = setTimeout(() => { const cur = this.get(f.id); if (cur && it.ed) this.update(f.id, { content: it.ed.getJSON() }) }, 300)
      })
      it.ed.on('focus', () => this.select(f.id))
    }
    if (this.mode === 'edit') {
      for (const hd of HANDLES) { const i = document.createElement('i'); i.className = 'ca-h'; i.dataset.h = hd; el.append(i) }
      if (f.kind === 'text') { const g = document.createElement('b'); g.className = 'ca-grip'; g.title = 'Drag to move'; el.append(g) }
    }
    this.items.set(f.id, it)
    return it
  }

  private drop(id: string) {
    const it = this.items.get(id)
    if (!it) return
    it.ed?.destroy()
    it.el.remove()
    this.items.delete(id)
  }

  destroy() {
    for (const k of [...this.items.keys()]) this.drop(k)
    document.removeEventListener('keydown', this.key)
    document.removeEventListener('pointerdown', this.outside, true)
    this.el.remove()
  }

  /** Select whatever frame is under a point, including ones behind the text. */
  hit(clientX: number, clientY: number): string | null {
    const list = this.frames()
    for (let i = list.length - 1; i >= 0; i--) {
      const it = this.items.get(list[i].id)
      if (!it) continue
      const r = it.el.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return list[i].id
    }
    return null
  }

  private outside = (e: PointerEvent) => {
    if (!this.selected) return
    const t = e.target as HTMLElement
    if (t.closest('.ca-obj') || t.closest('#insp, .ib, .modal, .ctx, .dd, #top, #tools')) return
    if (e.altKey && this.hit(e.clientX, e.clientY)) return
    this.select(null)
  }

  private key = (e: KeyboardEvent) => {
    if (!this.selected) return
    const a = document.activeElement as HTMLElement | null
    if (a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))) {
      if (e.key === 'Escape' && a.closest('.ca-obj')) { a.blur(); e.preventDefault() }
      return
    }
    const f = this.get(this.selected)
    if (!f) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(f.id); return }
    if (e.key === 'Escape') { this.select(null); return }
    const st = e.shiftKey ? 10 : 1
    const d: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }
    if (d[e.key]) { e.preventDefault(); this.update(f.id, { x: f.x + d[e.key][0], y: f.y + d[e.key][1] }) }
  }

  private down = (e: PointerEvent) => {
    const t = e.target as HTMLElement
    const el = t.closest('.ca-obj') as HTMLElement | null
    if (!el || !this.layout) return
    const id = el.dataset.id!
    const f = this.get(id)
    if (!f) return
    const handle = t.dataset.h
    const inText = !!t.closest('.ca-tb')
    // A selected text box is edited by clicking into it; its grip and handles still move and resize.
    if (inText && this.selected === id && !handle) {
      const it = this.items.get(id)
      if (it?.ed && !t.closest('.ProseMirror')) { e.preventDefault(); it.ed.commands.focus('end') }
      return
    }
    e.preventDefault()
    const act = document.activeElement as HTMLElement | null
    if (act && act !== document.body && !el.contains(act)) act.blur()
    this.select(id)
    const sc = this.scale()
    const sx = e.clientX, sy = e.clientY
    const L = this.layout
    const page0 = L.pages[f.page]
    const ax = page0.left + f.x, ay = page0.top + f.y
    const ratio = f.h / Math.max(1, f.w)
    const lock = f.kind === 'image' && (!!f.cropRect || !!handle && handle.length === 2)
    let moved = false
    let next = { x: ax, y: ay, w: f.w, h: f.h }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / sc) return
      moved = true
      if (!handle) next = { x: ax + dx, y: ay + dy, w: f.w, h: f.h }
      else {
        let x0 = ax, y0 = ay, x1 = ax + f.w, y1 = ay + f.h
        if (handle.includes('w')) x0 = Math.min(x1 - 12, ax + dx)
        if (handle.includes('e')) x1 = Math.max(x0 + 12, ax + f.w + dx)
        if (handle.includes('n')) y0 = Math.min(y1 - 12, ay + dy)
        if (handle.includes('s')) y1 = Math.max(y0 + 12, ay + f.h + dy)
        let w = x1 - x0, h = y1 - y0
        if (lock !== ev.shiftKey && f.kind === 'image') {
          if (handle === 'n' || handle === 's') w = h / ratio
          else if (handle === 'e' || handle === 'w') h = w * ratio
          else if (h / w > ratio) w = h / ratio; else h = w * ratio
          if (handle.includes('w')) x0 = x1 - w
          if (handle.includes('n')) y0 = y1 - h
        }
        next = { x: x0, y: y0, w, h }
      }
      el.style.left = next.x + 'px'; el.style.top = next.y + 'px'
      el.style.width = next.w + 'px'; el.style.height = next.h + 'px'
      const img = el.querySelector('img')
      if (img) this.geom(img as HTMLImageElement, f, next.w, next.h)
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      if (!moved) {
        // A click on an unselected text box selects it and puts the cursor where you clicked.
        const it = this.items.get(id)
        if (inText && it?.ed) {
          const hitp = it.ed.view.posAtCoords({ left: sx, top: sy })
          it.ed.chain().focus().setTextSelection(hitp ? hitp.pos : it.ed.state.doc.content.size - 1).run()
        }
        return
      }
      // The page under the frame's centre owns it.
      const cy = next.y + next.h / 2
      let pg = L.pages[0]
      for (const q of L.pages) if (q.top - L.gap / 2 <= cy) pg = q
      this.update(id, { page: pg.i, x: Math.round((next.x - pg.left) * 10) / 10, y: Math.round((next.y - pg.top) * 10) / 10, w: Math.round(next.w * 10) / 10, h: Math.round(next.h * 10) / 10 })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
}

const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }

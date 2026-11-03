import { Editor } from '@tiptap/core'
import { extensions } from './extensions'
import { paginate, renderPages, type Layout, type DocMetaLite } from '../layout/paginate'
import { applyDocCSS } from '../layout/docstyle'
import { getSettings } from '../layout/plugin'
import { loadUsedFonts } from '../layout/fonts'
import { uid } from '../util'

export const GAP = 24

const NEEDS_ID = (n: any) => n.type === 'heading' || n.type === 'toc' || n.type === 'footnote' || n.type === 'bookmark' || (n.type === 'paragraph' && n.attrs?.kind === 'caption')

export function ensureIds(json: any) {
  const seen = new Set<string>()
  const walk = (n: any): any => {
    if (!n || typeof n !== 'object') return n
    let out = n
    if (NEEDS_ID(n)) {
      const id = n.attrs?.id
      if (!id || seen.has(id)) out = { ...n, attrs: { ...(n.attrs || {}), id: uid(n.type[0]) } }
      seen.add(out.attrs.id)
    }
    if (Array.isArray(n.content)) out = { ...out, content: n.content.map(walk) }
    return out
  }
  return walk(json)
}

export class DocView {
  editor: Editor
  root: HTMLElement
  zwrap: HTMLElement | null = null
  layout: Layout | null = null
  zoom = 1
  private timer: any = 0
  private busy = false
  private lastStyles: any = null
  private listeners: ((l: Layout) => void)[] = []
  destroyed = false

  constructor(public host: HTMLElement, content: any, public mode: 'edit' | 'export', public meta: () => DocMetaLite) {
    this.root = document.createElement('div')
    this.root.className = 'ca-flow ' + (mode === 'edit' ? 'is-edit' : 'is-export')
    this.root.innerHTML = '<div class="ca-under"></div>'
    if (mode === 'edit') {
      this.zwrap = document.createElement('div')
      this.zwrap.className = 'ca-zwrap'
      this.zwrap.append(this.root)
      host.append(this.zwrap)
    } else host.append(this.root)
    content = ensureIds(content)
    applyDocCSS(content?.attrs?.styles || null)
    this.lastStyles = content?.attrs?.styles
    this.editor = new Editor({
      element: this.root,
      extensions: extensions(),
      content,
      editable: mode === 'edit',
      injectCSS: true,
      editorProps: { attributes: { spellcheck: mode === 'edit' ? 'true' : 'false' } }
    })
    const over = document.createElement('div')
    over.className = 'ca-over'
    const meas = document.createElement('div')
    meas.className = 'ca-measure'
    this.root.append(over, meas)
    this.editor.on('transaction', ({ transaction }) => {
      if (this.busy) return
      const st = this.editor.state.doc.attrs.styles
      if (st !== this.lastStyles) { this.lastStyles = st; applyDocCSS(st) }
      if (transaction.docChanged) this.schedule()
    })
    if (mode === 'edit') {
      document.fonts.addEventListener('loadingdone', this.onFonts)
      this.schedule(0)
      loadUsedFonts(this.root).finally(() => { if (!this.destroyed) this.schedule(0) })
    }
  }

  private onFonts = () => this.schedule(60)

  get scale() { return this.mode === 'edit' ? this.zoom * 4 / 3 : 1 }

  onLayout(cb: (l: Layout) => void) { this.listeners.push(cb) }

  schedule(ms = 280) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.run(), ms)
  }

  run() {
    if (this.destroyed) return
    const v = this.editor.view
    if ((v as any).composing) { this.schedule(400); return }
    this.busy = true
    const sc = this.host
    const keepTop = sc.scrollTop
    if (this.zwrap && this.layout) this.zwrap.style.minHeight = this.zwrap.style.height
    try {
      this.root.classList.toggle('is-cont', getSettings(v.state.doc).layout === 'continuous')
      if (this.zwrap) this.root.style.transform = `scale(${this.scale})`
      this.layout = paginate(v, this.root, { scale: this.scale, gap: GAP, mode: this.mode, meta: this.meta() })
      this.applyZoom()
    } finally {
      this.busy = false
      if (this.zwrap) this.zwrap.style.minHeight = ''
    }
    if (this.mode === 'edit' && Math.abs(sc.scrollTop - keepTop) > 1) sc.scrollTop = keepTop
    for (const l of this.listeners) l(this.layout!)
  }

  refreshFrames() {
    if (!this.layout) return
    renderPages(this.root, this.layout, getSettings(this.editor.state.doc), this.meta(), this.mode)
  }

  applyZoom() {
    if (!this.zwrap || !this.layout) return
    const s = this.scale
    this.root.style.transform = `scale(${s})`
    this.zwrap.style.width = this.layout.flowW * s + 'px'
    this.zwrap.style.height = this.layout.flowH * s + 'px'
  }

  setZoom(z: number) {
    const sc = this.host
    const rel = sc.scrollTop / Math.max(1, sc.scrollHeight)
    this.zoom = z
    this.applyZoom()
    sc.scrollTop = rel * sc.scrollHeight
  }

  async ready(): Promise<Layout> {
    await loadUsedFonts(this.root)
    await Promise.all(Array.from(this.root.querySelectorAll('img')).map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))))
    this.run()
    return this.layout!
  }

  scrollToPos(pos: number) {
    const v = this.editor.view
    const dom = v.nodeDOM(pos) as HTMLElement | null
    const el = dom?.nodeType === 1 ? dom : (v.domAtPos(pos).node as HTMLElement)
    if (!el?.getBoundingClientRect) return
    const r = el.getBoundingClientRect()
    const hr = this.host.getBoundingClientRect()
    this.host.scrollTop += r.top - hr.top - 80
  }

  scrollToId(id: string) {
    const el = this.root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
    if (!el) return false
    const r = el.getBoundingClientRect()
    const hr = this.host.getBoundingClientRect()
    this.host.scrollTop += r.top - hr.top - 80
    try {
      const pos = this.editor.view.posAtDOM(el, 0)
      this.editor.chain().setTextSelection(pos).focus(undefined, { scrollIntoView: false }).run()
    } catch {}
    return true
  }

  scrollToPage(i: number) {
    const p = this.layout?.pages[i]
    if (!p) return
    const hr = this.host.getBoundingClientRect()
    const zr = (this.zwrap || this.root).getBoundingClientRect()
    this.host.scrollTop += zr.top - hr.top + p.top * this.scale - 16
  }

  currentPage(): number {
    if (!this.layout) return 0
    const hr = this.host.getBoundingClientRect()
    const zr = (this.zwrap || this.root).getBoundingClientRect()
    const y = (hr.top + hr.height * 0.35 - zr.top) / this.scale
    let cur = 0
    for (const p of this.layout.pages) if (p.top <= y) cur = p.i
    return cur
  }

  destroy() {
    this.destroyed = true
    clearTimeout(this.timer)
    document.fonts.removeEventListener('loadingdone', this.onFonts)
    this.editor.destroy()
    ;(this.zwrap || this.root).remove()
  }
}

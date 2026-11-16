import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist'
import { h, relTime, clamp, uid, esc, keyOf } from '../util'
import { icon } from '../ui/icons'
import { menuBar, toast, confirmBox, promptBox } from '../ui/dialogs'
import { native, saveFile, openFile } from '../storage/store'
import { go } from '../router'
import { getPdf, addPdf } from './source'
import { extract, build, bounds, translate, norm, TYPE_LABEL, type Annot, type Extracted } from './annots'
import type { WS } from '../ui/workspace'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Tool = 'select' | 'hand' | 'highlight' | 'underline' | 'strike' | 'pen' | 'marker' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'note' | 'eraser'
const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: 'cursor', label: 'Select', key: 'V' },
  { id: 'hand', icon: 'hand', label: 'Hand', key: 'H' },
  { id: 'highlight', icon: 'highlight', label: 'Highlight text', key: 'L' },
  { id: 'underline', icon: 'underline', label: 'Underline text', key: 'U' },
  { id: 'strike', icon: 'strike', label: 'Strike out text', key: 'K' },
  { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  { id: 'marker', icon: 'marker', label: 'Highlighter pen', key: 'M' },
  { id: 'rect', icon: 'square', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'O' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'text', icon: 'type', label: 'Text box', key: 'T' },
  { id: 'note', icon: 'comment', label: 'Comment', key: 'C' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' }
]
const MARKUP = new Set<Tool>(['highlight', 'underline', 'strike'])
const DRAW = new Set<Tool>(['pen', 'marker', 'rect', 'ellipse', 'arrow', 'text', 'note', 'eraser'])
const COLORS = ['#ffd400', '#ff6b6b', '#ff9f43', '#5fd068', '#4dabf7', '#9775fa', '#111111']
const DEF_COLOR: Partial<Record<Tool, string>> = { highlight: '#ffd400', underline: '#4dabf7', strike: '#ff6b6b', pen: '#ff6b6b', marker: '#ffd400', rect: '#ff6b6b', ellipse: '#ff6b6b', arrow: '#ff6b6b', text: '#111111', note: '#ffd400' }

interface PV {
  i: number; page: PDFPageProxy; vp: PageViewport; el: HTMLElement; canvas: HTMLCanvasElement | null; textEl: HTMLElement | null
  anno: HTMLElement; key: string; task: RenderTask | null; near: boolean; links?: any[]
}

const SKEY = 'ca-pdf-'
const pref = (k: string, d: string) => { try { return localStorage.getItem(SKEY + k) ?? d } catch { return d } }
const setPref = (k: string, v: string) => { try { localStorage.setItem(SKEY + k, v) } catch {} }

export async function openPdfViewer(app: HTMLElement, token: string): Promise<WS | null> {
  const src = await getPdf(token)
  if (!src) { toast('That PDF is no longer open.'); go('/'); return null }
  app.innerHTML = ''
  app.append(h('div', { class: 'pv-loading' }, 'Opening ' + src.name + '…'))

  let ex: Extracted
  let pdf: PDFDocumentProxy
  let task: ReturnType<typeof pdfjs.getDocument> | null = null
  try {
    ex = await extract(src.data)
    task = pdfjs.getDocument({ data: ex.base.slice() })
    pdf = await task.promise
  } catch (e: any) {
    console.error(e)
    task?.destroy()
    app.innerHTML = ''
    toast(e?.name === 'PasswordException' ? 'Password-protected PDFs are not supported yet.' : 'That PDF could not be opened.', 5000)
    go('/')
    return null
  }

  // ---------- state ----------
  let name = src.name
  let annots: Annot[] = ex.annots
  const undo: string[] = [], redo: string[] = []
  let dirty = false
  let tool: Tool = 'select'
  const colors: Record<string, string> = JSON.parse(pref('colors', '{}'))
  const colorOf = (t: Tool) => colors[t] || DEF_COLOR[t] || '#ff6b6b'
  let penW = +pref('penw', '2'), textSize = +pref('textsize', '14')
  let selId: string | null = null
  let rot = 0
  let zoomMode: 'width' | 'page' | number = (pref('zoom', 'width') as any)
  if (!isNaN(+zoomMode)) zoomMode = +zoomMode
  let scale = 1
  let cur = 0
  let query = ''
  let disposed = false

  // ---------- layout ----------
  const status = h('span', { class: 'status' })
  const nameEl = h('b', { class: 'pv-name', title: src.path || name }, name)
  const pageIn = h('input', { type: 'text', class: 'pv-pagein', value: '1', 'aria-label': 'Page' }) as HTMLInputElement
  const zoomEl = h('span', { title: 'Zoom' }, '100%')
  const saveBtn = h('button', { class: 'pri', onclick: () => save(false), title: 'Save (Ctrl+S)' }, icon('save'), 'Save')
  const top = h('div', { id: 'top' },
    h('button', { class: 'brand', title: 'CocoaAuthor library', onclick: async () => { if (await leaveOk()) go('/') } }, h('img', { src: 'logo.svg', alt: 'CocoaAuthor' })),
    menuBar([
      { label: 'File', items: () => [
        { label: 'Open PDF…', icon: icon('upload'), run: openOther },
        'sep',
        { label: 'Save', icon: icon('save'), run: () => save(false), disabled: !ex.editable },
        { label: 'Save as…', icon: icon('download'), run: () => save(true), disabled: !ex.editable },
        { label: 'Print…', icon: icon('printer'), run: printPdf },
        'sep',
        { label: 'Close', icon: icon('x'), run: async () => { if (await leaveOk()) { if (native) window.close(); else go('/') } } }
      ] },
      { label: 'View', items: () => [
        { label: 'Find…  Ctrl+F', icon: icon('search'), run: () => openFind() },
        'sep',
        { label: 'Fit width', icon: icon('alignj'), run: () => setZoom('width') },
        { label: 'Fit page', icon: icon('page'), run: () => setZoom('page') },
        { label: 'Actual size', icon: icon('eye'), run: () => setZoom(1) },
        { label: 'Zoom in', icon: icon('zin'), run: () => zoomBy(1.2) },
        { label: 'Zoom out', icon: icon('zout'), run: () => zoomBy(1 / 1.2) },
        'sep',
        { label: 'Rotate clockwise', icon: icon('rotate'), run: () => rotate(90) },
        { label: 'Rotate counter-clockwise', icon: icon('undo'), run: () => rotate(-90) },
        'sep',
        { label: (mid.classList.contains('no-l') ? 'Show' : 'Hide') + ' pages panel', icon: icon('sidebar'), run: () => toggleSide('l') },
        { label: (mid.classList.contains('no-r') ? 'Show' : 'Hide') + ' review panel', icon: icon('comment'), run: () => toggleSide('r') }
      ] },
      { label: 'Review', items: () => [
        ...TOOLS.map(t => ({ label: t.label + '  (' + t.key + ')', icon: icon(t.icon), run: () => setTool(t.id) })),
        'sep',
        { label: 'Your name: ' + (author() || 'not set') + '…', icon: icon('edit'), run: () => askAuthor(true) },
        { label: 'Delete all annotations', icon: icon('trash'), disabled: !annots.length, run: async () => {
          if (!(await confirmBox('Delete all annotations?', 'Every drawing, highlight and comment in this PDF will be removed. You can undo this.'))) return
          mutate(() => { annots = [] })
        } }
      ] }
    ]),
    h('span', { class: 'sep pv-sep' }), nameEl, status,
    h('span', { class: 'sp' }),
    h('div', { class: 'zoom' },
      h('button', { class: 'ic', title: 'Previous page', onclick: () => goPage(cur - 1) }, icon('left')),
      pageIn, h('span', { class: 'mute pv-of' }, '/ ' + pdf.numPages),
      h('button', { class: 'ic', title: 'Next page', onclick: () => goPage(cur + 1) }, icon('right'))),
    h('span', { class: 'sep pv-sep' }),
    h('div', { class: 'zoom' },
      h('button', { class: 'ic', title: 'Zoom out (Ctrl+−)', onclick: () => zoomBy(1 / 1.2) }, icon('zout')),
      zoomEl,
      h('button', { class: 'ic', title: 'Zoom in (Ctrl+=)', onclick: () => zoomBy(1.2) }, icon('zin')),
      h('button', { class: 'ic pv-fit', title: 'Fit width (Ctrl+0)', onclick: () => setZoom(zoomMode === 'width' ? 'page' : 'width') }, 'Fit'),
      h('button', { class: 'ic', title: 'Rotate', onclick: () => rotate(90) }, icon('rotate'))),
    h('span', { class: 'sp' }),
    h('button', { class: 'ic', title: 'Find (Ctrl+F)', onclick: () => openFind() }, icon('search')),
    h('button', { class: 'ic', title: 'Print (Ctrl+P)', onclick: printPdf }, icon('printer')),
    saveBtn
  )
  zoomEl.onclick = () => setZoom(zoomMode === 'width' ? 'page' : 'width')

  // review toolbar
  const toolBtns = new Map<Tool, HTMLButtonElement>()
  const swatches = h('div', { class: 'pv-sw' })
  const widthSel = h('select', { title: 'Line width', onchange: () => { penW = +widthSel.value; setPref('penw', widthSel.value); applyToSel(a => { if ('width' in a && a.type !== 'ink' || (a.type === 'ink' && !a.marker)) (a as any).width = penW }) } },
    ...[1, 2, 3, 5, 8].map(w => h('option', { value: String(w), selected: w === penW }, w + ' pt'))) as HTMLSelectElement
  const sizeSel = h('select', { title: 'Text size', onchange: () => { textSize = +sizeSel.value; setPref('textsize', sizeSel.value); applyToSel(a => { if (a.type === 'text') a.size = textSize }) } },
    ...[9, 10, 12, 14, 18, 24, 32].map(s => h('option', { value: String(s), selected: s === textSize }, s + ' pt'))) as HTMLSelectElement
  const undoBtn = h('button', { class: 'ic', title: 'Undo (Ctrl+Z)', onclick: () => doUndo() }, icon('undo')) as HTMLButtonElement
  const redoBtn = h('button', { class: 'ic', title: 'Redo (Ctrl+Y)', onclick: () => doRedo() }, icon('redo')) as HTMLButtonElement
  const tools = h('div', { id: 'tools' },
    ...TOOLS.flatMap((t, i) => {
      const b = h('button', { class: 'ic', title: `${t.label} (${t.key})`, onclick: () => setTool(t.id) }, icon(t.icon)) as HTMLButtonElement
      toolBtns.set(t.id, b)
      return [i === 2 || i === 5 || i === 10 || i === 12 ? h('span', { class: 'sep' }) : null, b].filter(Boolean) as Node[]
    }),
    h('span', { class: 'sep' }), swatches, widthSel, sizeSel,
    h('span', { class: 'sep' }), undoBtn, redoBtn,
    h('span', { class: 'sp' }),
    ex.editable ? null : h('span', { class: 'mute', style: 'font-size:12px;white-space:nowrap' }, 'Protected PDF: review tools are off')
  )

  // sidebars
  const thumbs = h('div', { class: 'pv-thumbs' })
  const outlineEl = h('div', { class: 'pv-outline', hidden: true })
  const lTabs = tabs(['Pages', 'Outline'], i => { thumbs.hidden = i !== 0; outlineEl.hidden = i !== 1 })
  const left = h('aside', { id: 'outline' }, lTabs, thumbs, outlineEl)

  const commentsEl = h('div', { class: 'pv-comments' })
  const searchIn = h('input', { type: 'search', placeholder: 'Find in PDF', 'aria-label': 'Find in PDF' }) as HTMLInputElement
  const searchCount = h('span', { class: 'mute' })
  const results = h('div', { class: 'pv-results' })
  const searchEl = h('div', { class: 'pv-search', hidden: true }, h('div', { class: 'pv-find' }, searchIn, searchCount), results)
  const infoEl = h('div', { class: 'pv-info', hidden: true })
  let rTab = 0
  const rTabs = tabs(['Comments', 'Search', 'Info'], i => { rTab = i; commentsEl.hidden = i !== 0; searchEl.hidden = i !== 1; infoEl.hidden = i !== 2; if (i === 1) searchIn.focus() })
  const right = h('aside', { id: 'insp' }, rTabs, commentsEl, searchEl, infoEl)

  const column = h('div', { class: 'pv-col' })
  const desk = h('div', { class: 'pv-desk', tabindex: '-1' }, column)
  const pop = h('div', { class: 'pv-pop', hidden: true })
  const selPop = h('div', { class: 'pv-pop pv-selpop', hidden: true })
  const mid = h('div', { id: 'mid', class: [pref('l', '1') === '0' ? 'no-l' : '', pref('r', '1') === '0' ? 'no-r' : ''].join(' ') }, left, desk, right)
  const ws = h('div', { class: 'ws pv' }, top, tools, mid)
  app.innerHTML = ''
  app.append(ws)
  document.body.append(pop, selPop)

  function tabs(labels: string[], on: (i: number) => void) {
    const el = h('div', { class: 'pv-tabs', role: 'tablist' })
    labels.forEach((l, i) => el.append(h('button', { class: i === 0 ? 'on' : '', role: 'tab', onclick: () => { el.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j)); on(i) } }, l)))
    return el
  }
  const showTab = (el: HTMLElement, i: number) => (el.children[i] as HTMLButtonElement).click()

  function toggleSide(s: 'l' | 'r') {
    mid.classList.toggle('no-' + s)
    setPref(s, mid.classList.contains('no-' + s) ? '0' : '1')
    if (typeof zoomMode !== 'number') requestAnimationFrame(() => applyZoom())
  }

  // ---------- pages ----------
  const pvs: PV[] = []
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const el = h('div', { class: 'pv-page', 'data-i': String(i) })
    const anno = h('div', { class: 'pv-anno' })
    el.append(anno)
    column.append(el)
    pvs.push({ i, page, vp: page.getViewport({ scale: 1 }), el, canvas: null, textEl: null, anno, key: '', task: null, near: false })
  }
  if (disposed) return null

  const vpFor = (pv: PV, s = scale) => pv.page.getViewport({ scale: s, rotation: (pv.page.rotate + rot) % 360 })
  function layout() {
    for (const pv of pvs) {
      pv.vp = vpFor(pv)
      pv.el.style.width = Math.floor(pv.vp.width) + 'px'
      pv.el.style.height = Math.floor(pv.vp.height) + 'px'
      pv.el.style.setProperty('--total-scale-factor', String(scale))
      pv.el.style.setProperty('--scale-round-x', '1px')
      pv.el.style.setProperty('--scale-round-y', '1px')
      drawAnno(pv)
    }
  }

  const io = new IntersectionObserver(es => {
    for (const e of es) {
      const pv = pvs[+(e.target as HTMLElement).dataset.i!]
      pv.near = e.isIntersecting
      if (pv.near) render(pv)
      else if (pvs.length > 30) release(pv)
    }
  }, { root: desk, rootMargin: '1200px 0px' })
  pvs.forEach(pv => io.observe(pv.el))

  function release(pv: PV) {
    pv.task?.cancel(); pv.task = null
    pv.canvas?.remove(); pv.canvas = null
    pv.textEl?.remove(); pv.textEl = null
    pv.key = ''
  }

  async function render(pv: PV) {
    const key = scale.toFixed(4) + ':' + rot
    if (pv.key === key || disposed) return
    pv.key = key
    pv.task?.cancel()
    const vp = pv.vp
    const max = 16e6
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (vp.width * vp.height * dpr * dpr > max) dpr = Math.sqrt(max / (vp.width * vp.height))
    const c = h('canvas', { class: 'pv-canvas' }) as HTMLCanvasElement
    c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr)
    const task = pv.page.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined, annotationMode: pdfjs.AnnotationMode.ENABLE })
    pv.task = task
    try { await task.promise } catch { return }
    if (pv.key !== key || disposed) return
    pv.task = null
    pv.canvas?.remove()
    pv.canvas = c
    pv.el.prepend(c)
    // selectable text
    const tl = h('div', { class: 'textLayer', onmousedown: () => tl.classList.add('selecting') })
    try {
      const layer = new pdfjs.TextLayer({ textContentSource: pv.page.streamTextContent(), container: tl, viewport: vp })
      await layer.render()
    } catch {}
    if (pv.key !== key || disposed) return
    pv.textEl?.remove()
    pv.textEl = tl
    c.after(tl)
    markSearch(pv)
    await linkLayer(pv)
  }

  async function linkLayer(pv: PV) {
    pv.el.querySelector('.pv-links')?.remove()
    if (!pv.links) { try { pv.links = (await pv.page.getAnnotations({ intent: 'display' })).filter((a: any) => a.annotationType === pdfjs.AnnotationType.LINK) } catch { pv.links = [] } }
    if (!pv.links.length) return
    const box = h('div', { class: 'pv-links' })
    for (const l of pv.links) {
      const p1 = pv.vp.convertToViewportPoint(l.rect[0], l.rect[1]), p2 = pv.vp.convertToViewportPoint(l.rect[2], l.rect[3])
      const r = [p1[0], p1[1], p2[0], p2[1]]
      const a = h('a', { href: l.url || '#', title: l.url || 'Go to destination', style: { left: Math.min(r[0], r[2]) + 'px', top: Math.min(r[1], r[3]) + 'px', width: Math.abs(r[2] - r[0]) + 'px', height: Math.abs(r[3] - r[1]) + 'px' } })
      a.onclick = e => {
        e.preventDefault()
        if (tool !== 'select' && tool !== 'hand') return
        if (l.url) window.open(l.url, '_blank', 'noopener')
        else if (l.dest) goDest(l.dest)
      }
      box.append(a)
    }
    pv.anno.before(box)
  }

  async function goDest(dest: any) {
    try {
      const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!d) return
      const idx = typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0])
      let y: number | null = null
      if (d[1]?.name === 'XYZ' && typeof d[3] === 'number') y = d[3]
      else if ((d[1]?.name === 'FitH' || d[1]?.name === 'FitBH') && typeof d[2] === 'number') y = d[2]
      goPage(idx, y)
    } catch {}
  }

  // ---------- navigation and zoom ----------
  function goPage(i: number, pdfY: number | null = null, pdfX = 0) {
    i = clamp(i, 0, pvs.length - 1)
    const pv = pvs[i]
    let off = 0
    if (pdfY != null) off = Math.max(0, pv.vp.convertToViewportPoint(pdfX, pdfY)[1] - 40)
    desk.scrollTop = pv.el.offsetTop - 16 + off
    setCur(i)
  }
  function setCur(i: number) {
    if (cur === i && pageIn.value === String(i + 1)) return
    cur = i
    if (document.activeElement !== pageIn) pageIn.value = String(i + 1)
    thumbs.querySelectorAll('.on').forEach(e => e.classList.remove('on'))
    const t = thumbs.children[i] as HTMLElement | undefined
    if (t) { t.classList.add('on'); if (!disposed && thumbs.offsetParent) t.scrollIntoView({ block: 'nearest' }) }
  }
  pageIn.onkeydown = e => { if (e.key === 'Enter') { goPage((parseInt(pageIn.value) || 1) - 1); desk.focus() } }
  pageIn.onblur = () => (pageIn.value = String(cur + 1))
  desk.addEventListener('scroll', () => {
    const mid = desk.scrollTop + desk.clientHeight / 3
    let lo = 0, hi = pvs.length - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pvs[m].el.offsetTop <= mid) lo = m; else hi = m - 1 }
    setCur(lo)
    placePop()
  }, { passive: true })

  function fitScale(mode: 'width' | 'page') {
    const pv = pvs[cur] || pvs[0]
    const v1 = vpFor(pv, 1)
    const w = (desk.clientWidth - 48) / v1.width
    return mode === 'width' ? w : Math.min(w, (desk.clientHeight - 32) / v1.height)
  }
  function applyZoom() {
    const s = typeof zoomMode === 'number' ? zoomMode : fitScale(zoomMode)
    setScale(clamp(s, 0.1, 8))
  }
  function setScale(s: number, anchorY?: number) {
    const pv = pvs[cur]
    const ay = anchorY ?? 0
    const frac = pv ? (desk.scrollTop + ay - pv.el.offsetTop) / pv.el.offsetHeight : 0
    const fx = desk.scrollWidth > desk.clientWidth ? (desk.scrollLeft + desk.clientWidth / 2) / desk.scrollWidth : 0.5
    scale = s
    zoomEl.textContent = Math.round(s * 100) + '%'
    layout()
    if (pv) desk.scrollTop = pv.el.offsetTop + frac * pv.el.offsetHeight - ay
    desk.scrollLeft = fx * desk.scrollWidth - desk.clientWidth / 2
    for (const p of pvs) if (p.near || Math.abs(p.i - cur) <= 2) render(p)
    placePop()
  }
  function setZoom(m: 'width' | 'page' | number) {
    zoomMode = m
    setPref('zoom', String(m))
    top.querySelector('.pv-fit')!.classList.toggle('on', typeof m !== 'number')
    applyZoom()
  }
  function zoomBy(f: number, anchorY?: number) {
    zoomMode = clamp(Math.round(scale * f * 100) / 100, 0.1, 8)
    setPref('zoom', String(zoomMode))
    top.querySelector('.pv-fit')!.classList.remove('on')
    setScale(zoomMode, anchorY)
  }
  function rotate(d: number) {
    rot = (rot + d + 360) % 360
    for (const pv of pvs) pv.key = ''
    applyZoom()
    for (const t of Array.from(thumbs.children)) (t as HTMLElement).dataset.done = ''
    thumbIO.disconnect(); Array.from(thumbs.children).forEach(t => thumbIO.observe(t))
  }
  desk.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const r = desk.getBoundingClientRect()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientY - r.top)
  }, { passive: false })
  const ro = new ResizeObserver(() => { if (typeof zoomMode !== 'number') applyZoom() })
  ro.observe(desk)

  // ---------- thumbnails and outline ----------
  const thumbIO = new IntersectionObserver(async es => {
    for (const e of es) {
      if (!e.isIntersecting) continue
      const b = e.target as HTMLElement
      if (b.dataset.done) continue
      b.dataset.done = '1'
      const pv = pvs[+b.dataset.i!]
      const v1 = vpFor(pv, 1)
      const s = 260 / Math.max(v1.width, v1.height)
      const vp = vpFor(pv, s)
      const c = h('canvas') as HTMLCanvasElement
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
      try { await pv.page.render({ canvas: c, viewport: vp }).promise } catch { continue }
      b.querySelector('.pv-th')!.replaceChildren(c)
    }
  }, { root: thumbs, rootMargin: '400px 0px' })
  for (const pv of pvs) {
    const v = vpFor(pv, 1)
    const b = h('button', { class: 'pv-thumb', 'data-i': String(pv.i), onclick: () => goPage(pv.i) },
      h('div', { class: 'pv-th', style: { aspectRatio: v.width + ' / ' + v.height } }), h('span', {}, String(pv.i + 1)))
    thumbs.append(b)
    thumbIO.observe(b)
  }
  pdf.getOutline().then(items => {
    if (!items?.length) { outlineEl.append(h('div', { class: 'hint pv-empty' }, 'This PDF has no outline.')); return }
    const walk = (list: any[], depth: number): Node[] => list.flatMap(it => [
      h('button', { class: 'pv-ol', style: { paddingLeft: 8 + depth * 14 + 'px' }, title: it.title, onclick: () => it.dest ? goDest(it.dest) : it.url && window.open(it.url, '_blank', 'noopener') }, it.title),
      ...walk(it.items || [], depth + 1)
    ])
    outlineEl.append(...walk(items, 0))
  }).catch(() => {})

  // ---------- info ----------
  pdf.getMetadata().then(({ info }: any) => {
    const v = vpFor(pvs[0], 1)
    const mm = (pt: number) => Math.round(pt / 72 * 25.4)
    const date = (s?: string) => { const d = s && pdfjs.PDFDateString.toDateObject(s); return d ? d.toLocaleString() : '' }
    const rows: [string, string][] = [
      ['File', name], ['Pages', String(pdf.numPages)], ['Page size', `${mm(v.width)} × ${mm(v.height)} mm`], ['File size', (src.data.byteLength / 1048576).toFixed(2) + ' MB'],
      ['Title', info?.Title || ''], ['Author', info?.Author || ''], ['Subject', info?.Subject || ''], ['Keywords', info?.Keywords || ''],
      ['Created', date(info?.CreationDate)], ['Modified', date(info?.ModDate)], ['Creator', info?.Creator || ''], ['Producer', info?.Producer || ''], ['PDF version', info?.PDFFormatVersion || '']
    ]
    infoEl.append(...rows.filter(r => r[1]).map(([k, val]) => h('div', { class: 'pv-row' }, h('span', {}, k), h('span', { title: val }, val))))
    if (!ex.editable) infoEl.append(h('div', { class: 'hint pv-empty' }, 'This PDF is protected, so it can be read but not marked up.'))
  }).catch(() => {})

  // ---------- search ----------
  const pageText: (string | null)[] = new Array(pvs.length).fill(null)
  async function textOf(i: number) {
    if (pageText[i] == null) {
      const tc = await pvs[i].page.getTextContent()
      pageText[i] = tc.items.map((it: any) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('')
    }
    return pageText[i]!
  }
  let hits: { page: number; at: number }[] = []
  let hitIdx = -1
  let searchRun = 0
  let searching = false
  async function runSearch() {
    const q = searchIn.value.trim()
    query = q.toLowerCase()
    const run = ++searchRun
    hits = []; hitIdx = -1
    results.innerHTML = ''
    searchCount.textContent = ''
    pvs.forEach(markSearch)
    findShow()
    if (!q) return
    searchCount.textContent = '…'
    searching = true
    findShow()
    for (let i = 0; i < pvs.length; i++) {
      const t = await textOf(i)
      if (run !== searchRun) return
      const low = t.toLowerCase()
      let at = low.indexOf(query)
      while (at >= 0) {
        const n = hits.push({ page: i, at })
        if (n <= 500) {
          const pre = t.slice(Math.max(0, at - 40), at).replace(/\s+/g, ' ')
          const post = t.slice(at + q.length, at + q.length + 60).replace(/\s+/g, ' ')
          const k = n - 1
          results.append(h('button', { class: 'pv-hit', onclick: () => showHit(k) },
            h('span', { class: 'mute' }, 'p. ' + (i + 1)), h('span', { html: esc(pre) + '<mark>' + esc(t.slice(at, at + q.length)) + '</mark>' + esc(post) })))
        }
        at = low.indexOf(query, at + query.length)
      }
      searchCount.textContent = hits.length ? hits.length + (hits.length === 1 ? ' match' : ' matches') : (i < pvs.length - 1 ? '…' : '')
    }
    searchCount.textContent = hits.length ? hits.length + (hits.length === 1 ? ' match' : ' matches') : 'No matches'
    searching = false
    if (hits.length) showHit(0)
    findShow()
  }
  function showHit(k: number) {
    if (!hits.length) return
    hitIdx = (k + hits.length) % hits.length
    results.querySelectorAll('.on').forEach(e => e.classList.remove('on'))
    const b = results.children[hitIdx] as HTMLElement | undefined
    b?.classList.add('on'); b?.scrollIntoView({ block: 'nearest' })
    const pv = pvs[hits[hitIdx].page]
    goPage(pv.i)
    findShow()
    const tryScroll = () => {
      const m = pv.textEl?.querySelectorAll('.hl')
      if (!m?.length) return false
      const before = hits.slice(0, hitIdx).filter(x => x.page === pv.i).length
      const el = m[Math.min(before, m.length - 1)] as HTMLElement
      pv.textEl!.querySelectorAll('.hl.cur').forEach(e => e.classList.remove('cur'))
      el.classList.add('cur')
      const r = el.getBoundingClientRect(), d = desk.getBoundingClientRect()
      desk.scrollTop += r.top - d.top - desk.clientHeight / 3
      return true
    }
    if (!tryScroll()) { let n = 0; const t = setInterval(() => { if (tryScroll() || ++n > 20) clearInterval(t) }, 100) }
  }
  function markSearch(pv: PV) {
    if (!pv.textEl) return
    pv.textEl.querySelectorAll('span.hl').forEach(m => m.replaceWith(m.textContent || ''))
    pv.textEl.normalize()
    if (!query) return
    for (const span of Array.from(pv.textEl.querySelectorAll(':scope > span, .markedContent > span')) as HTMLElement[]) {
      const t = span.textContent || ''
      const low = t.toLowerCase()
      if (!low.includes(query)) continue
      const frag = document.createDocumentFragment()
      let i = 0, at = low.indexOf(query)
      while (at >= 0) {
        frag.append(t.slice(i, at), h('span', { class: 'hl' }, t.slice(at, at + query.length)))
        i = at + query.length
        at = low.indexOf(query, i)
      }
      frag.append(t.slice(i))
      span.replaceChildren(frag)
    }
  }
  searchIn.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); if (searchIn.value.trim().toLowerCase() === query && hits.length) showHit(hitIdx + (e.shiftKey ? -1 : 1)); else runSearch() }
    if (e.key === 'Escape') { searchIn.value = ''; runSearch(); desk.focus() }
  }
  searchIn.addEventListener('search', () => { if (!searchIn.value) runSearch() })
  searchIn.addEventListener('input', () => { if (findIn.value !== searchIn.value) findIn.value = searchIn.value })

  // Floating find bar (Ctrl+F). It drives the same search as the Search tab, which keeps the full result list.
  const findIn = h('input', { type: 'text', placeholder: 'Find in PDF', 'aria-label': 'Find in PDF', spellcheck: 'false' }) as HTMLInputElement
  const findCount = h('span', { class: 'fcount' })
  const findEl = h('div', { class: 'findp pvf', role: 'search', hidden: true },
    h('div', { class: 'frow' }, findIn, findCount,
      h('button', { class: 'ic', title: 'Previous match (Shift+Enter)', 'aria-label': 'Previous match', onclick: () => stepHit(-1) }, '↑'),
      h('button', { class: 'ic', title: 'Next match (Enter)', 'aria-label': 'Next match', onclick: () => stepHit(1) }, '↓'),
      h('button', { class: 'ic', title: 'All results', 'aria-label': 'All results', onclick: () => { if (mid.classList.contains('no-r')) toggleSide('r'); if (rTab !== 1) showTab(rTabs, 1); findIn.focus() } }, '☰'),
      h('button', { class: 'ic', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => closeFind() }, '✕')))
  mid.append(findEl)
  let findTimer = 0
  function findShow() {
    const q = searchIn.value.trim()
    findCount.textContent = !q ? '' : hits.length ? `${Math.max(hitIdx, 0) + 1} of ${hits.length}` : searching ? '…' : 'No results'
    findCount.classList.toggle('bad', !!q && !hits.length && !searching)
  }
  function stepHit(d: number) {
    clearTimeout(findTimer)
    if (searchIn.value !== findIn.value || findIn.value.trim().toLowerCase() !== query) { searchIn.value = findIn.value; runSearch() }
    else showHit(hitIdx + d)
  }
  function openFind() {
    const picked = (getSelection()?.toString() || '').trim()
    findEl.hidden = false
    if (picked && picked.length < 200 && !picked.includes('\n')) { findIn.value = searchIn.value = picked; runSearch() }
    else findIn.value = searchIn.value
    findIn.focus(); findIn.select()
    findShow()
  }
  function closeFind() {
    clearTimeout(findTimer)
    findEl.hidden = true
    findIn.value = searchIn.value = ''
    runSearch()
    desk.focus()
  }
  findIn.addEventListener('input', () => {
    clearTimeout(findTimer)
    findTimer = window.setTimeout(() => { searchIn.value = findIn.value; runSearch() }, 200)
  })
  findIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind() }
  })

  // ---------- annotations: drawing ----------
  const SVGNS = 'http://www.w3.org/2000/svg'
  function annoMarkup(list: Annot[], vp: PageViewport, s: number, sel: string | null, forPrint = false) {
    const P = (x: number, y: number) => vp.convertToViewportPoint(x, y) as number[]
    const pts = (a: number[]) => { const o: string[] = []; for (let i = 0; i < a.length; i += 2) { const p = P(a[i], a[i + 1]); o.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)) } return o }
    const box = (r: number[]) => { const a = P(r[0], r[1]), b = P(r[2], r[3]); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] }
    let svg = ''
    const html: HTMLElement[] = []
    for (const a of list) {
      const id = esc(a.id), c = a.color, op = a.opacity
      const g = (body: string, hit = '') => { svg += `<g class="an" data-id="${id}" style="opacity:${op}">${body}${hit}</g>` }
      switch (a.type) {
        case 'ink': {
          const w = Math.max(0.5, a.width * s)
          const d = a.paths.map(p => { const q = pts(p.length === 2 ? [p[0], p[1], p[0] + 0.01, p[1]] : p); return 'M' + q.join('L') }).join('')
          svg += `<g class="an${a.marker ? ' mk' : ''}" data-id="${id}" style="opacity:${op}"><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/><path class="hit" d="${d}" stroke-width="${Math.max(w, 12)}"/></g>`
          break
        }
        case 'rect': {
          const q = pts([a.rect[0], a.rect[1], a.rect[2], a.rect[1], a.rect[2], a.rect[3], a.rect[0], a.rect[3]]).join(' ')
          g(`<polygon points="${q}" fill="none" stroke="${c}" stroke-width="${a.width * s}" stroke-linejoin="round"/>`, `<polygon class="hit" points="${q}" stroke-width="${Math.max(a.width * s, 12)}"/>`)
          break
        }
        case 'ellipse': {
          const b = box(a.rect), e = `cx="${(b[0] + b[2]) / 2}" cy="${(b[1] + b[3]) / 2}" rx="${(b[2] - b[0]) / 2}" ry="${(b[3] - b[1]) / 2}"`
          g(`<ellipse ${e} fill="none" stroke="${c}" stroke-width="${a.width * s}"/>`, `<ellipse class="hit" ${e} stroke-width="${Math.max(a.width * s, 12)}"/>`)
          break
        }
        case 'arrow': case 'line': {
          const [p1, p2] = [P(a.pts[0], a.pts[1]), P(a.pts[2], a.pts[3])]
          const w = a.width * s
          let head = ''
          if (a.type === 'arrow') {
            const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), L = (a.width * 4 + 6) * s
            const q = (d: number) => `${p2[0] - L * Math.cos(ang + d)},${p2[1] - L * Math.sin(ang + d)}`
            head = `<polyline points="${q(0.45)} ${p2[0]},${p2[1]} ${q(-0.45)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
          }
          const ln = `x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}"`
          g(`<line ${ln} stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>${head}`, `<line class="hit" ${ln} stroke-width="${Math.max(w, 12)}"/>`)
          break
        }
        case 'highlight': case 'underline': case 'strike': {
          let body = ''
          for (let i = 0; i + 8 <= a.quads.length; i += 8) {
            const q = a.quads, b = box([q[i], q[i + 5], q[i + 2], q[i + 1]])
            const hgt = (q[i + 1] - q[i + 5]) * s
            if (a.type === 'highlight') body += `<rect class="fillhit" x="${b[0]}" y="${b[1]}" width="${b[2] - b[0]}" height="${b[3] - b[1]}" fill="${c}"/>`
            else {
              const yy = a.type === 'underline' ? q[i + 5] + (q[i + 1] - q[i + 5]) * 0.08 : q[i + 5] + (q[i + 1] - q[i + 5]) * 0.4
              const p1 = P(q[i], yy), p2 = P(q[i + 2], yy)
              body += `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="${c}" stroke-width="${Math.max(1, hgt * 0.07)}"/>`
              body += `<rect class="fillhit" x="${b[0]}" y="${b[1]}" width="${b[2] - b[0]}" height="${b[3] - b[1]}" fill="transparent"/>`
            }
          }
          svg += `<g class="an${a.type === 'highlight' ? ' mk' : ''}" data-id="${id}" style="opacity:${a.type === 'highlight' ? Math.min(op, 0.45) : op}">${body}</g>`
          break
        }
        case 'text': {
          const b = box(a.rect)
          html.push(h('div', { class: 'an pv-text', 'data-id': a.id, style: { left: b[0] + 'px', top: b[1] + 'px', width: b[2] - b[0] + 'px', minHeight: b[3] - b[1] + 'px', fontSize: a.size * s + 'px', padding: 3 * s + 'px', color: c, opacity: String(op) } }, a.contents))
          break
        }
        case 'note': {
          if (forPrint) break
          const p = P(a.x, a.y)
          const sz = 22
          const off = rot === 0 ? [0, 0] : rot === 90 ? [-sz, 0] : rot === 180 ? [-sz, -sz] : [0, -sz]
          html.push(h('div', { class: 'an pv-note' + (a.replies.length ? ' has' : ''), 'data-id': a.id, title: (a.author ? a.author + ': ' : '') + (a.contents || 'Comment'), style: { left: p[0] + off[0] + 'px', top: p[1] + off[1] + 'px', background: c } }, icon('comment')))
          break
        }
      }
    }
    if (sel && !forPrint) {
      const a = list.find(x => x.id === sel)
      if (a && a.type !== 'note') {
        const b = box(bounds(a))
        svg += `<rect class="selbox" x="${b[0] - 3}" y="${b[1] - 3}" width="${b[2] - b[0] + 6}" height="${b[3] - b[1] + 6}"/>`
        if (a.type === 'rect' || a.type === 'ellipse' || a.type === 'text') svg += `<rect class="handle" data-h="br" x="${b[2] - 2}" y="${b[3] - 2}" width="10" height="10"/>`
        if (a.type === 'arrow' || a.type === 'line') {
          const p1 = P(a.pts[0], a.pts[1]), p2 = P(a.pts[2], a.pts[3])
          svg += `<circle class="handle" data-h="p1" cx="${p1[0]}" cy="${p1[1]}" r="5"/><circle class="handle" data-h="p2" cx="${p2[0]}" cy="${p2[1]}" r="5"/>`
        }
      }
    }
    return { svg: `<svg xmlns="${SVGNS}" width="${vp.width}" height="${vp.height}">${svg}</svg>`, html }
  }

  function drawAnno(pv: PV) {
    const list = annots.filter(a => a.page === pv.i)
    const { svg, html } = annoMarkup(list, pv.vp, scale, selId)
    pv.anno.innerHTML = svg
    pv.anno.append(...html)
    if (selId) pv.anno.querySelector(`[data-id="${CSS.escape(selId)}"]`)?.classList.add('sel')
  }
  const redrawPage = (i: number) => { if (pvs[i]) drawAnno(pvs[i]) }
  const redrawAll = () => pvs.forEach(drawAnno)

  // ---------- annotations: editing ----------
  const snapshot = () => JSON.stringify(annots)
  function pushUndo(s = snapshot()) { undo.push(s); if (undo.length > 200) undo.shift(); redo.length = 0; updUndo() }
  function updUndo() { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length }
  function mutate(fn: () => void, pages?: number[]) {
    if (!ex.editable) { toast('This PDF is protected and cannot be marked up.'); return }
    pushUndo()
    fn()
    changed(pages)
  }
  function changed(pages?: number[]) {
    dirty = true
    updStatus()
    if (selId && !annots.some(a => a.id === selId)) selId = null
    if (pages) new Set(pages).forEach(redrawPage); else redrawAll()
    renderComments()
    placePop()
  }
  function doUndo() {
    const s = undo.pop(); if (s == null) return
    redo.push(snapshot()); annots = JSON.parse(s); updUndo(); changed()
  }
  function doRedo() {
    const s = redo.pop(); if (s == null) return
    undo.push(snapshot()); annots = JSON.parse(s); updUndo(); changed()
  }
  const byId = (id: string | null) => annots.find(a => a.id === id) || null
  function select(id: string | null) {
    const prev = byId(selId)
    selId = id
    if (prev) redrawPage(prev.page)
    const a = byId(id)
    if (a && a.page !== prev?.page) redrawPage(a.page)
    commentsEl.querySelectorAll('.pv-card.on').forEach(e => e.classList.remove('on'))
    if (id) { const card = commentsEl.querySelector(`[data-card="${CSS.escape(id)}"]`); card?.classList.add('on'); card?.scrollIntoView({ block: 'nearest' }) }
    placePop()
  }
  function applyToSel(fn: (a: Annot) => void) {
    const a = byId(selId)
    if (!a) return
    mutate(() => fn(a), [a.page])
  }

  function author() { return pref('author', '') }
  async function askAuthor(force = false): Promise<string> {
    let a = author()
    if (a && !force) return a
    const v = await promptBox('Your name', 'Shown on your comments and markup', a || '', 'Save')
    if (v != null) { a = v.trim(); setPref('author', a) }
    return a
  }
  function newBase(page: number, color: string) {
    return { id: uid('a'), page, author: author(), date: Date.now(), color, opacity: 1, contents: '', replies: [] as any[] }
  }

  // floating toolbar for the selected annotation
  function placePop() {
    const a = byId(selId)
    if (!a || disposed) { pop.hidden = true; return }
    const pv = pvs[a.page]
    const el = pv.anno.querySelector(`[data-id="${CSS.escape(a.id)}"]`) as Element | null
    const r = (el || pv.el).getBoundingClientRect()
    const d = desk.getBoundingClientRect()
    if (r.bottom < d.top || r.top > d.bottom) { pop.hidden = true; return }
    pop.innerHTML = ''
    for (const c of COLORS) pop.append(h('button', { class: 'pv-dot' + (c === a.color ? ' on' : ''), style: { background: c }, title: c, onclick: () => applyToSel(x => { x.color = c; colors[toolFor(x)] = c; setPref('colors', JSON.stringify(colors)) }) }))
    pop.append(h('span', { class: 'sep' }))
    if (a.type === 'text') pop.append(h('button', { class: 'ic', title: 'Edit text', onclick: () => editText(a.id) }, icon('edit')))
    pop.append(h('button', { class: 'ic', title: 'Comment', onclick: () => focusComment(a.id) }, icon('comment')))
    pop.append(h('button', { class: 'ic', title: 'Delete (Del)', onclick: () => del(a.id) }, icon('trash')))
    pop.hidden = false
    const pr = pop.getBoundingClientRect()
    const y = r.top - pr.height - 8 > d.top ? r.top - pr.height - 8 : r.bottom + 8
    pop.style.top = clamp(y, d.top + 4, d.bottom - pr.height - 4) + 'px'
    pop.style.left = clamp(r.left + r.width / 2 - pr.width / 2, d.left + 4, d.right - pr.width - 4) + 'px'
  }
  const toolFor = (a: Annot): Tool => a.type === 'ink' ? (a.marker ? 'marker' : 'pen') : a.type === 'line' ? 'arrow' : a.type as Tool
  function del(id: string) {
    const a = byId(id); if (!a) return
    mutate(() => { annots = annots.filter(x => x.id !== id) }, [a.page])
  }

  function setTool(t: Tool) {
    if (!ex.editable && t !== 'select' && t !== 'hand') { toast('This PDF is protected and cannot be marked up.'); return }
    tool = t
    toolBtns.forEach((b, k) => b.classList.toggle('on', k === t))
    desk.dataset.tool = t
    ws.classList.toggle('pv-drawing', DRAW.has(t))
    swatches.innerHTML = ''
    const showColor = t !== 'select' && t !== 'hand' && t !== 'eraser'
    if (showColor) for (const c of COLORS) swatches.append(h('button', { class: 'pv-dot' + (c === colorOf(t) ? ' on' : ''), style: { background: c }, title: c, onclick: () => { colors[t] = c; setPref('colors', JSON.stringify(colors)); setTool(t) } }))
    widthSel.hidden = !['pen', 'rect', 'ellipse', 'arrow'].includes(t)
    sizeSel.hidden = t !== 'text'
    if (t !== 'select') select(null)
    selPop.hidden = true
  }

  // ---------- pointer input ----------
  const pageAt = (e: { clientX: number; clientY: number }) => {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.pv-page') as HTMLElement | null
    return el ? pvs[+el.dataset.i!] : null
  }
  const toPdf = (pv: PV, e: { clientX: number; clientY: number }) => {
    const r = pv.el.getBoundingClientRect()
    return pv.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top) as number[]
  }
  function hitTest(pv: PV, e: PointerEvent): string | null {
    const els = document.elementsFromPoint(e.clientX, e.clientY)
    for (const el of els) { const an = (el as HTMLElement).closest?.('.an') as HTMLElement | null; if (an && pv.anno.contains(an)) return an.dataset.id || null }
    return null
  }

  let drag: null | { kind: string; pv: PV; id?: string; start: number[]; last: number[]; snap?: string; moved?: boolean; el?: SVGElement; pts?: number[]; sx?: number; sy?: number; sl?: number; st?: number } = null

  desk.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') {
      if (e.button === 1) { e.preventDefault(); startPan(e) }
      return
    }
    if ((e.target as HTMLElement).closest('textarea')) return
    selPop.hidden = true
    if (tool === 'hand' || spaceDown) { e.preventDefault(); startPan(e); return }
    const pv = pageAt(e)
    if (!pv) { if (tool === 'select') select(null); return }
    const p = toPdf(pv, e)
    if (tool === 'select') {
      const hd = (e.target as Element).closest?.('[data-h]') as HTMLElement | null
      if (hd && selId) { e.preventDefault(); drag = { kind: 'resize-' + hd.dataset.h, pv, id: selId, start: p, last: p, snap: snapshot() }; desk.setPointerCapture(e.pointerId); return }
      const id = hitTest(pv, e)
      if (id) {
        e.preventDefault()
        if (id !== selId) select(id)
        drag = { kind: 'move', pv, id, start: p, last: p, snap: snapshot() }
        desk.setPointerCapture(e.pointerId)
      } else if (selId) select(null)
      return
    }
    if (!DRAW.has(tool)) return
    e.preventDefault()
    desk.setPointerCapture(e.pointerId)
    if (tool === 'eraser') { drag = { kind: 'erase', pv, start: p, last: p, snap: snapshot() }; erase(e); return }
    if (tool === 'note') { addNote(pv, p); return }
    if (tool === 'text') { drag = { kind: 'text', pv, start: p, last: p }; return }
    const svg = pv.anno.querySelector('svg')!
    const c = colorOf(tool)
    let el: SVGElement
    if (tool === 'pen' || tool === 'marker') {
      el = document.createElementNS(SVGNS, 'path')
      const w = (tool === 'marker' ? 14 : penW) * scale
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', c); el.setAttribute('stroke-width', String(w)); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round')
      if (tool === 'marker') el.setAttribute('style', 'opacity:.4;mix-blend-mode:multiply')
    } else if (tool === 'ellipse') {
      el = document.createElementNS(SVGNS, 'ellipse'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', c); el.setAttribute('stroke-width', String(penW * scale))
    } else if (tool === 'rect') {
      el = document.createElementNS(SVGNS, 'rect'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', c); el.setAttribute('stroke-width', String(penW * scale))
    } else {
      el = document.createElementNS(SVGNS, 'path'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', c); el.setAttribute('stroke-width', String(penW * scale)); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round')
    }
    svg.append(el)
    drag = { kind: 'draw', pv, start: p, last: p, el, pts: [p[0], p[1]] }
    previewDraw(e)
  })

  function startPan(e: PointerEvent) {
    drag = { kind: 'pan', pv: pvs[0], start: [], last: [], sx: e.clientX, sy: e.clientY, sl: desk.scrollLeft, st: desk.scrollTop }
    desk.setPointerCapture(e.pointerId)
    desk.classList.add('panning')
  }

  function previewDraw(e: PointerEvent) {
    if (!drag?.el) return
    const pv = drag.pv, r = pv.el.getBoundingClientRect()
    const sp = pv.vp.convertToViewportPoint(drag.start[0], drag.start[1]) as number[]
    const x = e.clientX - r.left, y = e.clientY - r.top
    if (tool === 'pen' || tool === 'marker') {
      const q: string[] = []
      for (let i = 0; i < drag.pts!.length; i += 2) { const v = pv.vp.convertToViewportPoint(drag.pts![i], drag.pts![i + 1]) as number[]; q.push(v[0].toFixed(1) + ',' + v[1].toFixed(1)) }
      if (q.length === 1) q.push(q[0])
      drag.el.setAttribute('d', 'M' + q.join('L'))
    } else if (tool === 'rect') {
      drag.el.setAttribute('x', String(Math.min(sp[0], x))); drag.el.setAttribute('y', String(Math.min(sp[1], y)))
      drag.el.setAttribute('width', String(Math.abs(x - sp[0]))); drag.el.setAttribute('height', String(Math.abs(y - sp[1])))
    } else if (tool === 'ellipse') {
      drag.el.setAttribute('cx', String((sp[0] + x) / 2)); drag.el.setAttribute('cy', String((sp[1] + y) / 2))
      drag.el.setAttribute('rx', String(Math.abs(x - sp[0]) / 2)); drag.el.setAttribute('ry', String(Math.abs(y - sp[1]) / 2))
    } else if (tool === 'arrow') {
      const ang = Math.atan2(y - sp[1], x - sp[0]), L = (penW * 4 + 6) * scale
      const q = (d: number) => `${x - L * Math.cos(ang + d)},${y - L * Math.sin(ang + d)}`
      drag.el.setAttribute('d', `M${sp[0]},${sp[1]}L${x},${y}M${q(0.45)}L${x},${y}L${q(-0.45)}`)
    }
  }

  function erase(e: PointerEvent) {
    if (!drag) return
    const pv = pageAt(e) || drag.pv
    const id = hitTest(pv, e)
    if (!id) return
    if (drag.snap) { pushUndo(drag.snap); drag.snap = undefined }
    annots = annots.filter(a => a.id !== id)
    changed([pv.i])
  }

  desk.addEventListener('pointermove', e => {
    if (!drag) return
    if (drag.kind === 'pan') { desk.scrollLeft = drag.sl! - (e.clientX - drag.sx!); desk.scrollTop = drag.st! - (e.clientY - drag.sy!); return }
    if (drag.kind === 'erase') { erase(e); return }
    const p = toPdf(drag.pv, e)
    if (drag.kind === 'draw') {
      if (tool === 'pen' || tool === 'marker') {
        const n = drag.pts!.length, dx = p[0] - drag.pts![n - 2], dy = p[1] - drag.pts![n - 1]
        if (dx * dx + dy * dy * 1 > (0.6 / scale) ** 2) drag.pts!.push(p[0], p[1])
      }
      drag.last = p
      previewDraw(e)
      return
    }
    if (drag.kind === 'text') { drag.last = p; return }
    const a = byId(drag.id!)
    if (!a) return
    const dx = p[0] - drag.last[0], dy = p[1] - drag.last[1]
    if (!drag.moved) {
      const s0 = drag.pv.vp.convertToViewportPoint(drag.start[0], drag.start[1]) as number[], s1 = drag.pv.vp.convertToViewportPoint(p[0], p[1]) as number[]
      if (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < 3) return
      drag.moved = true
    }
    if (drag.kind === 'move') translate(a, dx, dy)
    else if (drag.kind === 'resize-br' && (a.type === 'rect' || a.type === 'ellipse' || a.type === 'text')) {
      // move whichever corner sits at the bottom-right on screen
      const r = a.rect
      const corners = [[0, 1], [2, 1], [2, 3], [0, 3]] as const
      let best = 0, bv = -Infinity
      corners.forEach(([xi, yi], k) => { const v = drag!.pv.vp.convertToViewportPoint(r[xi], r[yi]) as number[]; if (v[0] + v[1] > bv) { bv = v[0] + v[1]; best = k } })
      const [xi, yi] = corners[best]
      r[xi] += dx; r[yi] += dy
    } else if (drag.kind === 'resize-p1' && (a.type === 'arrow' || a.type === 'line')) { a.pts[0] += dx; a.pts[1] += dy }
    else if (drag.kind === 'resize-p2' && (a.type === 'arrow' || a.type === 'line')) { a.pts[2] += dx; a.pts[3] += dy }
    drag.last = p
    drawAnno(drag.pv)
    pop.hidden = true
  })

  const endDrag = (e: PointerEvent) => {
    const d = drag
    drag = null
    desk.classList.remove('panning')
    if (!d) return
    try { desk.releasePointerCapture(e.pointerId) } catch {}
    if (d.kind === 'pan' || d.kind === 'erase') return
    const pv = d.pv
    if (d.kind === 'move' || d.kind.startsWith('resize')) {
      if (d.moved) {
        const a = byId(d.id!)
        if (a && (a.type === 'rect' || a.type === 'ellipse' || a.type === 'text')) a.rect = norm(a.rect)
        pushUndo(d.snap); changed([pv.i])
      } else placePop()
      return
    }
    if (d.kind === 'text') {
      const s0 = pv.vp.convertToViewportPoint(d.start[0], d.start[1]) as number[], s1 = pv.vp.convertToViewportPoint(d.last[0], d.last[1]) as number[]
      let rect: number[]
      if (Math.abs(s1[0] - s0[0]) > 12 && Math.abs(s1[1] - s0[1]) > 8) rect = norm([d.start[0], d.start[1], d.last[0], d.last[1]])
      else {
        const b = pv.vp.convertToPdfPoint(s0[0] + 220 * scale, s0[1] + textSize * 1.25 * scale + 6 * scale) as number[]
        rect = norm([d.start[0], d.start[1], b[0], b[1]])
      }
      const a: Annot = { ...newBase(pv.i, colorOf('text')), type: 'text', rect, size: textSize }
      mutate(() => annots.push(a), [pv.i])
      select(a.id)
      editText(a.id, true)
      return
    }
    if (d.kind !== 'draw') return
    d.el?.remove()
    let a: Annot | null = null
    const c = colorOf(tool)
    if (tool === 'pen' || tool === 'marker') {
      if (d.pts!.length >= 2) a = { ...newBase(pv.i, c), type: 'ink', width: tool === 'marker' ? 14 : penW, paths: [simplify(d.pts!, 0.35 / scale)], marker: tool === 'marker', opacity: tool === 'marker' ? 0.4 : 1 }
    } else {
      const s0 = pv.vp.convertToViewportPoint(d.start[0], d.start[1]) as number[], s1 = pv.vp.convertToViewportPoint(d.last[0], d.last[1]) as number[]
      if (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < 4) { redrawPage(pv.i); return }
      if (tool === 'rect' || tool === 'ellipse') a = { ...newBase(pv.i, c), type: tool, width: penW, rect: norm([d.start[0], d.start[1], d.last[0], d.last[1]]) }
      else if (tool === 'arrow') a = { ...newBase(pv.i, c), type: 'arrow', width: penW, pts: [d.start[0], d.start[1], d.last[0], d.last[1]] }
    }
    if (a) { const x = a; mutate(() => annots.push(x), [pv.i]) } else redrawPage(pv.i)
  }
  desk.addEventListener('pointerup', endDrag)
  desk.addEventListener('pointercancel', endDrag)

  desk.addEventListener('dblclick', e => {
    if (tool !== 'select') return
    const pv = pageAt(e); if (!pv) return
    const id = hitTest(pv, e as PointerEvent)
    const a = byId(id)
    if (a?.type === 'text') editText(a.id)
    else if (a) focusComment(a.id)
  })

  function simplify(p: number[], tol: number): number[] {
    if (p.length <= 4) return p
    const keep = new Uint8Array(p.length / 2); keep[0] = 1; keep[keep.length - 1] = 1
    const stack: [number, number][] = [[0, keep.length - 1]]
    while (stack.length) {
      const [a, b] = stack.pop()!
      let md = 0, mi = -1
      const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1], L = Math.hypot(bx - ax, by - ay) || 1e-9
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - p[i * 2 + 1]) - (ax - p[i * 2]) * (by - ay)) / L
        if (d > md) { md = d; mi = i }
      }
      if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
    }
    const out: number[] = []
    keep.forEach((k, i) => { if (k) out.push(+p[i * 2].toFixed(2), +p[i * 2 + 1].toFixed(2)) })
    return out
  }

  async function addNote(pv: PV, p: number[]) {
    await askAuthor()
    const sp = pv.vp.convertToViewportPoint(p[0], p[1]) as number[]
    const tl = pv.vp.convertToPdfPoint(sp[0] - 4, sp[1] - 4) as number[]
    const a: Annot = { ...newBase(pv.i, colorOf('note')), type: 'note', x: tl[0], y: tl[1] }
    mutate(() => annots.push(a), [pv.i])
    setTool('select')
    select(a.id)
    focusComment(a.id)
  }

  function editText(id: string, isNew = false) {
    const a = byId(id)
    if (!a || a.type !== 'text') return
    const pv = pvs[a.page]
    const el = pv.anno.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null
    if (!el) return
    const ta = h('textarea', { class: 'pv-textedit', spellcheck: true }) as HTMLTextAreaElement
    ta.value = a.contents
    Object.assign(ta.style, { left: el.style.left, top: el.style.top, width: el.style.width, minHeight: el.style.minHeight, fontSize: el.style.fontSize, padding: el.style.padding, color: a.color })
    el.style.visibility = 'hidden'
    pv.anno.append(ta)
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
    grow()
    ta.oninput = grow
    pop.hidden = true
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) })
    const before = snapshot()
    let done = false
    const finish = (keep: boolean) => {
      if (done) return
      done = true
      const v = ta.value.replace(/\s+$/, '')
      const r = ta.getBoundingClientRect(), pr = pv.el.getBoundingClientRect()
      ta.remove()
      const cur = byId(id)
      if (!cur || cur.type !== 'text') return
      if (!keep && isNew) { annots = annots.filter(x => x.id !== id); undo.pop(); updUndo(); changed([pv.i]); return }
      if (!v) { annots = annots.filter(x => x.id !== id); if (isNew) { undo.pop(); updUndo() } else pushUndo(before); changed([pv.i]); return }
      if (v === cur.contents && !isNew) { redrawPage(pv.i); placePop(); return }
      const p1 = pv.vp.convertToPdfPoint(r.left - pr.left, r.top - pr.top) as number[], p2 = pv.vp.convertToPdfPoint(r.right - pr.left, r.bottom - pr.top) as number[]
      cur.contents = v
      cur.rect = norm([p1[0], p1[1], p2[0], p2[1]])
      if (!isNew) pushUndo(before)
      changed([pv.i])
    }
    ta.onblur = () => finish(true)
    ta.onkeydown = e => {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); ta.blur() }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur() }
    }
  }

  // ---------- text markup ----------
  function selectionQuads(): { pv: PV; quads: number[]; text: string }[] {
    const sel = getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return []
    const range = sel.getRangeAt(0)
    const anc = range.commonAncestorContainer as Node
    if (!desk.contains(anc)) return []
    const byPage = new Map<PV, DOMRect[]>()
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue
      const pv = pvs.find(p => { const b = p.el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom })
      if (!pv) continue
      if (!byPage.has(pv)) byPage.set(pv, [])
      byPage.get(pv)!.push(r)
    }
    const out: { pv: PV; quads: number[]; text: string }[] = []
    for (const [pv, rects] of byPage) {
      const pr = pv.el.getBoundingClientRect()
      // merge rects on the same line
      rects.sort((a, b) => a.top - b.top || a.left - b.left)
      const lines: { l: number; t: number; r: number; b: number }[] = []
      for (const r of rects) {
        const last = lines[lines.length - 1]
        if (last && Math.abs((r.top + r.bottom) / 2 - (last.t + last.b) / 2) < Math.min(r.height, last.b - last.t) * 0.5 && r.left <= last.r + r.height) {
          last.l = Math.min(last.l, r.left); last.r = Math.max(last.r, r.right); last.t = Math.min(last.t, r.top); last.b = Math.max(last.b, r.bottom)
        } else lines.push({ l: r.left, t: r.top, r: r.right, b: r.bottom })
      }
      const quads: number[] = []
      for (const ln of lines) {
        const a = pv.vp.convertToPdfPoint(ln.l - pr.left, ln.t - pr.top) as number[], b = pv.vp.convertToPdfPoint(ln.r - pr.left, ln.b - pr.top) as number[]
        const [x1, y1, x2, y2] = norm([a[0], a[1], b[0], b[1]])
        quads.push(x1, y2, x2, y2, x1, y1, x2, y1)
      }
      if (quads.length) out.push({ pv, quads, text: sel.toString() })
    }
    return out
  }
  function markSelection(kind: 'highlight' | 'underline' | 'strike', comment = false) {
    const qs = selectionQuads()
    if (!qs.length) return
    const made: Annot[] = qs.map(q => ({ ...newBase(q.pv.i, colorOf(kind)), type: kind, quads: q.quads }))
    mutate(() => annots.push(...made), made.map(a => a.page))
    getSelection()?.removeAllRanges()
    selPop.hidden = true
    if (comment) { setTool('select'); select(made[0].id); focusComment(made[0].id) }
  }
  const onMouseUp = (e: MouseEvent) => {
    desk.querySelectorAll('.textLayer.selecting').forEach(t => t.classList.remove('selecting'))
    if (drag || !desk.contains(e.target as Node)) return
    setTimeout(() => {
      if (MARKUP.has(tool)) { markSelection(tool as any); return }
      if (tool !== 'select' || !ex.editable) return
      const sel = getSelection()
      if (!sel || sel.isCollapsed || !desk.contains(sel.anchorNode)) { selPop.hidden = true; return }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      selPop.innerHTML = ''
      selPop.append(
        h('button', { class: 'ic', title: 'Highlight', onclick: () => markSelection('highlight') }, icon('highlight')),
        h('button', { class: 'ic', title: 'Underline', onclick: () => markSelection('underline') }, icon('underline')),
        h('button', { class: 'ic', title: 'Strike out', onclick: () => markSelection('strike') }, icon('strike')),
        h('span', { class: 'sep' }),
        h('button', { class: 'ic', title: 'Highlight and comment', onclick: async () => { await askAuthor(); markSelection('highlight', true) } }, icon('comment')),
        h('button', { class: 'ic', title: 'Copy', onclick: () => { navigator.clipboard?.writeText(sel.toString()); selPop.hidden = true } }, icon('copy')))
      selPop.hidden = false
      const pr = selPop.getBoundingClientRect()
      selPop.style.top = Math.max(50, r.top - pr.height - 8) + 'px'
      selPop.style.left = clamp(r.left + r.width / 2 - pr.width / 2, 4, innerWidth - pr.width - 4) + 'px'
    })
  }
  document.addEventListener('mouseup', onMouseUp)
  const onSelChange = () => { const s = getSelection(); if (!s || s.isCollapsed) selPop.hidden = true }
  document.addEventListener('selectionchange', onSelChange)

  // ---------- comments panel ----------
  function focusComment(id: string) {
    if (mid.classList.contains('no-r')) toggleSide('r')
    if (rTab !== 0) showTab(rTabs, 0)
    renderComments()
    select(id)
    const card = commentsEl.querySelector(`[data-card="${CSS.escape(id)}"]`)
    const ta = card?.querySelector('textarea, input') as HTMLElement | null
    setTimeout(() => ta?.focus(), 30)
  }
  function scrollToAnnot(a: Annot) {
    const pv = pvs[a.page]
    const b = bounds(a)
    const p = pv.vp.convertToViewportPoint(b[0], b[3]) as number[]
    desk.scrollTop = pv.el.offsetTop + p[1] - desk.clientHeight / 3
  }
  function renderComments() {
    if (commentsEl.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName !== 'BUTTON') return
    commentsEl.innerHTML = ''
    const sorted = annots.slice().sort((a, b) => a.page - b.page || bounds(b)[3] - bounds(a)[3] || bounds(a)[0] - bounds(b)[0])
    rTabs.children[0].textContent = 'Comments' + (annots.length ? ' ' + annots.length : '')
    if (!sorted.length) {
      commentsEl.append(h('div', { class: 'hint pv-empty' }, ex.editable ? 'No comments or markup yet. Select text to highlight it, or pick a review tool above to draw and comment.' : 'This PDF has no comments.'))
      return
    }
    for (const a of sorted) {
      let snap = ''
      const ta = a.type === 'text' ? null : h('textarea', { placeholder: a.type === 'note' ? 'Write a comment…' : 'Add a comment…', value: a.contents, rows: 1, spellcheck: true }) as HTMLTextAreaElement | null
      if (ta) {
        ta.value = a.contents
        const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(28, ta.scrollHeight) + 'px' }
        ta.onfocus = () => { snap = snapshot(); select(a.id) }
        ta.oninput = () => { a.contents = ta.value; grow(); dirty = true; updStatus(); if (a.type === 'note') redrawPage(a.page) }
        ta.onblur = () => { if (snap && snap !== snapshot()) pushUndo(snap); snap = ''; setTimeout(renderComments) }
        ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') ta.blur() }
        requestAnimationFrame(grow)
      }
      const reply = h('input', { type: 'text', class: 'pv-reply', placeholder: 'Reply…' }) as HTMLInputElement
      reply.onkeydown = async e => {
        e.stopPropagation()
        if (e.key === 'Escape') reply.blur()
        if (e.key !== 'Enter' || !reply.value.trim()) return
        const t = reply.value.trim()
        const who = await askAuthor()
        reply.value = ''
        reply.blur()
        mutate(() => a.replies.push({ id: uid('r'), author: who, date: Date.now(), text: t }), [a.page])
      }
      const card = h('div', { class: 'pv-card' + (a.id === selId ? ' on' : ''), 'data-card': a.id, onclick: (e: MouseEvent) => { if ((e.target as HTMLElement).closest('textarea,input,button')) return; select(a.id); scrollToAnnot(a) } },
        h('div', { class: 'pv-ch' },
          h('i', { style: { background: a.color } }),
          h('b', {}, TYPE_LABEL[a.type]),
          h('span', { class: 'mute' }, 'p. ' + (a.page + 1)),
          h('span', { class: 'sp' }),
          h('button', { class: 'ic', title: 'Delete', onclick: () => del(a.id) }, icon('trash'))),
        h('div', { class: 'pv-meta mute' }, (a.author || 'Unknown') + ' · ' + relTime(a.date)),
        a.type === 'text' ? h('div', { class: 'pv-quote' }, a.contents || '(empty)') : ta,
        ...a.replies.map(r => h('div', { class: 'pv-rep' },
          h('div', { class: 'pv-meta mute' }, (r.author || 'Unknown') + ' · ' + relTime(r.date),
            h('button', { class: 'ic', title: 'Delete reply', onclick: () => mutate(() => { a.replies = a.replies.filter(x => x !== r) }, [a.page]) }, icon('x'))),
          h('div', {}, r.text))),
        (a.contents || a.replies.length) && ex.editable ? reply : null)
      commentsEl.append(card)
    }
  }

  // ---------- save, open, print ----------
  function updStatus() {
    status.replaceChildren(h('i'), dirty ? 'Unsaved changes' : '')
    status.classList.toggle('saving', dirty)
    status.hidden = !dirty
    const t = (dirty ? '• ' : '') + name + ' — CocoaAuthor'
    document.title = t
    native?.setTitle(t)
  }
  async function save(as: boolean) {
    if (!ex.editable) { toast('This PDF is protected and cannot be changed.'); return }
    document.activeElement instanceof HTMLTextAreaElement && document.activeElement.blur()
    let bytes: Uint8Array
    try { bytes = await build(ex.base, annots) } catch (e) { console.error(e); toast('The PDF could not be saved.', 5000); return }
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    if (native?.savePdf) {
      const p = await native.savePdf(token, ab, as || !src!.path)
      if (!p) return
      src!.path = p
      name = p.split(/[\\/]/).pop() || name
      nameEl.textContent = name; nameEl.title = p
    } else if (!(await saveFile(name, bytes, 'pdf'))) return
    src!.data = bytes
    dirty = false
    updStatus()
    toast('Saved ' + name)
  }
  async function leaveOk() {
    if (!dirty) return true
    return confirmBox('Leave without saving?', 'Your markup and comments on this PDF have not been saved.', 'Leave', true)
  }
  async function openOther() {
    const f = await openFile(['.pdf'])
    if (!f) return
    if (!(await leaveOk())) return
    go('/pdf/' + addPdf({ name: f.name, data: f.data }))
  }
  async function printPdf() {
    toast('Preparing to print…', 20000)
    const box = h('div', { class: 'pv-print' })
    const urls: string[] = []
    try {
      for (const pv of pvs) {
        const s = 150 / 72
        const vp = pv.page.getViewport({ scale: s })
        const c = h('canvas') as HTMLCanvasElement
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
        await pv.page.render({ canvas: c, viewport: vp, intent: 'print', annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE }).promise
        const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.92))
        const url = URL.createObjectURL(blob); urls.push(url)
        const { svg, html } = annoMarkup(annots.filter(a => a.page === pv.i), vp, s, null, true)
        const pg = h('div', { class: 'pv-ppage', style: { aspectRatio: vp.width + ' / ' + vp.height } }, h('img', { src: url }))
        const ov = h('div', { class: 'pv-pov', style: { width: vp.width + 'px', height: vp.height + 'px', transform: `scale(var(--k))` } })
        ov.innerHTML = svg; ov.append(...html)
        pg.append(ov)
        box.append(pg)
      }
      document.body.append(box)
      await Promise.all(Array.from(box.querySelectorAll('img')).map(i => i.decode().catch(() => {})))
      box.querySelectorAll('.pv-ppage').forEach(p => { const ov = p.querySelector('.pv-pov') as HTMLElement; ov.style.setProperty('--k', String((p as HTMLElement).clientWidth / parseFloat(ov.style.width) || 1)) })
      toast('', 1)
      window.print()
    } catch (e) { console.error(e); toast('The PDF could not be printed.') }
    finally { box.remove(); urls.forEach(u => URL.revokeObjectURL(u)) }
  }

  // ---------- keyboard ----------
  let spaceDown = false
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  const keys = (e: KeyboardEvent) => {
    if (document.querySelector('.modal')) return
    const mod = e.ctrlKey || e.metaKey
    const k = keyOf(e)
    if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); return }
    if (mod && k === 'p') { e.preventDefault(); printPdf(); return }
    if (mod && k === 'o') { e.preventDefault(); openOther(); return }
    if (mod && k === 'f') { e.preventDefault(); openFind(); return }
    if (mod && k === 'g') { e.preventDefault(); if (hits.length) showHit(hitIdx + (e.shiftKey ? -1 : 1)); else openFind(); return }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.2); return }
    if (mod && k === '-') { e.preventDefault(); zoomBy(1 / 1.2); return }
    if (mod && k === '0') { e.preventDefault(); setZoom('width'); return }
    if (e.key === 'F3') { e.preventDefault(); if (hits.length) showHit(hitIdx + (e.shiftKey ? -1 : 1)); else openFind(); return }
    if (typing(e.target)) return
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return }
    if (mod && k === 'y') { e.preventDefault(); doRedo(); return }
    if (mod) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); del(selId); return }
    if (e.key === 'Escape') { if (selId) select(null); else setTool('select'); getSelection()?.removeAllRanges(); return }
    if (e.key === ' ' && !spaceDown) { spaceDown = true; desk.classList.add('space'); e.preventDefault(); return }
    if (e.key === 'ArrowRight' && desk.scrollWidth <= desk.clientWidth) { goPage(cur + 1); return }
    if (e.key === 'ArrowLeft' && desk.scrollWidth <= desk.clientWidth) { goPage(cur - 1); return }
    if (e.key === 'Home') { goPage(0); return }
    if (e.key === 'End') { goPage(pvs.length - 1); return }
    const t = TOOLS.find(x => x.key.toLowerCase() === k)
    if (t && !e.altKey) { setTool(t.id); return }
  }
  const keyUp = (e: KeyboardEvent) => { if (e.key === ' ') { spaceDown = false; desk.classList.remove('space') } }
  document.addEventListener('keydown', keys)
  document.addEventListener('keyup', keyUp)
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', beforeUnload)

  // ---------- start ----------
  updStatus()
  updUndo()
  setTool('select')
  top.querySelector('.pv-fit')!.classList.toggle('on', typeof zoomMode !== 'number')
  applyZoom()
  renderComments()
  desk.focus()

  return {
    async dispose() {
      disposed = true
      io.disconnect(); thumbIO.disconnect(); ro.disconnect()
      for (const pv of pvs) pv.task?.cancel()
      document.removeEventListener('keydown', keys)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelChange)
      window.removeEventListener('beforeunload', beforeUnload)
      pop.remove(); selPop.remove()
      await task!.destroy().catch(() => {})
    }
  }
}


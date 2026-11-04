import type { Editor } from '@tiptap/core'
import { DocView } from '../editor/docview'
import { assets } from '../editor/registry'
import { store, native } from '../storage/store'
import { assetIds } from '../model/doc'
import { FONTS } from '../model/types'
import { h, debounce } from '../util'
import { icon } from './icons'
import { menuBar, toast, dropdown, confirmBox } from './dialogs'
import { outlinePanel } from './outline'
import { inspectorPanel } from './inspector'
import { currentBlockStyle, setBlockStyle, insertImage, addImageAsset, insertSectionBreak, settingsOf, setSettings, type BlockStyle } from './commands'
import { linkDialog, xrefDialog, tableDialog, noteDialog, bookmarkDialog, exportPDF, exportDOCX, exportFile, preview } from './docdialogs'
import { metaLite, ensureAssets } from '../export/render'
import { attachContextMenu } from './contextmenu'
import { csvDialog } from './csv'
import { replaceImage } from './commands'
import { go } from '../router'

export interface WS { dispose(): Promise<void> }

export async function openWorkspace(app: HTMLElement, id: string): Promise<WS | null> {
  const doc = await store.load(id)
  if (!doc) { toast('That document could not be found.'); go('/'); return null }
  assets.clear()
  assets.load(doc.assets)
  await ensureAssets(doc)

  app.innerHTML = ''
  const top = h('div', { id: 'top' })
  const tools = h('div', { id: 'tools', role: 'toolbar', 'aria-label': 'Formatting' })
  const desk = h('div', { id: 'desk' })
  const mid = h('div', { id: 'mid' })
  const ws = h('div', { class: 'ws' }, top, tools, mid)
  app.append(ws)

  const dv = new DocView(desk, doc.content, 'edit', metaLite(doc))
  const ed: Editor = dv.editor
  if (innerWidth < 1000) dv.zoom = Math.max(0.5, Math.min(1, (innerWidth - 32) / ((doc.content.attrs?.settings?.width || 595) * 4 / 3)))

  let dirty = false
  let saving = false
  const status = h('div', { class: 'status', role: 'status' }, h('i'), h('span', {}, 'Saved'))
  const setStatus = (t: string, cls = '') => { status.className = 'status ' + cls; (status.lastChild as HTMLElement).textContent = t }

  const save = async () => {
    if (saving) { saveSoon(); return }
    saving = true
    dirty = false
    setStatus('Saving…', 'saving')
    doc.content = ed.getJSON()
    doc.meta.modified = Date.now()
    doc.assets = { ...assets.allInfo() }
    try {
      await store.save(doc)
      setStatus(dirty ? 'Unsaved changes' : 'Saved', dirty ? 'saving' : '')
    } catch (e: any) {
      dirty = true
      setStatus('Couldn’t save', 'err')
      toast('Saving failed: ' + (e?.message || 'storage is unavailable') + '. Your changes are kept in this window.', 6000)
    } finally { saving = false }
  }
  const saveSoon = debounce(save, 700)
  const markDirty = () => { dirty = true; setStatus('Unsaved changes', 'saving'); saveSoon() }
  ed.on('update', markDirty)

  const nameIn = h('input', { id: 'dname', type: 'text', value: doc.meta.title, 'aria-label': 'Document title', spellcheck: 'false' }) as HTMLInputElement
  nameIn.addEventListener('change', () => { doc.meta.title = nameIn.value.trim() || 'Untitled document'; nameIn.value = doc.meta.title; onMeta() })
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { nameIn.blur(); ed.commands.focus() } })
  const onMeta = () => { nameIn.value = doc.meta.title; document.title = doc.meta.title + ' · CocoaAuthor'; native?.setTitle(document.title); dv.refreshFrames(); markDirty() }
  document.title = doc.meta.title + ' · CocoaAuthor'
  native?.setTitle(document.title)

  const outline = outlinePanel(ed, dv)
  const insp = inspectorPanel(ed, dv, doc, onMeta)
  mid.append(outline.el, desk, insp.el)

  const pgInd = h('span', { class: 'pgind' }, '')
  const zl = h('span', { title: 'Reset zoom', onclick: () => setZoom(1) }, '100%')
  const setZoom = (z: number) => { dv.setZoom(Math.max(0.3, Math.min(3, z))); zl.textContent = Math.round(dv.zoom * 100) + '%' }
  const fitWidth = () => { const L = dv.layout; if (L) setZoom((desk.clientWidth - 48) / (L.flowW * 4 / 3)) }
  zl.textContent = Math.round(dv.zoom * 100) + '%'

  const exportBtn = h('button', { class: 'pri', onclick: () => dropdown(exportBtn, [
    { label: 'PDF document', icon: icon('pdf'), run: () => exportPDF(doc, ed) },
    { label: 'Word document', icon: icon('word'), run: () => exportDOCX(doc, ed) },
    'sep',
    { label: 'CocoaAuthor file', icon: icon('file'), run: () => exportFile(doc, ed) }
  ], true) }, icon('download'), 'Export')

  const ins = {
    image: () => insertImage(ed, doc),
    table: () => tableDialog(ed),
    csv: () => csvDialog(ed),
    link: () => linkDialog(ed, dv),
    callout: () => ed.chain().focus().wrapIn('callout', { tone: 'note' }).run(),
    quote: () => ed.chain().focus().toggleBlockquote().run(),
    divider: () => ed.chain().focus().setHorizontalRule().run(),
    pageBreak: () => ed.chain().focus().insertContent({ type: 'pageBreak' }).run(),
    sectionBreak: () => insertSectionBreak(ed),
    footnote: () => noteDialog(ed, 'foot'),
    endnote: () => noteDialog(ed, 'end'),
    xref: () => xrefDialog(ed),
    bookmark: () => bookmarkDialog(ed),
    toc: () => ed.chain().focus().insertContent({ type: 'toc', attrs: { title: 'Contents', levels: 3 } }).run()
  }
  const insertItems = () => [
    { label: 'Image…', icon: icon('image'), run: ins.image },
    { label: 'Table…', icon: icon('table'), run: ins.table },
    { label: 'Table or chart from CSV…', icon: icon('chart'), run: ins.csv },
    { label: 'Link…', icon: icon('link'), run: ins.link },
    'sep' as const,
    { label: 'Callout box', icon: icon('callout'), run: ins.callout },
    { label: 'Quote', icon: icon('quote'), run: ins.quote },
    { label: 'Divider', icon: icon('divider'), run: ins.divider },
    'sep' as const,
    { label: 'Page break', icon: icon('pagebreak'), run: ins.pageBreak },
    { label: 'Section break', icon: icon('section'), run: ins.sectionBreak },
    'sep' as const,
    { label: 'Footnote…', icon: icon('footnote'), run: ins.footnote },
    { label: 'Endnote…', icon: icon('footnote'), run: ins.endnote },
    { label: 'Cross-reference…', icon: icon('xref'), run: ins.xref },
    { label: 'Bookmark…', icon: icon('bookmark'), run: ins.bookmark },
    { label: 'Table of contents', icon: icon('toc'), run: ins.toc }
  ]

  const toggleL = () => mid.classList.toggle(innerWidth < 1000 ? 'show-l' : 'no-l')
  const toggleR = () => mid.classList.toggle(innerWidth < 1000 ? 'show-r' : 'no-r')

  const menus = menuBar([
    { label: 'File', items: () => [
      { label: 'Document library', icon: icon('grid'), run: () => go('/') },
      { label: 'Save now', icon: icon('check'), run: async () => { await save(); toast('Saved') } },
      'sep',
      { label: 'Preview', icon: icon('eye'), run: () => preview(doc, ed) },
      { label: 'Export PDF…', icon: icon('pdf'), run: () => exportPDF(doc, ed) },
      { label: 'Export Word document…', icon: icon('word'), run: () => exportDOCX(doc, ed) },
      { label: 'Save as CocoaAuthor file…', icon: icon('file'), run: () => exportFile(doc, ed) }
    ] },
    { label: 'Edit', items: () => [
      { label: 'Undo', icon: icon('undo'), run: () => ed.chain().focus().undo().run(), disabled: !ed.can().undo() },
      { label: 'Redo', icon: icon('redo'), run: () => ed.chain().focus().redo().run(), disabled: !ed.can().redo() },
      'sep',
      { label: 'Select all', run: () => ed.chain().focus().selectAll().run() },
      { label: 'Clear formatting', run: () => ed.chain().focus().unsetAllMarks().run() }
    ] },
    { label: 'Insert', items: insertItems },
    { label: 'Format', items: () => [
      { header: 'Paragraph style' },
      ...(['body', 'title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'caption'] as BlockStyle[]).map(k => ({ label: STYLE_LABEL[k], run: () => setBlockStyle(ed, k) })),
      'sep',
      { label: 'Edit styles…', icon: icon('type'), run: () => { showR(); insp.setTab('styles') } },
      { label: 'Page setup…', icon: icon('page'), run: () => { showR(); insp.setTab('page') } },
      { label: 'Document details…', icon: icon('info'), run: () => { showR(); insp.setTab('doc') } }
    ] },
    { label: 'View', items: () => [
      { label: 'Outline panel', icon: icon('sidebar'), run: toggleL },
      { label: 'Inspector panel', icon: icon('sliders'), run: toggleR },
      'sep',
      { label: settingsOf(ed).layout === 'pages' ? 'Single long page' : 'Pages', icon: icon('page'), run: () => setSettings(ed, { layout: settingsOf(ed).layout === 'pages' ? 'continuous' : 'pages' }) },
      'sep',
      { label: 'Zoom in', icon: icon('zin'), run: () => setZoom(dv.zoom * 1.15) },
      { label: 'Zoom out', icon: icon('zout'), run: () => setZoom(dv.zoom / 1.15) },
      { label: 'Actual size', run: () => setZoom(1) },
      { label: 'Fit width', run: fitWidth }
    ] }
  ])
  const showR = () => { mid.classList.remove('no-r'); if (innerWidth < 1000) mid.classList.add('show-r') }

  top.append(
    h('button', { class: 'brand', title: 'Document library', onclick: () => go('/') }, h('img', { src: 'logo.svg', alt: 'CocoaAuthor' })),
    menus, nameIn, status, h('span', { class: 'sp' }), pgInd,
    h('button', { class: 'ic tgl-only', title: 'Outline', onclick: toggleL }, icon('sidebar')),
    h('div', { class: 'zoom' }, h('button', { class: 'ic', title: 'Zoom out', onclick: () => setZoom(dv.zoom / 1.15) }, icon('zout')), zl, h('button', { class: 'ic', title: 'Zoom in', onclick: () => setZoom(dv.zoom * 1.15) }, icon('zin'))),
    h('button', { class: 'tgl-only ic', title: 'Inspector', onclick: toggleR }, icon('sliders')),
    h('button', { title: 'Preview', onclick: () => preview(doc, ed) }, icon('eye'), h('span', {}, 'Preview')),
    exportBtn)

  const STYLE_LABEL: Record<BlockStyle, string> = { body: 'Body text', title: 'Title', subtitle: 'Subtitle', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', caption: 'Caption' }
  const styleSel = h('select', { class: 'ssel', title: 'Paragraph style', 'aria-label': 'Paragraph style', onchange: () => { if (styleSel.value) setBlockStyle(ed, styleSel.value as BlockStyle) } }) as HTMLSelectElement
  styleSel.append(h('option', { value: '' }, '—'))
  for (const k of Object.keys(STYLE_LABEL) as BlockStyle[]) styleSel.append(h('option', { value: k }, STYLE_LABEL[k]))
  const fontSel = h('select', { class: 'fsel', title: 'Font', 'aria-label': 'Font', onchange: () => fontSel.value ? ed.chain().focus().setFontFamily(fontSel.value).run() : ed.chain().focus().unsetFontFamily().run() }) as HTMLSelectElement
  fontSel.append(h('option', { value: '' }, 'Style font'))
  for (const f of FONTS) fontSel.append(h('option', { value: f.name }, f.name))
  const sizeIn = h('input', { type: 'number', class: 'size', min: '4', max: '200', step: '0.5', title: 'Font size (pt)', 'aria-label': 'Font size', placeholder: '–' }) as HTMLInputElement
  sizeIn.addEventListener('change', () => { const v = parseFloat(sizeIn.value); v > 0 ? ed.chain().focus().setFontSize(v + 'px').run() : ed.chain().focus().unsetFontSize().run() })
  const tb = (name: string, title: string, run: () => void, active?: () => boolean) => {
    const b = h('button', { class: 'ic', title, 'aria-label': title, onmousedown: (e: Event) => e.preventDefault(), onclick: run }, icon(name))
    if (active) actives.push([b, active])
    return b
  }
  const actives: [HTMLElement, () => boolean][] = []
  const colorBtn = (name: string, title: string, key: string, def: string, palette: string[], apply: (v: string | null) => void, active: () => boolean) => {
    let cur = localStorage.getItem(key) || def
    const bar = h('span', { class: 'bar', style: { background: cur } })
    const main = h('button', { class: 'ic cbtn', title, 'aria-label': title, onmousedown: (e: Event) => e.preventDefault(), onclick: () => apply(active() ? null : cur) }, icon(name), bar)
    const pick = (v: string) => { cur = v; localStorage.setItem(key, v); bar.style.background = v; apply(v) }
    const more = h('button', { class: 'ic cmore', title: title + ' options', 'aria-label': title + ' options', onmousedown: (e: Event) => e.preventDefault(), onclick: () => {
      const r = more.getBoundingClientRect()
      document.querySelectorAll('.ctx').forEach(e => e.remove())
      const pop = h('div', { class: 'ctx swatches', role: 'dialog', 'aria-label': title })
      const grid = h('div', { class: 'swg' })
      for (const c of palette) grid.append(h('button', { class: 'sw' + (c === cur ? ' on' : ''), title: c, style: { background: c }, onmousedown: (e: Event) => e.preventDefault(), onclick: () => { pick(c); pop.remove() } }))
      const custom = h('input', { type: 'color', value: cur }) as HTMLInputElement
      custom.addEventListener('change', () => { pick(custom.value); pop.remove() })
      pop.append(grid, h('div', { class: 'swrow' }, h('label', { class: 'chk' }, custom, 'Custom…'), h('button', { onmousedown: (e: Event) => e.preventDefault(), onclick: () => { apply(null); pop.remove() } }, 'None')))
      document.body.append(pop)
      pop.style.left = Math.min(r.left - 30, innerWidth - 230) + 'px'
      pop.style.top = r.bottom + 4 + 'px'
      const off = (e: Event) => { if (!pop.contains(e.target as Node) && e.target !== more) { pop.remove(); document.removeEventListener('mousedown', off, true) } }
      setTimeout(() => document.addEventListener('mousedown', off, true))
    } }, icon('chev'))
    return { b: h('span', { class: 'split' }, main, more), bar }
  }
  const tc = colorBtn('palette', 'Text colour', 'ca-tcol', '#c0392b', ['#1d1d1f', '#5b6472', '#8b919b', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f3a66', '#2f5fb3', '#6c3483', '#a93279'],
    v => (v ? ed.chain().focus().setColor(v).run() : ed.chain().focus().unsetColor().run()), () => false)
  const hc = colorBtn('highlight', 'Highlight', 'ca-hcol', '#fff3a3', ['#fff3a3', '#ffe08a', '#ffd3b0', '#ffc9c9', '#f6c6e7', '#e3d3ff', '#cfe0ff', '#c6f0ff', '#c8f2d4', '#e6f2c2', '#eeeeee', '#d9dde3'],
    v => (v ? ed.chain().focus().setHighlight({ color: v }).run() : ed.chain().focus().unsetHighlight().run()), () => ed.isActive('highlight'))
  const sep = () => h('span', { class: 'sep' })
  tools.append(
    tb('undo', 'Undo', () => ed.chain().focus().undo().run()), tb('redo', 'Redo', () => ed.chain().focus().redo().run()), sep(),
    styleSel, fontSel, sizeIn, sep(),
    tb('bold', 'Bold', () => ed.chain().focus().toggleBold().run(), () => ed.isActive('bold')),
    tb('italic', 'Italic', () => ed.chain().focus().toggleItalic().run(), () => ed.isActive('italic')),
    tb('underline', 'Underline', () => ed.chain().focus().toggleUnderline().run(), () => ed.isActive('underline')),
    tb('strike', 'Strikethrough', () => ed.chain().focus().toggleStrike().run(), () => ed.isActive('strike')),
    tc.b, hc.b, sep(),
    tb('alignl', 'Align left', () => ed.chain().focus().setTextAlign('left').run(), () => ed.isActive({ textAlign: 'left' })),
    tb('alignc', 'Centre', () => ed.chain().focus().setTextAlign('center').run(), () => ed.isActive({ textAlign: 'center' })),
    tb('alignr', 'Align right', () => ed.chain().focus().setTextAlign('right').run(), () => ed.isActive({ textAlign: 'right' })),
    tb('alignj', 'Justify', () => ed.chain().focus().setTextAlign('justify').run(), () => ed.isActive({ textAlign: 'justify' })), sep(),
    tb('ul', 'Bulleted list', () => ed.chain().focus().toggleBulletList().run(), () => ed.isActive('bulletList')),
    tb('ol', 'Numbered list', () => ed.chain().focus().toggleOrderedList().run(), () => ed.isActive('orderedList')),
    tb('outdent', 'Decrease list level', () => ed.chain().focus().liftListItem('listItem').run()),
    tb('indent', 'Increase list level', () => ed.chain().focus().sinkListItem('listItem').run()), sep(),
    tb('link', 'Link', ins.link, () => ed.isActive('link')),
    tb('image', 'Image', ins.image),
    tb('table', 'Table', ins.table),
    tb('chart', 'Table or chart from CSV', ins.csv),
    tb('footnote', 'Footnote', ins.footnote),
    tb('xref', 'Cross-reference', ins.xref))
  const insBtn = h('button', { class: 'ic', title: 'Insert', 'aria-label': 'Insert', onclick: () => dropdown(insBtn, insertItems()) }, icon('plus'), icon('chev'))
  tools.append(insBtn)

  let raf = 0
  const syncUI = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      for (const [b, f] of actives) b.classList.toggle('on', !!f())
      styleSel.value = currentBlockStyle(ed) || ''
      const ts = ed.getAttributes('textStyle')
      if (document.activeElement !== fontSel) fontSel.value = ts.fontFamily?.replace(/["']/g, '') || ''
      if (document.activeElement !== sizeIn) sizeIn.value = ts.fontSize ? String(parseFloat(ts.fontSize)) : ''
      hc.b.firstElementChild!.classList.toggle('on', ed.isActive('highlight'))
      outline.mark()
    })
  }
  const inspSoon = debounce(() => insp.render(), 120)
  const outlineSoon = debounce(() => outline.render(), 300)
  ed.on('selectionUpdate', () => { syncUI(); inspSoon() })
  ed.on('transaction', ({ transaction }) => { syncUI(); if (transaction.docChanged) { outlineSoon(); inspSoon() } })
  dv.onLayout(l => {
    outline.render()
    if (insp.tab === 'doc') insp.render()
    updPg(l.pages.length)
  })
  const updPg = (n = dv.layout?.pages.length || 0) => {
    const c = dv.currentPage()
    const L = dv.layout
    pgInd.textContent = L ? (L.continuous ? 'Single page' : `Page ${c + 1} of ${n}`) : ''
  }
  desk.addEventListener('scroll', () => updPg(), { passive: true })

  const follow = (href: string) => {
    if (!href) return
    if (href.startsWith('#page=')) { const L = dv.layout; const i = L?.pages.findIndex(p => p.label === href.slice(6)) ?? -1; dv.scrollToPage(i >= 0 ? i : (parseInt(href.slice(6)) || 1) - 1) }
    else if (href.startsWith('#')) { if (!dv.scrollToId(decodeURIComponent(href.slice(1)))) toast('The link target no longer exists.') }
    else window.open(href, '_blank', 'noopener')
  }
  insp.el.addEventListener('ca-link', () => linkDialog(ed, dv))
  insp.el.addEventListener('ca-chart', (e: any) => csvDialog(ed, e.detail))
  attachContextMenu(ed, dv.root, {
    link: () => linkDialog(ed, dv), follow: href => follow(href), footnote: ins.footnote, xref: ins.xref, bookmark: ins.bookmark,
    paragraph: () => { showR(); insp.setTab('format'); setTimeout(() => [...insp.el.querySelectorAll('.sec')].find(s => s.textContent === 'Paragraph')?.scrollIntoView({ block: 'start' }), 30) },
    replaceImage: pos => replaceImage(ed, doc, pos), editChart: pos => csvDialog(ed, pos),
    table: ins.table, image: ins.image, csv: ins.csv
  })
  desk.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018))
    const r = desk.getBoundingClientRect()
    const fx = e.clientX - r.left + desk.scrollLeft, fy = e.clientY - r.top + desk.scrollTop
    const z0 = dv.zoom
    setZoom(z0 * k)
    const q = dv.zoom / z0
    desk.scrollLeft = fx * q - (e.clientX - r.left)
    desk.scrollTop = fy * q - (e.clientY - r.top)
  }, { passive: false })
  insp.el.addEventListener('ca-follow', (e: any) => follow(e.detail))
  dv.root.addEventListener('click', e => {
    const t = e.target as HTMLElement
    const toc = t.closest('.ca-toce') as HTMLAnchorElement | null
    const a = t.closest('a') as HTMLAnchorElement | null
    if (toc) { e.preventDefault(); follow(toc.getAttribute('href') || ''); return }
    if (a) {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey || a.closest('.ca-over')) follow(a.getAttribute('href') || '')
    }
  })

  const keys = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 's') { e.preventDefault(); save().then(() => toast('Saved')) }
    else if (k === 'k') { e.preventDefault(); linkDialog(ed, dv) }
    else if (k === 'p' && !e.shiftKey) { e.preventDefault(); preview(doc, ed) }
    else if (k === '=' || k === '+') { e.preventDefault(); setZoom(dv.zoom * 1.15) }
    else if (k === '-') { e.preventDefault(); setZoom(dv.zoom / 1.15) }
    else if (k === '0') { e.preventDefault(); setZoom(1) }
  }
  document.addEventListener('keydown', keys)
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) { saveSoon.flush(); e.preventDefault() } }
  window.addEventListener('beforeunload', beforeUnload)
  const vis = () => { if (document.visibilityState === 'hidden' && dirty) saveSoon.flush() }
  document.addEventListener('visibilitychange', vis)

  desk.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() })
  desk.addEventListener('drop', async e => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    const pos = ed.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (pos) ed.commands.setTextSelection(pos.pos)
    for (const f of files) {
      try {
        const a = await addImageAsset(doc, f, f.name)
        ed.chain().focus().insertContent([{ type: 'image', attrs: { src: 'asset:' + a.id, w: a.w, h: a.h, alt: f.name.replace(/\.[^.]+$/, '') } }, { type: 'paragraph', attrs: { kind: 'caption', label: 'figure' } }]).run()
      } catch { toast('That image could not be added.') }
    }
  })
  ed.setOptions({
    editorProps: {
      ...ed.options.editorProps,
      handlePaste: (_v, ev) => {
        const files = Array.from(ev.clipboardData?.files || []).filter(f => f.type.startsWith('image/'))
        if (!files.length) return false
        ;(async () => {
                for (const f of files) {
            const a = await addImageAsset(doc, f, 'Pasted image')
            ed.chain().focus().insertContent([{ type: 'image', attrs: { src: 'asset:' + a.id, w: a.w, h: a.h } }, { type: 'paragraph', attrs: { kind: 'caption', label: 'figure' } }]).run()
          }
        })()
        return true
      }
    }
  })

  outline.render()
  insp.render(true)
  syncUI()
  setTimeout(() => ed.commands.focus('start'), 50)

  return {
    async dispose() {
      document.removeEventListener('keydown', keys)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', vis)
      saveSoon.cancel()
      if (dirty) await save()
      const keep = [...assetIds(ed.getJSON())]
      store.pruneAssets(doc.meta.id, keep).catch(() => {})
      dv.destroy()
    }
  }
}

export async function deleteDocConfirmed(id: string, title: string) {
  if (!(await confirmBox('Delete document?', `“${title}” will be permanently deleted from this ${native ? 'computer' : 'browser'}.`))) return false
  await store.remove(id)
  return true
}

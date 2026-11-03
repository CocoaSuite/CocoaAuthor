import type { Editor } from '@tiptap/core'
import { h, esc } from '../util'
import { modal, toast, progressBox } from './dialogs'
import { icon } from './icons'
import { allTargets, countHints, brokenRefs, clearHints, settingsOf } from './commands'
import { kindName } from './inspector'
import type { Target } from '../layout/plugin'
import type { CADocument } from '../model/types'
import type { DocView } from '../editor/docview'
import { renderForExport } from '../export/render'
import { saveFile, safeName, packDoc } from '../storage/store'

function targetList(ts: Target[], sel: string, on: (id: string) => void, filter = '') {
  const list = h('div', { class: 'tlist', role: 'listbox' })
  const draw = (q: string) => {
    list.innerHTML = ''
    const f = q.toLowerCase()
    const items = ts.filter(t => !f || (t.text + ' ' + t.num + ' ' + kindName(t.kind)).toLowerCase().includes(f))
    if (!items.length) list.append(h('div', { class: 'empty' }, 'Nothing to link to yet. Add headings, captions or bookmarks.'))
    for (const t of items) {
      list.append(h('button', { class: t.id === sel ? 'on' : '', role: 'option', onclick: () => { sel = t.id; on(t.id); draw(q) } },
        h('span', { class: 'k' }, kindName(t.kind)),
        h('span', { class: 't' }, (t.num && t.kind !== 'bookmark' ? t.num + '  ' : '') + (t.text || 'Untitled'))))
    }
  }
  draw(filter)
  return { el: list, draw }
}

export function linkDialog(ed: Editor, dv: DocView) {
  const cur = ed.getAttributes('link').href as string | undefined
  const { from, to, empty } = ed.state.selection
  const selText = ed.state.doc.textBetween(from, to, ' ')
  let mode = !cur ? 'web' : cur.startsWith('#page=') ? 'page' : cur.startsWith('#') ? 'doc' : cur.startsWith('mailto:') ? 'email' : cur.startsWith('tel:') ? 'phone' : 'web'
  let target = cur?.startsWith('#') && !cur.startsWith('#page=') ? cur.slice(1) : ''
  const textIn = h('input', { type: 'text', value: selText, placeholder: 'Text to show' }) as HTMLInputElement
  const val = h('input', { type: 'text' }) as HTMLInputElement
  const pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } })
  const tabs = h('div', { class: 'seg' })
  const ts = allTargets(ed).filter(t => t.kind !== 'endnote')
  const draw = () => {
    tabs.innerHTML = ''
    for (const [k, l] of [['web', 'Web'], ['email', 'Email'], ['phone', 'Phone'], ['doc', 'In document'], ['page', 'Page']]) {
      tabs.append(h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; draw() } }, l))
    }
    pane.innerHTML = ''
    if (mode === 'doc') {
      const q = h('input', { type: 'search', placeholder: 'Search headings, figures, tables, bookmarks' }) as HTMLInputElement
      const tl = targetList(ts, target, id => { target = id })
      q.addEventListener('input', () => tl.draw(q.value))
      pane.append(q, tl.el)
    } else {
      const ph = { web: 'https://example.com', email: 'name@example.com', phone: '+44 20 7946 0000', page: 'Page number, e.g. 18' }[mode]!
      const label = { web: 'Web address', email: 'Email address', phone: 'Phone number', page: 'Page' }[mode]!
      val.placeholder = ph
      val.type = mode === 'page' ? 'number' : 'text'
      val.value = !cur ? '' : mode === 'web' && !cur.startsWith('#') && !cur.startsWith('mailto:') && !cur.startsWith('tel:') ? cur : mode === 'email' && cur.startsWith('mailto:') ? cur.slice(7) : mode === 'phone' && cur.startsWith('tel:') ? cur.slice(4) : mode === 'page' && cur.startsWith('#page=') ? cur.slice(6) : ''
      pane.append(h('label', { class: 'f' }, label, val))
      if (mode === 'page') pane.append(h('div', { class: 'hint' }, `The document currently has ${dv.layout?.pages.length || 1} pages. Links to headings or bookmarks stay correct when pages move; page links do not.`))
      setTimeout(() => val.focus(), 10)
    }
  }
  draw()
  const apply = () => {
    let href = ''
    const v = val.value.trim()
    if (mode === 'web') href = !v ? '' : /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v
    else if (mode === 'email') href = v ? 'mailto:' + v.replace(/^mailto:/, '') : ''
    else if (mode === 'phone') href = v ? 'tel:' + v.replace(/[^\d+]/g, '') : ''
    else if (mode === 'page') href = v ? '#page=' + parseInt(v) : ''
    else href = target ? '#' + target : ''
    if (!href) { toast('Choose where the link should go.'); return }
    const text = textIn.value
    if (empty && !ed.isActive('link')) {
      const t = text || (mode === 'doc' ? ts.find(x => x.id === target)?.text || 'link' : v)
      ed.chain().focus().insertContent({ type: 'text', text: t, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else ed.chain().focus().extendMarkRange('link').setLink({ href }).run()
    m.close()
  }
  const m = modal(cur ? 'Edit link' : 'Insert link', [
    tabs,
    ...(empty && !cur ? [h('label', { class: 'f' }, 'Text', textIn)] : []),
    pane,
    h('div', { class: 'row' },
      cur ? h('button', { class: 'danger', onclick: () => { ed.chain().focus().extendMarkRange('link').unsetLink().run(); m.close() } }, 'Remove link') : '',
      h('span', { class: 'sp' }),
      h('button', { onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'pri', onclick: apply }, cur ? 'Update' : 'Insert'))
  ], { wide: true, onKey: e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'search') apply() } })
}

export function xrefDialog(ed: Editor) {
  const ts = allTargets(ed)
  let target = ''
  let show = 'text'
  const q = h('input', { type: 'search', placeholder: 'Search' }) as HTMLInputElement
  const tl = targetList(ts, target, id => { target = id })
  q.addEventListener('input', () => tl.draw(q.value))
  const showSel = h('select', { onchange: () => (show = showSel.value) }) as HTMLSelectElement
  for (const [k, l] of [['text', 'Text'], ['number', 'Number (e.g. Figure 3)'], ['page', 'Page number'], ['textpage', 'Text and page number']]) showSel.append(h('option', { value: k }, l))
  const m = modal('Insert cross-reference', [
    h('div', { class: 'hint' }, 'A cross-reference updates its wording and page number automatically, and links to its target in exported files.'),
    q, tl.el,
    h('label', { class: 'f' }, 'Show', showSel),
    h('div', { class: 'row' }, h('button', { onclick: () => m.close() }, 'Cancel'), h('button', {
      class: 'pri', onclick: () => {
        if (!target) { toast('Choose something to refer to.'); return }
        ed.chain().focus().insertContent({ type: 'xref', attrs: { target, show } }).run()
        m.close()
      }
    }, 'Insert'))
  ], { wide: true })
}

export function tableDialog(ed: Editor) {
  let r = 3, c = 3
  const grid = h('div', { class: 'grid-pick' })
  const lbl = h('div', { class: 'hint' }, '3 × 3')
  const cells: HTMLElement[] = []
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const e = h('i', {})
    e.addEventListener('mouseenter', () => { r = i + 1; c = j + 1; paint() })
    e.addEventListener('click', () => go())
    cells.push(e); grid.append(e)
  }
  const head = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement
  const paint = () => { cells.forEach((e, k) => e.classList.toggle('on', Math.floor(k / 8) < r && k % 8 < c)); lbl.textContent = `${r} rows × ${c} columns` }
  const go = () => {
    ed.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: head.checked }).run()
    m.close()
  }
  paint()
  const m = modal('Insert table', [grid, lbl, h('label', { class: 'chk' }, head, 'Header row'), h('div', { class: 'row' }, h('button', { onclick: () => m.close() }, 'Cancel'), h('button', { class: 'pri', onclick: go }, 'Insert'))])
}

export function noteDialog(ed: Editor, kind: 'foot' | 'end') {
  const t = h('textarea', { placeholder: kind === 'end' ? 'Endnote text' : 'Footnote text' }) as HTMLTextAreaElement
  const go = () => {
    if (!t.value.trim()) { m.close(); return }
    ed.chain().focus().insertContent({ type: 'footnote', attrs: { text: t.value.trim(), kind } }).run()
    m.close()
  }
  const m = modal(kind === 'end' ? 'Insert endnote' : 'Insert footnote', [t,
    h('div', { class: 'hint' }, kind === 'end' ? 'Endnotes are collected in a Notes section at the end of the document.' : 'Footnotes appear at the bottom of the page where they are referenced.'),
    h('div', { class: 'row' }, h('button', { onclick: () => m.close() }, 'Cancel'), h('button', { class: 'pri', onclick: go }, 'Insert'))])
  t.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go() })
}

export function bookmarkDialog(ed: Editor) {
  const i = h('input', { type: 'text', placeholder: 'e.g. Budget summary' }) as HTMLInputElement
  const sel = ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, ' ').trim()
  i.value = sel.slice(0, 60)
  const go = () => {
    ed.chain().focus().setTextSelection(ed.state.selection.from).insertContent({ type: 'bookmark', attrs: { name: i.value.trim() || 'Bookmark' } }).run()
    m.close()
  }
  const m = modal('Add bookmark', [h('label', { class: 'f' }, 'Name', i), h('div', { class: 'hint' }, 'Bookmarks mark a spot you can link to or cross-reference.'), h('div', { class: 'row' }, h('button', { onclick: () => m.close() }, 'Cancel'), h('button', { class: 'pri', onclick: go }, 'Add'))])
  i.addEventListener('keydown', e => { if (e.key === 'Enter') go() })
}

export async function preflight(ed: Editor | null, doc: CADocument): Promise<boolean> {
  if (!ed) return true
  const hints = countHints(ed.state.doc)
  const broken = brokenRefs(ed)
  if (!hints && !broken) return true
  const items: Node[] = []
  if (hints) items.push(h('div', { class: 'hint' }, `This document still has template prompts (grey italic text). They will be exported as they are.`))
  if (broken) items.push(h('div', { class: 'hint' }, `${broken} link${broken > 1 ? 's point' : ' points'} to something that no longer exists.`))
  const m = modal('Before you export', [...items, h('div', { class: 'row' },
    h('button', { onclick: () => m.close(false) }, 'Cancel'),
    hints ? h('button', { onclick: () => { clearHints(ed); doc.content = ed.getJSON(); m.close(true) } }, 'Remove prompts and export') : '',
    h('button', { class: 'pri', onclick: () => m.close(true) }, 'Export anyway'))])
  return !!(await m.done)
}

export async function exportPDF(doc: CADocument, ed: Editor | null) {
  if (!(await preflight(ed, doc))) return
  if (ed) doc.content = ed.getJSON()
  const pb = progressBox('Exporting PDF')
  let r: Awaited<ReturnType<typeof renderForExport>> | null = null
  try {
    r = await renderForExport(doc)
    const { buildPDF } = await import('../export/pdf')
    const bytes = await buildPDF(r.dv, doc, (p, t) => pb.set(p, t))
    pb.close()
    if (await saveFile(safeName(doc.meta.title) + '.pdf', bytes, 'pdf')) toast('PDF exported')
  } catch (e: any) {
    pb.close()
    console.error(e)
    toast('The PDF could not be created: ' + (e?.message || e), 5000)
  } finally { r?.dispose() }
}

export async function exportDOCX(doc: CADocument, ed: Editor | null) {
  if (!(await preflight(ed, doc))) return
  if (ed) doc.content = ed.getJSON()
  const cont = ed ? settingsOf(ed).layout === 'continuous' : doc.content.attrs?.settings?.layout === 'continuous'
  const emb = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement
  const m = modal('Export Word document', [
    h('div', { class: 'hint' }, 'Creates an editable .docx with native headings, styles, lists, tables, links, bookmarks, footnotes and a table of contents.'),
    cont ? h('div', { class: 'hint' }, 'Word has no single long page, so the document is exported on regular pages.') : '',
    h('label', { class: 'chk' }, emb, 'Embed fonts so the document looks the same on other computers'),
    h('div', { class: 'row' }, h('button', { onclick: () => m.close(false) }, 'Cancel'), h('button', { class: 'pri', onclick: () => m.close(true) }, 'Export'))
  ])
  if (!(await m.done)) return
  const pb = progressBox('Exporting Word document')
  let r: Awaited<ReturnType<typeof renderForExport>> | null = null
  try {
    pb.set(0.2, 'Working out page numbers…')
    r = await renderForExport(doc)
    pb.set(0.5, 'Writing document…')
    const { buildDOCX } = await import('../export/docx')
    const blob = await buildDOCX(doc, r.dv.layout, { embedFonts: emb.checked })
    pb.close()
    if (await saveFile(safeName(doc.meta.title) + '.docx', blob, 'docx')) toast('Word document exported')
  } catch (e: any) {
    pb.close()
    console.error(e)
    toast('The Word document could not be created: ' + (e?.message || e), 5000)
  } finally { r?.dispose() }
}

export async function exportFile(doc: CADocument, ed: Editor | null) {
  if (ed) doc.content = ed.getJSON()
  try {
    const bytes = await packDoc(doc)
    if (await saveFile(safeName(doc.meta.title) + '.cocoaauthor', bytes, 'cocoaauthor')) toast('Document saved to file')
  } catch (e: any) { toast('The file could not be saved: ' + (e?.message || e), 5000) }
}

export async function preview(doc: CADocument, ed: Editor | null) {
  if (ed) doc.content = ed.getJSON()
  const desk = h('div', { class: 'pvdesk' })
  const wrap = h('div', { style: { position: 'relative', margin: '28px auto 64px' } })
  desk.append(wrap)
  const nav = h('div', { class: 'pvnav' })
  const pg = h('span', { class: 'pgind' }, '')
  const zl = h('span', {}, '100%')
  let zoom = 1
  const close = () => { r?.dispose(); el.remove(); document.removeEventListener('keydown', key) }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  const el = h('div', { class: 'pv', role: 'dialog', 'aria-label': 'Preview' },
    h('div', { class: 'pvbar' },
      h('button', { class: 'ic', title: 'Close preview', onclick: close }, icon('x')),
      h('b', {}, 'Preview'), h('span', { class: 'mute' }, esc(doc.meta.title)),
      h('span', { class: 'sp' }), pg,
      h('div', { class: 'zoom' }, h('button', { class: 'ic', title: 'Zoom out', onclick: () => setZoom(zoom / 1.2) }, icon('zout')), zl, h('button', { class: 'ic', title: 'Zoom in', onclick: () => setZoom(zoom * 1.2) }, icon('zin'))),
      h('button', { onclick: () => exportPDF(doc, null) }, icon('pdf'), 'Export PDF')),
    h('div', { class: 'pvside' }, nav, desk))
  document.body.append(el)
  document.addEventListener('keydown', key)
  const host = h('div', {})
  wrap.append(host)
  let r: Awaited<ReturnType<typeof renderForExport>> | null = null
  try { r = await renderForExport(doc, host) } catch (e: any) { toast('Preview failed: ' + e.message); close(); return }
  const root = r.dv.root
  root.classList.add('is-preview')
  const L = r.dv.layout!
  const setZoom = (z: number) => {
    zoom = Math.max(0.3, Math.min(3, z))
    const s = zoom * 4 / 3
    root.style.transformOrigin = '0 0'
    root.style.transform = `scale(${s})`
    wrap.style.width = L.flowW * s + 'px'
    wrap.style.height = L.flowH * s + 'px'
    zl.textContent = Math.round(zoom * 100) + '%'
  }
  host.style.position = 'absolute'
  root.style.position = 'absolute'
  const fit = Math.min(1, (desk.clientWidth - 48) / (L.flowW * 4 / 3))
  setZoom(fit)
  const s = () => zoom * 4 / 3
  const go = (y: number) => { desk.scrollTop = y * s() + 28 - 16 }
  root.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3').forEach(hd => {
    const lv = +hd.tagName[1]
    nav.append(h('button', { class: 'l' + lv, title: hd.textContent || '', onclick: () => go(hd.getBoundingClientRect().top / s() - root.getBoundingClientRect().top / s()) }, hd.textContent || 'Untitled'))
  })
  if (!nav.children.length) nav.append(h('div', { class: 'empty' }, 'No headings'))
  const upd = () => {
    const y = (desk.scrollTop - 28 + desk.clientHeight * 0.3) / s()
    let i = 0
    for (const p of L.pages) if (p.top <= y) i = p.i
    pg.textContent = `Page ${L.pages[i]?.label ?? 1} · ${i + 1} of ${L.pages.length}`
  }
  desk.addEventListener('scroll', upd)
  upd()
  root.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') || ''
    if (href.startsWith('#page=')) { const p = L.pages.find(x => x.label === href.slice(6)) || L.pages[(parseInt(href.slice(6)) || 1) - 1]; if (p) go(p.top) }
    else if (href.startsWith('#')) {
      const t = root.querySelector<HTMLElement>(`[id="${CSS.escape(href.slice(1))}"]`)
      if (t) go((t.getBoundingClientRect().top - root.getBoundingClientRect().top) / s())
    } else if (href) window.open(href, '_blank', 'noopener')
  })
}

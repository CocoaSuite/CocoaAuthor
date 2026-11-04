import { store, native, openFile, unpackDoc, saveFile, safeName, packDoc } from '../storage/store'
import { newDoc } from '../model/doc'
import { themeStyles } from '../model/themes'
import { thumbFor, thumbForDoc } from './thumbs'
import type { DocSummary, DocStatus } from '../model/types'
import { TEMPLATES, CATEGORIES, templateContent, type Template } from '../templates'
import { h, relTime } from '../util'
import { icon } from './icons'
import { toast, ctxMenu, promptBox, menuBar } from './dialogs'
import { go } from '../router'
import { deleteDocConfirmed } from './workspace'
import { exportPDF, exportDOCX } from './docdialogs'

export async function createFromTemplate(t: Template | null) {
  const d = t ? newDoc(t.name, templateContent(t), { template: t.id, styles: themeStyles(t.category) }) : newDoc('Untitled document')
  await store.save(d)
  go('/doc/' + d.meta.id)
}

export async function importAny() {
  const f = await openFile(['.cocoaauthor', '.docx'])
  if (f) await importData(f.name, f.data)
}

export async function importData(name: string, data: Uint8Array) {
  try {
    if (/\.docx$/i.test(name)) {
      toast('Importing Word document…', 8000)
      const { importDocx } = await import('../import/docx')
      const d = await importDocx(data, name)
      toast('Imported ' + d.meta.title)
      go('/doc/' + d.meta.id)
    } else {
      const d = await unpackDoc(data)
      toast('Opened ' + d.meta.title)
      go('/doc/' + d.meta.id)
    }
  } catch (e: any) {
    console.error(e)
    toast(e?.message || 'That file could not be opened.', 5000)
  }
}

export async function renderLibrary(app: HTMLElement, view: 'recent' | 'all' | 'templates' | 'archived', cat = '') {
  document.title = 'CocoaAuthor'
  native?.setTitle('CocoaAuthor')
  let docs: DocSummary[] = []
  try { docs = await store.list() } catch { toast('Your documents could not be loaded. Storage may be blocked in this browser.', 6000) }
  let q = ''
  let sort = localStorage.getItem('ca-sort') || 'modified'

  app.innerHTML = ''
  const top = h('div', { id: 'top' },
    h('button', { class: 'brand', title: 'CocoaAuthor', onclick: () => go('/') }, h('img', { src: 'logo.svg', alt: 'CocoaAuthor' })),
    menuBar([{ label: 'File', items: () => [
      { label: 'New document', icon: icon('plus'), run: () => createFromTemplate(null) },
      { label: 'New from template…', icon: icon('template'), run: () => go('/templates') },
      'sep',
      { label: 'Open CocoaAuthor file…', icon: icon('file'), run: importAny },
      { label: 'Import Word document…', icon: icon('word'), run: importAny }
    ] }]),
    h('span', { class: 'sp' }),
    h('button', { onclick: importAny }, icon('upload'), h('span', {}, 'Open or import')),
    h('button', { class: 'pri', onclick: () => createFromTemplate(null) }, icon('plus'), 'New document'))

  const active = docs.filter(d => !d.archived)
  const nav = h('nav', { 'aria-label': 'Library' })
  const navBtn = (v: string, label: string, ic: string, n?: number, c = '') => h('button', { class: view === v && cat === c ? 'on' : '', onclick: () => go('/' + v + (c ? '/' + encodeURIComponent(c) : '')) }, icon(ic), label, n != null ? h('span', { class: 'n' }, String(n)) : '')
  nav.append(
    navBtn('recent', 'Recent', 'clock'),
    navBtn('all', 'All documents', 'folder', active.length),
    navBtn('archived', 'Archived', 'archive', docs.length - active.length),
    h('div', { class: 'sec' }, 'Templates'),
    navBtn('templates', 'All templates', 'template', TEMPLATES.length),
    ...CATEGORIES.map(c => navBtn('templates', c, 'file', TEMPLATES.filter(t => t.category === c).length, c)))

  const main = h('main', {})
  app.append(top, h('div', { class: 'lib' }, nav, main))

  const draw = () => {
    main.innerHTML = ''
    if (view === 'templates') return drawTemplates()
    const title = { recent: 'Recent', all: 'All documents', archived: 'Archived' }[view]
    const search = h('input', { type: 'search', placeholder: 'Search documents', value: q, 'aria-label': 'Search documents' }) as HTMLInputElement
    search.addEventListener('input', () => { q = search.value; drawCards(cards) })
    const sortSel = h('select', { 'aria-label': 'Sort', onchange: () => { sort = sortSel.value; localStorage.setItem('ca-sort', sort); drawCards(cards) } }) as HTMLSelectElement
    for (const [k, l] of [['modified', 'Last edited'], ['created', 'Date created'], ['title', 'Title'], ['status', 'Status']]) sortSel.append(h('option', { value: k }, l))
    sortSel.value = sort
    main.append(h('div', { class: 'lhead' }, h('h1', {}, title), search, sortSel))
    const cards = h('div', { class: 'cards' })
    main.append(cards)
    drawCards(cards)
    if (view === 'recent') {
      main.append(h('div', { class: 'tplcat', style: { marginTop: '34px' } }, 'Start from a template'))
      const tc = h('div', { class: 'cards' })
      for (const t of TEMPLATES.filter((_, i) => i % 5 === 0)) tc.append(tplCard(t))
      main.append(tc)
    }
    if (!q) setTimeout(() => search.focus({ preventScroll: true }), 0)
  }

  const drawCards = (el: HTMLElement) => {
    el.innerHTML = ''
    const f = q.toLowerCase()
    let list = docs.filter(d => (view === 'archived' ? d.archived : !d.archived) && (!f || (d.title + ' ' + d.snippet).toLowerCase().includes(f)))
    const order: Record<DocStatus, number> = { draft: 0, review: 1, final: 2 }
    list.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.created - a.created : sort === 'status' ? order[a.status] - order[b.status] || b.modified - a.modified : b.modified - a.modified)
    if (view === 'recent') list = list.slice(0, 11)
    if (view !== 'archived' && !f) el.append(h('div', { class: 'card new', onclick: () => createFromTemplate(null), role: 'button', tabindex: '0' }, h('div', { class: 'thumb' }, icon('plus'), 'Blank document'), h('div', { class: 'meta' }, h('span', { class: 't' }, 'New document'), h('span', { class: 's' }, 'A4, ready to write'))))
    if (!list.length && (f || view === 'archived')) {
      el.parentElement!.append(h('div', { class: 'lempty' }, h('h2', {}, f ? 'No matches' : 'Nothing archived'), f ? 'Try a different search.' : 'Archived documents are kept here, out of the way.'))
      return
    }
    for (const d of list) el.append(docCard(d))
  }

  const docCard = (d: DocSummary) => {
        const more = h('button', { class: 'more ic', title: 'More', 'aria-label': 'More actions', onclick: (e: MouseEvent) => { e.stopPropagation(); menu(d, e.clientX, e.clientY) } }, icon('more'))
    const th = h('div', { class: 'thumb doc' }, h('b', {}, d.title), h('p', {}, d.snippet || ''))
    thumbForDoc(d.id, th)
    const c = h('div', { class: 'card', role: 'button', tabindex: '0', onclick: () => go('/doc/' + d.id), oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(d, e.clientX, e.clientY) } },
      th,
      h('div', { class: 'meta' }, h('span', { class: 't', title: d.title }, d.title), h('span', { class: 's' }, h('span', { class: 'chip ' + d.status }, d.status === 'review' ? 'In review' : d.status), relTime(d.modified), '·', `${d.words.toLocaleString()} words`)),
      more)
    c.addEventListener('keydown', e => { if (e.key === 'Enter') go('/doc/' + d.id) })
    return c
  }

  const mutate = async (id: string, fn: (d: any) => void) => {
    const d = await store.load(id)
    if (!d) return
    fn(d)
    await store.save(d)
    docs = await store.list()
    draw()
  }

  const menu = (d: DocSummary, x: number, y: number) => ctxMenu(x, y, [
    { label: 'Open', icon: icon('file'), run: () => go('/doc/' + d.id) },
    { label: 'Rename…', icon: icon('edit'), run: async () => { const v = await promptBox('Rename document', 'Title', d.title); if (v != null && v.trim()) mutate(d.id, x => { x.meta.title = v.trim() }) } },
    { label: 'Duplicate', icon: icon('copy'), run: async () => {
      const src = await store.load(d.id)
      if (!src) return
      const bytes = await packDoc(src)
      const c = await unpackDoc(bytes)
      c.meta.title = src.meta.title + ' copy'
      c.meta.created = Date.now()
      await store.save(c)
      docs = await store.list(); draw(); toast('Duplicated')
    } },
    'sep',
    { label: 'Export PDF…', icon: icon('pdf'), run: async () => { const x = await store.load(d.id); if (x) exportPDF(x, null) } },
    { label: 'Export Word document…', icon: icon('word'), run: async () => { const x = await store.load(d.id); if (x) exportDOCX(x, null) } },
    { label: 'Save as CocoaAuthor file…', icon: icon('download'), run: async () => { const x = await store.load(d.id); if (x && (await saveFile(safeName(x.meta.title) + '.cocoaauthor', await packDoc(x), 'cocoaauthor'))) toast('Saved to file') } },
    'sep',
    ...(['draft', 'review', 'final'] as DocStatus[]).filter(s => s !== d.status).map(s => ({ label: 'Mark as ' + (s === 'review' ? 'in review' : s), run: () => mutate(d.id, x => { x.meta.status = s }) })),
    d.archived
      ? { label: 'Restore', icon: icon('restore'), run: () => mutate(d.id, x => { x.meta.archived = false }) }
      : { label: 'Archive', icon: icon('archive'), run: () => mutate(d.id, x => { x.meta.archived = true }) },
    { label: 'Delete…', icon: icon('trash'), danger: true, run: async () => { if (await deleteDocConfirmed(d.id, d.title)) { docs = await store.list(); draw(); toast('Deleted') } } }
  ])

  const tplCard = (t: Template) => h('div', { class: 'card tpl', role: 'button', tabindex: '0', title: t.description, onclick: () => createFromTemplate(t) },
    h('div', { class: 'thumb doc' }, thumbFor(t)),
    h('div', { class: 'meta' }, h('span', { class: 't' }, t.name), h('span', { class: 's d' }, t.description)))

  const drawTemplates = () => {
    main.append(h('div', { class: 'lhead' }, h('h1', {}, cat || 'Templates'), h('span', { class: 'mute' }, 'Each template sets up the structure and prompts you to fill it in.')))
    for (const c of cat ? [cat] : CATEGORIES) {
      if (!cat) main.append(h('div', { class: 'tplcat' }, c))
      const g = h('div', { class: 'cards' })
      if (c === (cat || CATEGORIES[0])) g.append(h('div', { class: 'card new', role: 'button', tabindex: '0', onclick: () => createFromTemplate(null) }, h('div', { class: 'thumb' }, icon('plus'), 'Blank document'), h('div', { class: 'meta' }, h('span', { class: 't' }, 'Blank'), h('span', { class: 's' }, 'Start from scratch'))))
      for (const t of TEMPLATES.filter(x => x.category === c)) g.append(tplCard(t))
      main.append(g)
    }
  }

  if (!docs.length && view === 'recent') {
    main.append(h('div', { class: 'lempty' },
      h('h2', {}, 'Welcome to CocoaAuthor'),
      h('div', {}, 'Write, structure and publish professional documents. Everything is stored ' + (native ? 'on this computer.' : 'in this browser. Nothing is uploaded.')),
      h('div', { class: 'fr', style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'pri', onclick: () => createFromTemplate(null) }, icon('plus'), 'New document'),
        h('button', { onclick: () => go('/templates') }, icon('template'), 'Browse templates'),
        h('button', { onclick: importAny }, icon('upload'), 'Open a file'))))
    main.append(h('div', { class: 'tplcat', style: { marginTop: '12px' } }, 'Popular templates'))
    const g = h('div', { class: 'cards' })
    for (const t of TEMPLATES.filter((_, i) => i % 5 === 0)) g.append(tplCard(t))
    main.append(g)
    return
  }
  draw()
}

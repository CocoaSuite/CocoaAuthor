import type { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { ctxMenu, toast, type CtxItem } from './dialogs'

export interface CtxActions {
  link(): void
  follow(href: string): void
  footnote(): void
  xref(): void
  bookmark(): void
  paragraph(): void
  replaceImage(pos: number): void
  editChart(pos: number): void
  table(): void
  image(): void
  csv(): void
}

async function paste(ed: Editor, plain: boolean) {
  try {
    if (!plain && navigator.clipboard.read) {
      const items = await navigator.clipboard.read()
      for (const it of items) {
        if (it.types.includes('text/html')) { (ed.view as any).pasteHTML(await (await it.getType('text/html')).text()); return }
      }
    }
    const t = await navigator.clipboard.readText()
    if (t) (ed.view as any).pasteText(t)
  } catch {
    toast('This browser only allows pasting from the keyboard or the browser menu.')
  }
}

export function attachContextMenu(ed: Editor, root: HTMLElement, act: CtxActions) {
  root.addEventListener('contextmenu', e => {
    const v = ed.view
    if (!v.dom.contains(e.target as Node)) return
    e.preventDefault()
    const hit = v.posAtCoords({ left: e.clientX, top: e.clientY })
    const sel = ed.state.selection
    const atom = (e.target as HTMLElement).closest('figure.ca-img, nav.ca-toc, .ca-fn, .ca-xref, .ca-bm, .ca-pb')
    if (atom) {
      try {
        const pos = v.posAtDOM(atom, 0)
        const $p = ed.state.doc.resolve(pos)
        const p = $p.nodeAfter && $p.nodeAfter.isAtom ? pos : pos - 1
        if (ed.state.doc.nodeAt(p)?.isAtom) v.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, p)))
      } catch {}
    } else if (hit && (hit.pos < sel.from || hit.pos > sel.to || sel instanceof NodeSelection)) {
      v.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, hit.pos)))
    }
    v.focus()
    const s = ed.state.selection
    const node = s instanceof NodeSelection ? s.node : null
    const nt = node?.type.name
    const has = !s.empty
    const inLink = ed.isActive('link')
    const inTable = ed.isActive('table')
    const c = () => ed.chain().focus()
    const items: CtxItem[] = [
      { label: 'Cut', disabled: !has, run: () => document.execCommand('cut') },
      { label: 'Copy', disabled: !has, run: () => document.execCommand('copy') },
      { label: 'Paste', run: () => paste(ed, false) },
      { label: 'Paste as plain text', run: () => paste(ed, true) },
      { label: 'Select all', run: () => c().selectAll().run() },
      'sep'
    ]
    if (nt === 'image') items.push({ label: 'Replace image…', run: () => act.replaceImage(s.from) }, 'sep')
    if (nt === 'chart') items.push({ label: 'Edit chart…', run: () => act.editChart(s.from) }, 'sep')
    if (nt && node!.isBlock) items.push({ label: 'Delete', danger: true, run: () => c().deleteSelection().run() }, 'sep')
    if (!node) {
      if (inLink) {
        const href = ed.getAttributes('link').href || ''
        items.push({ label: 'Edit link…', run: act.link }, { label: 'Open link', run: () => act.follow(href) }, { label: 'Remove link', run: () => c().extendMarkRange('link').unsetLink().run() })
      } else items.push({ label: 'Link…', run: act.link })
      items.push({ label: 'Footnote…', run: act.footnote }, { label: 'Cross-reference…', run: act.xref }, { label: 'Bookmark…', run: act.bookmark }, 'sep')
    }
    if (inTable) {
      items.push(
        { label: 'Insert row above', run: () => c().addRowBefore().run() },
        { label: 'Insert row below', run: () => c().addRowAfter().run() },
        { label: 'Insert column left', run: () => c().addColumnBefore().run() },
        { label: 'Insert column right', run: () => c().addColumnAfter().run() },
        { label: 'Merge cells', disabled: !ed.can().mergeCells(), run: () => c().mergeCells().run() },
        { label: 'Split cell', disabled: !ed.can().splitCell(), run: () => c().splitCell().run() },
        { label: 'Delete row', run: () => c().deleteRow().run() },
        { label: 'Delete column', run: () => c().deleteColumn().run() },
        { label: 'Delete table', danger: true, run: () => c().deleteTable().run() },
        'sep')
    }
    if (!node) {
      items.push(
        { label: 'Paragraph settings…', run: act.paragraph },
        { label: 'Clear formatting', run: () => c().unsetAllMarks().run() },
        'sep',
        { label: 'Insert image…', run: act.image },
        { label: 'Insert table…', run: act.table },
        { label: 'Table or chart from CSV…', run: act.csv },
        { label: 'Insert page break', run: () => c().insertContent({ type: 'pageBreak' }).run() })
    }
    ctxMenu(e.clientX, e.clientY, items)
  })
}

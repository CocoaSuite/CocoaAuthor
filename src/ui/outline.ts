import type { Editor } from '@tiptap/core'
import type { DocView } from '../editor/docview'
import { h } from '../util'
import { icon } from './icons'
import { headings, headingRange, moveHeading, shiftHeading, deleteHeadingRange, renameHeading, type HeadingRow } from './commands'
import { confirmBox, ctxMenu, toast } from './dialogs'
import { getSettings } from '../layout/plugin'

export function outlinePanel(ed: Editor, dv: DocView) {
  const list = h('div', { id: 'olist', role: 'tree' })
  const add = h('button', { title: 'Add a section heading', onclick: () => addSection() }, icon('plus'), 'Section')
  const el = h('aside', { id: 'outline' }, h('div', { class: 'ph' }, 'Outline', add), list)
  let rows: HeadingRow[] = []
  let drag: HeadingRow | null = null
  let dropLn: HTMLElement | null = null
  let renaming = false

  const addSection = () => {
    const end = ed.state.doc.content.size - 1
    ed.chain().insertContentAt(end, [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'New section' }] }, { type: 'paragraph' }]).run()
    const r = headings(ed.state.doc).pop()
    if (r) { ed.chain().setTextSelection({ from: r.pos + 1, to: r.pos + 1 + r.text.length }).focus().run(); dv.scrollToPos(r.pos) }
  }

  const activeIdx = () => {
    const p = ed.state.selection.from
    let a = -1
    rows.forEach((r, i) => { if (r.pos <= p) a = i })
    return a
  }

  const render = () => {
    if (renaming) return
    rows = headings(ed.state.doc)
    const s = getSettings(ed.state.doc)
    const idPage = dv.layout?.idPage || {}
    const act = activeIdx()
    list.innerHTML = ''
    if (!rows.length) { list.append(h('div', { class: 'empty' }, 'Headings you add appear here. Use them to navigate and reorganise the document.')); return }
    const hc = [0, 0, 0, 0]
    rows.forEach((r, i) => {
      const l = r.level - 1
      hc[l]++
      for (let k = l + 1; k < 4; k++) hc[k] = 0
      const num = s.headingNumbers ? hc.slice(0, l + 1).map(x => x || 1).join('.') : ''
      const del = async () => {
        if (await confirmBox('Delete section?', `“${r.text || 'Untitled'}” and everything under it will be removed. You can undo this.`)) deleteHeadingRange(ed, r.pos)
      }
      const row = h('div', { class: `lr l${r.level}${i === act ? ' on' : ''}`, role: 'treeitem', draggable: 'true', style: { paddingLeft: (r.level - 1) * 14 + 'px' } },
        h('span', { class: 'lv' }, num),
        h('span', { class: 'ln' }, r.text || 'Untitled'),
        h('span', { class: 'pg' }, idPage[r.id] || ''),
        h('button', { class: 'lb mv', title: 'Move up', 'aria-label': 'Move section up', onclick: (e: Event) => { e.stopPropagation(); move(i, -1) } }, icon('up')),
        h('button', { class: 'lb mv', title: 'Move down', 'aria-label': 'Move section down', onclick: (e: Event) => { e.stopPropagation(); move(i, 1) } }, icon('down')),
        h('button', { class: 'lb', title: 'Promote', onclick: (e: Event) => { e.stopPropagation(); shiftHeading(ed, r.pos, -1) } }, icon('levelup')),
        h('button', { class: 'lb', title: 'Demote', onclick: (e: Event) => { e.stopPropagation(); shiftHeading(ed, r.pos, 1) } }, icon('leveldown')),
        h('button', { class: 'lb', title: 'Delete section', onclick: (e: Event) => { e.stopPropagation(); del() } }, icon('trash')))
      row.addEventListener('contextmenu', e => {
        e.preventDefault()
        ctxMenu(e.clientX, e.clientY, [
          { label: 'Move up', disabled: !canMove(i, -1), run: () => move(i, -1) },
          { label: 'Move down', disabled: !canMove(i, 1), run: () => move(i, 1) },
          'sep',
          { label: 'Promote', disabled: r.level <= 1, run: () => shiftHeading(ed, r.pos, -1) },
          { label: 'Demote', disabled: r.level >= 4, run: () => shiftHeading(ed, r.pos, 1) },
          { label: 'Rename…', run: () => startRename() },
          'sep',
          { label: 'Delete section…', danger: true, run: del }
        ])
      })
      row.addEventListener('click', () => {
        ed.chain().setTextSelection(r.pos + 1).focus(undefined, { scrollIntoView: false }).run()
        dv.scrollToPos(r.pos)
      })
      const startRename = () => {
        // A heading with formatting, notes or links is renamed in the page, so nothing in it is lost.
        const n = ed.state.doc.nodeAt(r.pos)
        let rich = false
        n?.forEach(c => { if (!c.isText || c.marks.length) rich = true })
        if (rich) {
          ed.chain().setTextSelection({ from: r.pos + 1, to: r.pos + 1 + (n?.content.size || 0) }).focus(undefined, { scrollIntoView: false }).run()
          dv.scrollToPos(r.pos)
          toast('This heading has formatting, so edit it on the page.')
          return
        }
        renaming = true
        const ln = row.querySelector('.ln') as HTMLElement
        const inp = h('input', { type: 'text', value: r.text }) as HTMLInputElement
        ln.innerHTML = ''
        ln.append(inp)
        inp.focus(); inp.select()
        const done = (ok: boolean) => {
          if (!renaming) return
          renaming = false
          if (ok && inp.value !== r.text) renameHeading(ed, r.pos, inp.value)
          else render()
        }
        inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false) })
        inp.addEventListener('blur', () => done(true))
      }
      row.addEventListener('dblclick', e => { e.preventDefault(); startRename() })
      row.addEventListener('dragstart', e => { drag = r; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', r.text) })
      row.addEventListener('dragover', e => {
        if (!drag) return
        e.preventDefault()
        dropLn ||= h('div', { id: 'dropLn' })
        list.append(dropLn)
        dropLn.style.top = row.offsetTop - 1 + 'px'
      })
      row.addEventListener('drop', e => {
        e.preventDefault()
        dropLn?.remove()
        if (drag && drag.pos !== r.pos) moveHeading(ed, drag.pos, r.pos)
        drag = null
      })
      row.addEventListener('dragend', () => { dropLn?.remove(); drag = null })
      list.append(row)
    })
    const tail = h('div', { style: { height: '28px' } })
    tail.addEventListener('dragover', e => { if (!drag) return; e.preventDefault(); dropLn ||= h('div', { id: 'dropLn' }); list.append(dropLn); dropLn.style.top = tail.offsetTop - 1 + 'px' })
    tail.addEventListener('drop', e => { e.preventDefault(); dropLn?.remove(); if (drag) moveHeading(ed, drag.pos, 'end'); drag = null })
    list.append(tail)
  }

  // Move a section past its neighbour at the same level (the touch-friendly alternative to dragging).
  const sibling = (i: number, d: -1 | 1) => {
    const r = rows[i]
    if (d < 0) { for (let k = i - 1; k >= 0; k--) { if (rows[k].sec !== r.sec || rows[k].level < r.level) return -1; if (rows[k].level === r.level) return k } return -1 }
    for (let k = i + 1; k < rows.length; k++) { if (rows[k].sec !== r.sec || rows[k].level < r.level) return -1; if (rows[k].level === r.level) return k }
    return -1
  }
  const canMove = (i: number, d: -1 | 1) => sibling(i, d) >= 0
  const move = (i: number, d: -1 | 1) => {
    const k = sibling(i, d)
    if (k < 0) { toast(d < 0 ? 'This section is already first.' : 'This section is already last.'); return }
    if (d < 0) moveHeading(ed, rows[i].pos, rows[k].pos)
    else moveHeading(ed, rows[i].pos, headingRange(ed.state.doc, rows[k].pos).to)
  }

  const mark = () => {
    const a = activeIdx()
    list.querySelectorAll('.lr').forEach((r, i) => r.classList.toggle('on', i === a))
  }

  return { el, render, mark }
}

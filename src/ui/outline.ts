import type { Editor } from '@tiptap/core'
import type { DocView } from '../editor/docview'
import { h } from '../util'
import { icon } from './icons'
import { headings, moveHeading, shiftHeading, deleteHeadingRange, renameHeading, type HeadingRow } from './commands'
import { confirmBox } from './dialogs'
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
      const row = h('div', { class: `lr l${r.level}${i === act ? ' on' : ''}`, role: 'treeitem', draggable: 'true', style: { paddingLeft: (r.level - 1) * 14 + 'px' } },
        h('span', { class: 'lv' }, num),
        h('span', { class: 'ln' }, r.text || 'Untitled'),
        h('span', { class: 'pg' }, idPage[r.id] || ''),
        h('button', { class: 'lb', title: 'Promote', onclick: (e: Event) => { e.stopPropagation(); shiftHeading(ed, r.pos, -1) } }, icon('levelup')),
        h('button', { class: 'lb', title: 'Demote', onclick: (e: Event) => { e.stopPropagation(); shiftHeading(ed, r.pos, 1) } }, icon('leveldown')),
        h('button', { class: 'lb', title: 'Delete section', onclick: async (e: Event) => {
          e.stopPropagation()
          if (await confirmBox('Delete section?', `“${r.text || 'Untitled'}” and everything under it will be removed. You can undo this.`)) deleteHeadingRange(ed, r.pos)
        } }, icon('trash')))
      row.addEventListener('click', () => {
        ed.chain().setTextSelection(r.pos + 1).focus(undefined, { scrollIntoView: false }).run()
        dv.scrollToPos(r.pos)
      })
      row.addEventListener('dblclick', e => {
        e.preventDefault()
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
      })
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

  const mark = () => {
    const a = activeIdx()
    list.querySelectorAll('.lr').forEach((r, i) => r.classList.toggle('on', i === a))
  }

  return { el, render, mark }
}

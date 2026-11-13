import type { Editor } from '@tiptap/core'
import { h } from '../util'
import { setQuery, step, replaceCurrent, replaceAll, searchState, type Query } from '../editor/search'
import { toast } from './dialogs'

let open: { el: HTMLElement; focus(replace: boolean): void; close(): void } | null = null
const last: Query & { rep: string } = { text: '', caseSensitive: false, wholeWord: false, regex: false, rep: '' }

/** Find and replace bar. Ctrl+F finds, Ctrl+H also shows the replace field. */
export function findPanel(ed: Editor, host: HTMLElement, withReplace: boolean) {
  const sel = ed.state.selection
  const picked = !sel.empty && sel.$from.sameParent(sel.$to) ? ed.state.doc.textBetween(sel.from, sel.to) : ''
  if (picked && picked.length < 200) last.text = picked
  if (open && !open.el.isConnected) open = null
  if (open) { open.focus(withReplace); return open }

  const q = h('input', { type: 'text', placeholder: 'Find', 'aria-label': 'Find', value: last.text, spellcheck: 'false' }) as HTMLInputElement
  const r = h('input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', value: last.rep, spellcheck: 'false' }) as HTMLInputElement
  const count = h('span', { class: 'fcount' })
  const opt = (label: string, title: string, k: 'caseSensitive' | 'wholeWord' | 'regex') => {
    const b = h('button', { class: 'fopt' + (last[k] ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': String(last[k]), onclick: () => { last[k] = !last[k]; b.classList.toggle('on', last[k]); b.setAttribute('aria-pressed', String(last[k])); run() } }, label)
    return b
  }
  const repRow = h('div', { class: 'frow' }, r,
    h('button', { onclick: () => { last.rep = r.value; replaceCurrent(ed.view, r.value); show() } }, 'Replace'),
    h('button', { onclick: () => { last.rep = r.value; const n = replaceAll(ed.view, r.value); toast(n ? `Replaced ${n}` : 'Nothing to replace'); show() } }, 'All'))
  const toggle = h('button', { class: 'ic ftog', 'aria-label': 'Show replace', title: 'Replace', onclick: () => setRep(!el.classList.contains('rep')) }, '⇅')
  const el = h('div', { class: 'findp', role: 'search' },
    h('div', { class: 'frow' }, toggle, q, opt('Aa', 'Match case', 'caseSensitive'), opt('W', 'Whole words', 'wholeWord'), opt('.*', 'Regular expression', 'regex'), count,
      h('button', { class: 'ic', 'aria-label': 'Previous match', onclick: () => { step(ed.view, -1); show() } }, '↑'),
      h('button', { class: 'ic', 'aria-label': 'Next match', onclick: () => { step(ed.view, 1); show() } }, '↓'),
      h('button', { class: 'ic', 'aria-label': 'Close', onclick: () => close() }, '✕')),
    repRow)

  function setRep(on: boolean) { el.classList.toggle('rep', on); if (on) r.focus() }
  function show() {
    const s = searchState(ed.state)
    count.textContent = s.error ? s.error : !q.value ? '' : s.matches.length ? `${s.cur + 1} of ${s.matches.length}` : 'No results'
    count.classList.toggle('bad', !!s.error || (!!q.value && !s.matches.length))
  }
  function run() {
    last.text = q.value
    setQuery(ed.view, q.value ? { text: q.value, caseSensitive: last.caseSensitive, wholeWord: last.wholeWord, regex: last.regex } : null)
    const s = searchState(ed.state)
    if (s.cur >= 0) step(ed.view, 1), step(ed.view, -1)
    show()
  }
  q.addEventListener('input', run)
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); step(ed.view, e.shiftKey ? -1 : 1); show() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  r.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); last.rep = r.value; if (e.ctrlKey || e.metaKey) replaceAll(ed.view, r.value); else replaceCurrent(ed.view, r.value); show() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close() } })
  const onTr = () => show()
  ed.on('transaction', onTr)
  function close() {
    ed.off('transaction', onTr)
    setQuery(ed.view, null)
    el.remove()
    open = null
    ed.commands.focus()
  }
  host.append(el)
  open = { el, close, focus(rep: boolean) { if (rep) setRep(true); else { q.focus(); q.select() }; if (picked) { q.value = last.text; run() } } }
  setRep(withReplace)
  if (!withReplace) { q.focus(); q.select() }
  run()
  return open
}

export function closeFind() { open?.close() }

import type { Editor } from '@tiptap/core'
import { h } from '../util'
import { spellHits, type SpellHit } from './plugin'
import { suggest, addUserWord, onSpellChange, userWords, setUserWords } from './engine'
import { getSettings } from '../layout/plugin'
import { modal } from '../ui/dialogs'

let open: { el: HTMLElement; close(): void } | null = null

/** A floating spelling panel that walks through the document's errors from the cursor onwards. */
export function spellingPanel(ed: Editor, host: HTMLElement) {
  if (open) { open.close(); }
  const word = h('div', { class: 'spw' })
  const ctx = h('div', { class: 'spc' })
  const list = h('div', { class: 'spl', role: 'listbox' })
  const repl = h('input', { type: 'text', 'aria-label': 'Change to' }) as HTMLInputElement
  const count = h('span', { class: 'mute' })
  const btn = (label: string, run: () => void, cls = '') => h('button', { class: cls, onclick: run }, label)
  let cur: SpellHit | null = null
  let token = 0

  const el = h('div', { class: 'spellp', role: 'dialog', 'aria-label': 'Spelling' },
    h('div', { class: 'sph' }, h('b', {}, 'Spelling'), count, h('span', { class: 'sp' }), h('button', { class: 'ic', 'aria-label': 'Close', onclick: () => close() }, '✕')),
    word, ctx,
    h('label', { class: 'f' }, 'Change to', repl),
    list,
    h('div', { class: 'spb' },
      btn('Change', () => change(false), 'pri'), btn('Change all', () => change(true)),
      btn('Ignore', () => { skipped.add(key(cur)); next() }), btn('Ignore all', ignoreAll),
      btn('Add to dictionary', () => { if (cur) addUserWord(cur.word); next(true) })),
    h('div', { class: 'spb sp2' }, btn('Dictionary…', () => editDictionary()))
  )
  const skipped = new Set<string>()
  const key = (x: SpellHit | null) => (x ? x.from + ':' + x.word : '')
  let start = ed.state.selection.from

  function pick(): SpellHit | null {
    const hits = spellHits(ed.state).filter(x => !skipped.has(key(x)))
    count.textContent = hits.length ? `${hits.length} to review` : ''
    return hits.find(x => x.from >= start) || hits[0] || null
  }

  async function show(x: SpellHit | null) {
    cur = x
    const my = ++token
    list.innerHTML = ''
    if (!x) {
      word.textContent = 'No spelling errors found.'
      ctx.textContent = ''
      repl.value = ''
      el.classList.add('done')
      return
    }
    el.classList.remove('done')
    word.textContent = x.word
    const $p = ed.state.doc.resolve(x.from)
    const blockStart = $p.start(), text = $p.parent.textBetween(0, $p.parent.content.size, ' ', ' ')
    const a = x.from - blockStart, b = x.to - blockStart
    const s = Math.max(0, a - 50), e = Math.min(text.length, b + 50)
    ctx.innerHTML = ''
    ctx.append((s > 0 ? '…' : '') + text.slice(s, a), h('mark', {}, text.slice(a, b)), text.slice(b, e) + (e < text.length ? '…' : ''))
    ed.chain().setTextSelection({ from: x.from, to: x.to }).scrollIntoView().run()
    const sug = await suggest(x.lang, x.word)
    if (my !== token) return
    repl.value = sug[0] || x.word
    if (!sug.length) list.append(h('div', { class: 'mute' }, 'No suggestions'))
    for (const s of sug) list.append(h('button', { role: 'option', onclick: () => { repl.value = s }, ondblclick: () => { repl.value = s; change(false) } }, s))
  }

  function next(wait = false) {
    if (cur) start = cur.from
    if (wait) setTimeout(() => show(pick()), 120); else show(pick())
  }

  function change(all: boolean) {
    if (!cur) return
    const to = repl.value
    const targets = all ? spellHits(ed.state).filter(x => x.word === cur!.word) : [cur]
    let tr = ed.state.tr
    for (const t of [...targets].sort((a, b) => b.from - a.from)) {
      const marks = ed.state.doc.resolve(t.from + 1).marks()
      tr = tr.replaceWith(t.from, t.to, ed.schema.text(to, marks))
    }
    if (to) ed.view.dispatch(tr)
    start = cur.from + to.length
    setTimeout(() => show(pick()), 320)
  }

  function ignoreAll() {
    if (!cur) return
    const st = getSettings(ed.state.doc)
    ed.view.dispatch(ed.state.tr.setDocAttribute('settings', { ...st, spellIgnore: [...(st.spellIgnore || []), cur.word] }))
    next(true)
  }

  repl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); change(false) } })
  const off = onSpellChange(() => { if (!cur) show(pick()) })
  const keyH = (e: KeyboardEvent) => { if (e.key === 'Escape' && el.contains(document.activeElement)) close() }
  document.addEventListener('keydown', keyH)
  function close() { off(); document.removeEventListener('keydown', keyH); el.remove(); open = null; ed.commands.focus() }
  host.append(el)
  open = { el, close }
  // Give the checker a moment if the document was only just opened.
  setTimeout(() => show(pick()), spellHits(ed.state).length ? 0 : 400)
  return open
}

export function editDictionary() {
  const ta = h('textarea', { rows: 12, spellcheck: 'false', placeholder: 'One word per line' }) as HTMLTextAreaElement
  ta.value = [...userWords()].sort().join('\n')
  const m = modal('Personal dictionary', [
    h('div', { class: 'hint' }, 'Words here are never marked as misspelled, in any document.'),
    ta,
    h('div', { class: 'row' }, h('button', { onclick: () => m.close() }, 'Cancel'), h('button', { class: 'pri', onclick: () => { setUserWords(ta.value.split(/\s+/)); m.close() } }, 'Save'))
  ])
}

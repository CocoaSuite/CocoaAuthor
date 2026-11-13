// Find and replace: matches are highlighted with decorations; replacing goes through normal transactions.
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

export interface Query { text: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export interface Match { from: number; to: number; groups: string[] }
interface St { q: Query | null; matches: Match[]; cur: number; deco: DecorationSet; error: string }

export const searchKey = new PluginKey<St>('caSearch')
const EMPTY: St = { q: null, matches: [], cur: -1, deco: DecorationSet.empty, error: '' }

export function buildRegex(q: Query): RegExp | null {
  if (!q.text) return null
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (q.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`
  return new RegExp(src, 'gu' + (q.caseSensitive ? '' : 'i'))
}

/** Every match in the document's text blocks. A match never crosses from one paragraph into the next. */
export function findAll(state: EditorState, q: Query): { matches: Match[]; error: string } {
  let re: RegExp | null
  try { re = buildRegex(q) } catch (e: any) { return { matches: [], error: 'Invalid pattern' } }
  if (!re) return { matches: [], error: '' }
  const out: Match[] = []
  state.doc.descendants((n, pos) => {
    if (!n.isTextblock) return true
    let text = ''
    n.forEach(ch => { text += ch.isText ? ch.text : '￼'.repeat(ch.nodeSize) })
    re!.lastIndex = 0
    for (let m = re!.exec(text); m; m = re!.exec(text)) {
      if (!m[0].length) { re!.lastIndex++; continue }
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length, groups: [...m] })
      if (out.length > 20000) return false
    }
    return false
  })
  return { matches: out, error: '' }
}

function decos(state: EditorState, matches: Match[], cur: number) {
  return DecorationSet.create(state.doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === cur ? 'ca-find cur' : 'ca-find' })))
}

export function searchPlugin() {
  return new Plugin<St>({
    key: searchKey,
    state: {
      init: () => EMPTY,
      apply(tr, v, _o, ns) {
        const m = tr.getMeta(searchKey) as { q?: Query | null; cur?: number } | undefined
        if (m && 'q' in m) {
          if (!m.q) return EMPTY
          const r = findAll(ns, m.q)
          const from = ns.selection.from
          let cur = r.matches.findIndex(x => x.from >= from)
          if (cur < 0) cur = r.matches.length ? 0 : -1
          return { q: m.q, matches: r.matches, cur, deco: decos(ns, r.matches, cur), error: r.error }
        }
        if (m && m.cur != null && v.q) return { ...v, cur: m.cur, deco: decos(ns, v.matches, m.cur) }
        if (tr.docChanged && v.q) {
          const r = findAll(ns, v.q)
          const cur = Math.min(v.cur, r.matches.length - 1)
          return { q: v.q, matches: r.matches, cur, deco: decos(ns, r.matches, cur), error: r.error }
        }
        return v
      }
    },
    props: { decorations: st => searchKey.getState(st)?.deco }
  })
}

export const searchState = (s: EditorState) => searchKey.getState(s) || EMPTY

export function setQuery(view: EditorView, q: Query | null) {
  view.dispatch(view.state.tr.setMeta(searchKey, { q }).setMeta('addToHistory', false))
}

/** Move to the next (dir 1) or previous (dir -1) match and select it. */
export function step(view: EditorView, dir: 1 | -1) {
  const s = searchState(view.state)
  if (!s.matches.length) return
  const cur = ((s.cur < 0 ? (dir > 0 ? -1 : 0) : s.cur) + dir + s.matches.length) % s.matches.length
  reveal(view, cur)
}

export function reveal(view: EditorView, cur: number) {
  const s = searchState(view.state)
  const m = s.matches[cur]
  if (!m) return
  view.dispatch(view.state.tr.setMeta(searchKey, { cur }).setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView().setMeta('addToHistory', false))
}

const expand = (rep: string, m: Match, regex: boolean) =>
  regex ? rep.replace(/\$(\d{1,2}|&)/g, (_, g) => (g === '&' ? m.groups[0] : m.groups[+g] ?? '')).replace(/\\n/g, '\n').replace(/\\t/g, '\t') : rep

export function replaceCurrent(view: EditorView, rep: string) {
  const s = searchState(view.state)
  const m = s.matches[s.cur]
  if (!m || !s.q) return
  const text = expand(rep, m, s.q.regex)
  const tr = view.state.tr
  if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to)
  view.dispatch(tr)
  // Go on to the match after the replaced text.
  const after = searchState(view.state)
  const next = after.matches.findIndex(x => x.from >= m.from + text.length)
  if (after.matches.length) reveal(view, next < 0 ? 0 : next)
}

export function replaceAll(view: EditorView, rep: string): number {
  const s = searchState(view.state)
  if (!s.q || !s.matches.length) return 0
  const tr = view.state.tr
  for (const m of [...s.matches].reverse()) {
    const text = expand(rep, m, s.q.regex)
    if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to)
  }
  view.dispatch(tr)
  return s.matches.length
}

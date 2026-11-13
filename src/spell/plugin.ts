import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { getSettings } from '../layout/plugin'
import { isCorrect, langFor, onSpellChange, type SpellLang } from './engine'

export interface SpellHit { from: number; to: number; word: string; lang: SpellLang }
interface Tok { off: number; len: number; word: string; lang: SpellLang }

export const spellKey = new PluginKey<{ decos: DecorationSet; hits: SpellHit[] }>('caSpell')

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu
const SKIP = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\S+\.(?:com|org|net|ru|io|dev)\b\S*/giu
const tokCache = new WeakMap<PMNode, { en: SpellLang; toks: Tok[] }>()

const isCode = (n: PMNode) => n.marks.some(m => m.type.name === 'textStyle' && /mono/i.test(m.attrs.fontFamily || ''))

function tokens(block: PMNode, en: SpellLang): Tok[] {
  const c = tokCache.get(block)
  if (c && c.en === en) return c.toks
  let text = ''
  const skip: [number, number][] = []
  block.forEach(ch => {
    if (ch.isText) {
      if (isCode(ch)) skip.push([text.length, text.length + ch.text!.length])
      text += ch.text
    } else text += '￼'.repeat(ch.nodeSize)
  })
  for (const m of text.matchAll(SKIP)) skip.push([m.index!, m.index! + m[0].length])
  const toks: Tok[] = []
  for (const m of text.matchAll(WORD)) {
    const off = m.index!, raw = m[0], end = off + raw.length
    if (raw.length < 2 || skip.some(([a, b]) => off < b && end > a)) continue
    if (/\p{N}/u.test(text[off - 1] || '') || /\p{N}/u.test(text[end] || '')) continue
    if (/\p{Lu}/u.test(raw.slice(1))) continue // ALL CAPS, acronyms, CamelCase
    const word = raw.replace(/’/g, "'")
    const lang = langFor(word, en)
    if (lang) toks.push({ off, len: raw.length, word, lang })
  }
  tokCache.set(block, { en, toks })
  return toks
}

function compute(state: EditorState, skipAt: number | null): { decos: DecorationSet; hits: SpellHit[] } {
  const s = getSettings(state.doc)
  if (s.spell === false) return { decos: DecorationSet.empty, hits: [] }
  const en: SpellLang = s.lang === 'en-GB' ? 'en-GB' : 'en-US'
  const ignore = new Set((s.spellIgnore || []).map(x => x.toLowerCase()))
  const decos: Decoration[] = []
  const hits: SpellHit[] = []
  state.doc.descendants((n, pos) => {
    if (!n.isTextblock) return true
    for (const t of tokens(n, en)) {
      const from = pos + 1 + t.off, to = from + t.len
      if (skipAt != null && skipAt >= from && skipAt <= to) continue
      if (ignore.has(t.word.toLowerCase())) continue
      if (isCorrect(t.lang, t.word) === false) {
        hits.push({ from, to, word: t.word, lang: t.lang })
        decos.push(Decoration.inline(from, to, { class: 'ca-spx' }))
      }
    }
    return false
  })
  return { decos: DecorationSet.create(state.doc, decos), hits }
}

export function spellPlugin() {
  return new Plugin({
    key: spellKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, hits: [] as SpellHit[] }),
      apply(tr, v) {
        const m = tr.getMeta(spellKey)
        if (m) return m
        if (!tr.docChanged) return v
        return { decos: v.decos.map(tr.mapping, tr.doc), hits: v.hits.map(h => ({ ...h, from: tr.mapping.map(h.from), to: tr.mapping.map(h.to, -1) })).filter(h => h.to > h.from) }
      }
    },
    props: { decorations: st => spellKey.getState(st)?.decos },
    view(view: EditorView) {
      let t: any = null
      let typing = false
      let lastDoc = view.state.doc
      const run = () => {
        t = null
        if ((view as any).isDestroyed) return
        const sel = view.state.selection
        const skip = typing && sel.empty ? sel.head : null
        view.dispatch(view.state.tr.setMeta(spellKey, compute(view.state, skip)).setMeta('addToHistory', false))
      }
      const schedule = (ms: number) => { clearTimeout(t); t = setTimeout(run, ms) }
      const off = onSpellChange(() => schedule(20))
      schedule(50)
      return {
        update(v, prev) {
          if (v.state.doc !== lastDoc) {
            lastDoc = v.state.doc
            typing = true
            schedule(250)
          } else if (!v.state.selection.eq(prev.selection) && typing) {
            typing = false
            schedule(150)
          } else if (v.state.doc.attrs.settings !== prev.doc.attrs.settings) schedule(20)
        },
        destroy() { clearTimeout(t); off() }
      }
    }
  })
}

export function spellAt(state: EditorState, pos: number): SpellHit | null {
  return spellKey.getState(state)?.hits.find(h => pos >= h.from && pos <= h.to) || null
}

export function spellHits(state: EditorState): SpellHit[] {
  return spellKey.getState(state)?.hits || []
}

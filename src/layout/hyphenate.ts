// Hyphenation for export: soft hyphens are written into a copy of the document, so the browser
// breaks lines at them and the PDF writer can draw the hyphen where a line actually broke.
import { resolvePara, rootKey, findCustom } from '../model/styles'
import type { PageSettings, StyleSet } from '../model/types'

export const SHY = '­'
type Hy = (w: string) => string
const loaded = new Map<string, Promise<Hy>>()

function hyphenator(lang: 'en-us' | 'en-gb' | 'ru'): Promise<Hy> {
  let p = loaded.get(lang)
  if (!p) {
    const mod = lang === 'ru' ? import('hyphen/ru') : lang === 'en-gb' ? import('hyphen/en-gb') : import('hyphen/en-us')
    p = mod.then((m: any) => {
      const h = (m.default || m).hyphenateSync as (s: string, o?: any) => string
      return (w: string) => h(w, { hyphenChar: SHY })
    })
    loaded.set(lang, p)
  }
  return p
}

const CYR = /\p{Script=Cyrillic}/u
const WORD = /[\p{L}\p{M}]{5,}/gu
const NO_AUTO = new Set(['title', 'subtitle', 'caption', 'h1', 'h2', 'h3', 'h4', 'header', 'footnote'])

/** Keep at least two letters before a break and two (Russian) or three (English) after it. */
function trim(h: string, ru: boolean) {
  const parts = h.split(SHY)
  if (parts.length < 2) return h
  const minL = 2, minR = ru ? 2 : 3
  let out = ''
  let before = 0
  const total = parts.join('').length
  parts.forEach((p, i) => {
    out += p
    before += p.length
    if (i < parts.length - 1 && before >= minL && total - before >= minR) out += SHY
  })
  return out
}

export async function hyphenateContent(content: any, settings: PageSettings, S: StyleSet): Promise<any> {
  const en: 'en-us' | 'en-gb' = settings.lang === 'en-GB' ? 'en-gb' : 'en-us'
  const want = (styleId: string) => {
    const t = resolvePara(S, styleId)
    if (t.hyphenate != null) return t.hyphenate
    return !!settings.hyphenate && !NO_AUTO.has(rootKey(S, styleId))
  }
  // Collect which paragraphs to hyphenate before loading any patterns.
  const jobs: any[] = []
  const walk = (n: any, ctx: string) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'paragraph' || n.type === 'heading') {
      const a = n.attrs || {}
      const id = a.pstyle && findCustom(S, a.pstyle) ? a.pstyle
        : n.type === 'heading' ? 'h' + Math.min(4, a.level || 1)
        : a.kind && a.kind !== 'body' ? a.kind : ctx
      if (want(id)) jobs.push(n)
      return
    }
    const next = n.type === 'blockquote' ? 'quote' : n.type === 'listItem' ? 'list' : n.type === 'tableCell' || n.type === 'tableHeader' ? 'table' : ctx
    for (const c of n.content || []) walk(c, next)
  }
  const copy = structuredClone(content)
  walk(copy, 'body')
  if (!jobs.length) return content
  const hyEn = await hyphenator(en).catch(() => null)
  const hyRu = await hyphenator('ru').catch(() => null)
  for (const p of jobs) {
    for (const t of p.content || []) {
      if (t.type !== 'text' || !t.text) continue
      if ((t.marks || []).some((m: any) => m.type === 'link' || (m.type === 'textStyle' && /mono/i.test(m.attrs?.fontFamily || '')))) continue
      t.text = t.text.replace(WORD, (w: string, off: number, all: string) => {
        if (/[\p{N}@/\\_.]/u.test(all[off - 1] || '') || /[\p{N}@/\\_]/u.test(all[off + w.length] || '')) return w
        if (w === w.toUpperCase()) return w
        const ru = CYR.test(w)
        const hy = ru ? hyRu : hyEn
        return hy ? trim(hy(w), ru) : w
      })
    }
  }
  return copy
}

import { STYLE_KEYS, defaultStyles, type CustomStyle, type StyleKey, type StyleSet, type TextStyleDef } from './types'

export const isBuiltin = (k: string): k is StyleKey => (STYLE_KEYS as readonly string[]).includes(k)
export const customs = (S: StyleSet) => S.custom || []
export const findCustom = (S: StyleSet, id: string) => customs(S).find(c => c.id === id)

/** The chain of custom styles from the given one back to its root, guarding against loops. */
function chain(S: StyleSet, id: string): CustomStyle[] {
  const out: CustomStyle[] = []
  const seen = new Set<string>()
  let c = findCustom(S, id)
  while (c && !seen.has(c.id)) { seen.add(c.id); out.unshift(c); c = findCustom(S, c.base) }
  return out
}

/** The built-in style a custom paragraph style ultimately builds on. */
export function rootKey(S: StyleSet, id: string): StyleKey {
  if (isBuiltin(id)) return id
  const ch = chain(S, id)
  const b = ch[0]?.base
  return b && isBuiltin(b) ? b : 'body'
}

/** Full text definition of a paragraph style (built-in or custom). */
export function resolvePara(S: StyleSet, id: string): TextStyleDef {
  const text = { ...defaultStyles().text, ...(S.text || {}) }
  if (isBuiltin(id)) return text[id]
  let t: TextStyleDef = { ...text[rootKey(S, id)] }
  for (const c of chain(S, id)) t = { ...t, ...c.o }
  return t
}

/** Only what a character style sets, including what it inherits from other character styles. */
export function resolveChar(S: StyleSet, id: string): Partial<TextStyleDef> {
  let t: Partial<TextStyleDef> = {}
  for (const c of chain(S, id)) t = { ...t, ...c.o }
  return t
}

/** Everything a style inherits, so the editor can show which values are overridden. */
export function inherited(S: StyleSet, c: CustomStyle): Partial<TextStyleDef> {
  if (c.type === 'char') return c.base ? resolveChar(S, c.base) : {}
  return resolvePara(S, c.base || 'body')
}

export const cssId = (id: string) => id.replace(/[^\w-]/g, '_')

export function featureCSS(t: Partial<TextStyleDef>): string {
  const f: string[] = []
  if (t.kern === false) f.push('"kern" 0')
  if (t.liga === false) f.push('"liga" 0', '"clig" 0')
  if (t.dlig) f.push('"dlig" 1')
  if (t.smcp) f.push('"smcp" 1')
  if (t.onum) f.push('"onum" 1')
  if (t.tnum) f.push('"tnum" 1')
  let css = f.length ? `font-feature-settings:${f.join(',')};` : ''
  if (t.kern === false) css += 'font-kerning:none;'
  if (t.liga === false) css += 'font-variant-ligatures:no-common-ligatures;'
  return css
}

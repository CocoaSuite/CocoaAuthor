import { defaultStyles, type StyleSet, type TextStyleDef } from '../model/types'
import { customs, resolvePara, resolveChar, cssId, featureCSS } from '../model/styles'

const fam = (f: string) => `"${f}", Inter, sans-serif`

function decl(t: TextStyleDef) {
  return `font-family:${fam(t.font)};font-size:${t.size}px;font-weight:${t.weight};font-style:${t.italic ? 'italic' : 'normal'};color:${t.color};line-height:${t.lineHeight};margin-top:${t.before}px;margin-bottom:${t.after}px;text-align:${t.align};letter-spacing:${t.tracking}em;text-transform:${t.caps ? 'uppercase' : 'none'};text-indent:${t.firstLine || 0}px;${t.indent ? `margin-left:${t.indent}px;` : ''}${featureCSS(t)}${hyph(t)}`
}

function run(t: TextStyleDef) {
  return `font-family:${fam(t.font)};font-size:${t.size}px;font-weight:${t.weight};font-style:${t.italic ? 'italic' : 'normal'};color:${t.color};line-height:${t.lineHeight};letter-spacing:${t.tracking}em;text-transform:${t.caps ? 'uppercase' : 'none'};${featureCSS(t)}`
}

const hyph = (t: TextStyleDef) => (t.hyphenate === true ? 'hyphens:auto;' : t.hyphenate === false ? 'hyphens:manual;' : '')

/** Only the properties a character style sets. */
function partial(t: Partial<TextStyleDef>) {
  let c = ''
  if (t.font) c += `font-family:${fam(t.font)};`
  if (t.size) c += `font-size:${t.size}px;`
  if (t.weight) c += `font-weight:${t.weight};`
  if (t.italic != null) c += `font-style:${t.italic ? 'italic' : 'normal'};`
  if (t.color) c += `color:${t.color};`
  if (t.tracking != null) c += `letter-spacing:${t.tracking}em;`
  if (t.caps != null) c += `text-transform:${t.caps ? 'uppercase' : 'none'};`
  return c + featureCSS(t)
}

function customCSS(s: StyleSet, R: string) {
  let css = ''
  for (const c of customs(s)) {
    const k = cssId(c.id)
    if (c.type === 'para') css += `${R} .ps-${k}.ps-${k}{${decl(resolvePara(s, c.id))}}\n`
    else css += `${R} .cs-${k}{${partial(resolveChar(s, c.id))}}\n`
  }
  return css
}

export function docCSS(st: StyleSet | null, scope = '.ca-flow'): string {
  const s = { ...defaultStyles(), ...(st || {}) } as StyleSet
  s.text = { ...defaultStyles().text, ...(st?.text || {}) }
  const T = s.text
  const R = scope + ' .ProseMirror'
  return `
${scope}{--accent:${s.accent};--link:${s.link};--grid:${s.grid};--thead:${s.tableHead};--callout:${s.calloutBg}}
${R} .k-body{${decl(T.body)}}
${R} .k-title{${decl(T.title)}}
${R} .k-subtitle{${decl(T.subtitle)}}
${R} .k-caption{${decl(T.caption)}}
${R} .k-h1{${decl(T.h1)}}
${R} .k-h2{${decl(T.h2)}}
${R} .k-h3{${decl(T.h3)}}
${R} .k-h4{${decl(T.h4)}}
${R} blockquote p.k-body{${decl(T.quote)}}
${R} li p.k-body{${decl(T.list)}}
${R} td p.k-body,${R} th p.k-body{${decl(T.table)}}
${R} th p.k-body{font-weight:${Math.max(600, T.table.weight)}}
${R} .ca-toct{${decl(T.h1)};text-align:left}
${R} .ca-toce{${run(T.body)}}
${R} .ca-toce.l1{font-weight:600}
${R} .ca-ent{${decl(T.h2)}}
${R} .ca-en{${run(T.footnote)};padding-bottom:${T.footnote.after}px}
${scope} .ca-fnb{${run(T.footnote)};padding-bottom:${T.footnote.after}px}
${scope} .ca-hf{${run(T.header)}}
${R} .ca-callout p.k-body{${decl(T.body)}}
${R} a,${R} .ca-xref{color:var(--link)}
${customCSS(s, R)}`
}

export function applyDocCSS(st: StyleSet | null) {
  let el = document.getElementById('ca-docstyle') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'ca-docstyle'
    document.head.append(el)
  }
  const css = docCSS(st)
  if (el.textContent !== css) el.textContent = css
}

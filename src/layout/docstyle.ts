import { defaultStyles, type StyleSet, type TextStyleDef } from '../model/types'

const fam = (f: string) => `"${f}", Inter, sans-serif`

function decl(t: TextStyleDef) {
  return `font-family:${fam(t.font)};font-size:${t.size}px;font-weight:${t.weight};font-style:${t.italic ? 'italic' : 'normal'};color:${t.color};line-height:${t.lineHeight};margin-top:${t.before}px;margin-bottom:${t.after}px;text-align:${t.align};letter-spacing:${t.tracking}em;text-transform:${t.caps ? 'uppercase' : 'none'}`
}

function run(t: TextStyleDef) {
  return `font-family:${fam(t.font)};font-size:${t.size}px;font-weight:${t.weight};font-style:${t.italic ? 'italic' : 'normal'};color:${t.color};line-height:${t.lineHeight};letter-spacing:${t.tracking}em;text-transform:${t.caps ? 'uppercase' : 'none'}`
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
`
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

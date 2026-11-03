export type Align = 'left' | 'center' | 'right' | 'justify'

export interface TextStyleDef {
  font: string
  size: number
  weight: number
  italic: boolean
  color: string
  lineHeight: number
  before: number
  after: number
  align: Align
  tracking: number
  caps: boolean
}

export const STYLE_KEYS = ['title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'body', 'quote', 'list', 'caption', 'table', 'footnote', 'header'] as const
export type StyleKey = typeof STYLE_KEYS[number]

export const STYLE_NAMES: Record<StyleKey, string> = {
  title: 'Title', subtitle: 'Subtitle', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4',
  body: 'Body text', quote: 'Quote', list: 'List', caption: 'Caption', table: 'Table text', footnote: 'Footnote', header: 'Header & footer'
}

export interface StyleSet {
  text: Record<StyleKey, TextStyleDef>
  accent: string
  link: string
  grid: string
  tableHead: string
  calloutBg: string
}

export interface HF { left: string; center: string; right: string }

export type NumberFormat = 'decimal' | 'lower-roman' | 'upper-roman' | 'lower-alpha' | 'upper-alpha'

export interface PageSettings {
  size: string
  width: number
  height: number
  landscape: boolean
  margin: { top: number; right: number; bottom: number; left: number }
  layout: 'pages' | 'continuous'
  headerOn: boolean
  footerOn: boolean
  header: HF
  footer: HF
  firstDifferent: boolean
  firstHeader: HF
  firstFooter: HF
  oddEven: boolean
  evenHeader: HF
  evenFooter: HF
  numberFormat: NumberFormat
  numberStart: number
  background: string
  headingNumbers: boolean
  units: 'mm' | 'in'
}

export type DocStatus = 'draft' | 'review' | 'final'

export interface DocMeta {
  id: string
  title: string
  subtitle: string
  author: string
  subject: string
  keywords: string
  status: DocStatus
  archived: boolean
  template: string
  created: number
  modified: number
}

export interface DocSummary {
  id: string
  title: string
  status: DocStatus
  archived: boolean
  template: string
  created: number
  modified: number
  words: number
  snippet: string
}

export interface AssetInfo { mime: string; name: string; w?: number; h?: number }

export interface CADocument {
  format: 'cocoaauthor'
  version: 1
  meta: DocMeta
  content: any
  assets: Record<string, AssetInfo>
}

export const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A5: [419.53, 595.28],
  A3: [841.89, 1190.55],
  Tabloid: [792, 1224]
}

const t = (o: Partial<TextStyleDef>): TextStyleDef => ({
  font: 'Inter', size: 10.5, weight: 400, italic: false, color: '#1d1d1f', lineHeight: 1.5,
  before: 0, after: 8, align: 'left', tracking: 0, caps: false, ...o
})

export function defaultStyles(): StyleSet {
  return {
    text: {
      title: t({ font: 'Playfair Display', size: 34, weight: 600, lineHeight: 1.15, after: 10, color: '#141414' }),
      subtitle: t({ size: 14, color: '#5b6472', lineHeight: 1.4, after: 24 }),
      h1: t({ font: 'Playfair Display', size: 22, weight: 600, lineHeight: 1.2, before: 18, after: 10, color: '#141414' }),
      h2: t({ size: 15, weight: 600, lineHeight: 1.3, before: 14, after: 6, color: '#1f3a66' }),
      h3: t({ size: 12, weight: 600, lineHeight: 1.35, before: 10, after: 4 }),
      h4: t({ size: 10.5, weight: 600, lineHeight: 1.4, before: 8, after: 2, color: '#5b6472', caps: true, tracking: 0.04 }),
      body: t({}),
      quote: t({ font: 'Source Serif 4', size: 12, italic: true, lineHeight: 1.5, color: '#3a3f47', after: 8 }),
      list: t({ after: 3 }),
      caption: t({ size: 8.5, color: '#5b6472', lineHeight: 1.35, before: 4, after: 12 }),
      table: t({ size: 9, lineHeight: 1.35, after: 0 }),
      footnote: t({ size: 7.5, lineHeight: 1.35, after: 2, color: '#3a3f47' }),
      header: t({ size: 8, color: '#7a828e', lineHeight: 1.2, after: 0 })
    },
    accent: '#1f3a66',
    link: '#2f5fb3',
    grid: '#c9ced6',
    tableHead: '#eef1f6',
    calloutBg: '#f1f4f9'
  }
}

const hf = (left = '', center = '', right = ''): HF => ({ left, center, right })

export function defaultSettings(): PageSettings {
  return {
    size: 'A4', width: 595.28, height: 841.89, landscape: false,
    margin: { top: 72, right: 64, bottom: 72, left: 64 },
    layout: 'pages',
    headerOn: true, footerOn: true,
    header: hf('{title}', '', '{section}'),
    footer: hf('', '', '{page}'),
    firstDifferent: true,
    firstHeader: hf(), firstFooter: hf(),
    oddEven: false,
    evenHeader: hf('{section}', '', '{title}'), evenFooter: hf('{page}', '', ''),
    numberFormat: 'decimal', numberStart: 1,
    background: '#ffffff',
    headingNumbers: false,
    units: 'mm'
  }
}

export const FONTS: { name: string; key: string; kind: string }[] = [
  { name: 'Inter', key: 'inter', kind: 'Sans' },
  { name: 'Source Serif 4', key: 'sourceserif', kind: 'Serif' },
  { name: 'Lora', key: 'lora', kind: 'Serif' },
  { name: 'Playfair Display', key: 'playfair', kind: 'Display' },
  { name: 'JetBrains Mono', key: 'jetbrainsmono', kind: 'Mono' }
]

export const FONT_METRICS: Record<string, { asc: number; desc: number }> = {
  inter: { asc: 0.96875, desc: 0.2412109375 },
  sourceserif: { asc: 1.036, desc: 0.335 },
  lora: { asc: 1.006, desc: 0.274 },
  playfair: { asc: 1.082, desc: 0.251 },
  jetbrainsmono: { asc: 1.02, desc: 0.3 }
}

export function fontKey(family: string): string {
  const f = family.split(',')[0].trim().replace(/["']/g, '').toLowerCase()
  const hit = FONTS.find(x => x.name.toLowerCase() === f || x.key === f)
  return hit ? hit.key : 'inter'
}

export function pageDims(s: PageSettings, landscape = s.landscape): [number, number] {
  return landscape ? [s.height, s.width] : [s.width, s.height]
}

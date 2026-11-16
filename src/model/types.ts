export type Align = 'left' | 'center' | 'right' | 'justify'

/** An image or text box placed freely on a page. Positions and sizes are in points from the page's top-left. */
export interface FrameData {
  id: string
  kind: 'image' | 'text'
  page: number
  x: number
  y: number
  w: number
  h: number
  /** around: text wraps; front: over the text; behind: under the text */
  wrap: 'around' | 'front' | 'behind'
  gap: number
  src?: string
  iw?: number
  ih?: number
  fit?: 'fill' | 'fit' | 'stretch' | null
  cx?: number | null
  cy?: number | null
  zoom?: number | null
  cropRect?: { x: number; y: number; w: number; h: number } | null
  alt?: string
  content?: any
  pad?: number
  fill?: string | null
  border?: number
  borderColor?: string
  valign?: 'top' | 'middle' | 'bottom'
  /** Set on import from Word for objects positioned relative to a paragraph: the id of a bookmark in that paragraph
   * and the offset from its top. The first layout turns this into a page and y, then drops the bookmark. */
  anchor?: string
  dy?: number
}

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
  /** Paragraph-level extras; absent means none. */
  firstLine?: number
  indent?: number
  hyphenate?: boolean
  /** Typography; absent means the default (kerning and ligatures on, everything else off). */
  kern?: boolean
  liga?: boolean
  dlig?: boolean
  smcp?: boolean
  onum?: boolean
  tnum?: boolean
}

export const OT_FEATURES: [keyof TextStyleDef, string, string][] = [
  ['kern', 'Kerning', 'kern'], ['liga', 'Ligatures', 'liga'], ['dlig', 'Discretionary ligatures', 'dlig'],
  ['smcp', 'Small caps', 'smcp'], ['onum', 'Old-style figures', 'onum'], ['tnum', 'Tabular figures', 'tnum']
]

export type CharStyleDef = Partial<Pick<TextStyleDef, 'font' | 'size' | 'weight' | 'italic' | 'color' | 'tracking' | 'caps' | 'kern' | 'liga' | 'dlig' | 'smcp' | 'onum' | 'tnum'>>

export interface CustomStyle {
  id: string
  name: string
  type: 'para' | 'char'
  /** A built-in style key or another custom style's id. Character styles may have no base (''). */
  base: string
  o: Partial<TextStyleDef>
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
  custom?: CustomStyle[]
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
  lang: 'en-US' | 'en-GB' | 'ru'
  hyphenate: boolean
  spell: boolean
  spellIgnore: string[]
  /** Keep a paragraph's space before when it starts a page, as Word does (set for imported Word documents). */
  spaceAtTop?: boolean
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

export function defaultLang(): PageSettings['lang'] {
  const l = (typeof navigator !== 'undefined' && navigator.language || 'en-US').toLowerCase()
  return l.startsWith('ru') ? 'ru' : /^en-(gb|ie|au|nz|za|in)/.test(l) ? 'en-GB' : 'en-US'
}

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
    units: 'mm',
    lang: defaultLang(),
    hyphenate: false,
    spell: true,
    spellIgnore: []
  }
}

/**
 * Fonts the app ships. The Word family is metric-compatible with Microsoft's fonts (same widths and line heights),
 * served under the Microsoft names so imported Word documents break lines where Word does and export back unchanged.
 * `weights` lists the files a family has; absent means 400 to 700.
 */
export const FONTS: { name: string; key: string; kind: string; weights?: number[]; word?: boolean }[] = [
  { name: 'Inter', key: 'inter', kind: 'Sans' },
  { name: 'Source Serif 4', key: 'sourceserif', kind: 'Serif' },
  { name: 'Lora', key: 'lora', kind: 'Serif' },
  { name: 'Playfair Display', key: 'playfair', kind: 'Display' },
  { name: 'JetBrains Mono', key: 'jetbrainsmono', kind: 'Mono' },
  { name: 'Calibri', key: 'carlito', kind: 'Word', weights: [400, 700], word: true },
  { name: 'Cambria', key: 'caladea', kind: 'Word', weights: [400, 700], word: true },
  { name: 'Arial', key: 'arimo', kind: 'Word', word: true },
  { name: 'Times New Roman', key: 'tinos', kind: 'Word', weights: [400, 700], word: true },
  { name: 'Courier New', key: 'cousine', kind: 'Word', weights: [400, 700], word: true }
]

/** Ascent and descent (descent includes the line gap) as a share of the font size; together they are Word's single line. */
export const FONT_METRICS: Record<string, { asc: number; desc: number }> = {
  inter: { asc: 0.96875, desc: 0.2412109375 },
  sourceserif: { asc: 1.036, desc: 0.335 },
  lora: { asc: 1.006, desc: 0.274 },
  playfair: { asc: 1.082, desc: 0.251 },
  jetbrainsmono: { asc: 1.02, desc: 0.3 },
  carlito: { asc: 0.9521484375, desc: 0.2685546875 },
  caladea: { asc: 0.9502, desc: 0.2222 },
  arimo: { asc: 0.9052734375, desc: 0.244140625 },
  tinos: { asc: 0.89111328125, desc: 0.2587890625 },
  cousine: { asc: 0.83251953125, desc: 0.30029296875 }
}

/** Other names for the shipped fonts, so pasted or imported text finds the right one. */
const FONT_ALIASES: Record<string, string> = {
  carlito: 'carlito', 'calibri light': 'carlito', caladea: 'caladea', arimo: 'arimo', 'liberation sans': 'arimo', helvetica: 'arimo', 'helvetica neue': 'arimo',
  tinos: 'tinos', 'liberation serif': 'tinos', times: 'tinos', cousine: 'cousine', 'liberation mono': 'cousine', courier: 'cousine'
}

export function fontKey(family: string): string {
  const f = family.split(',')[0].trim().replace(/["']/g, '').toLowerCase()
  const hit = FONTS.find(x => x.name.toLowerCase() === f || x.key === f)
  return hit ? hit.key : FONT_ALIASES[f] || 'inter'
}

/** Font files that exist for a family. */
export const fontWeights = (key: string) => FONTS.find(f => f.key === key)?.weights || [400, 500, 600, 700]

export function pageDims(s: PageSettings, landscape = s.landscape): [number, number] {
  return landscape ? [s.height, s.width] : [s.width, s.height]
}

// Reading the parts of a Word (.docx) package: XML helpers, relationships, theme, styles and numbering.
// Everything is converted to points (pt), the unit CocoaAuthor uses for layout.

import { unzipSync, strFromU8 } from 'fflate'
import type { Align } from '../../model/types'

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main'
}

// ---------- XML helpers ----------

export const kids = (e: Element | null | undefined): Element[] => (e ? Array.from(e.children) : [])
export const child = (e: Element | null | undefined, name: string): Element | null => (e ? kids(e).find(c => c.localName === name) || null : null)
export const childrenNamed = (e: Element | null | undefined, name: string): Element[] => kids(e).filter(c => c.localName === name)
/** First descendant with the local name, in document order. */
export function find(e: Element | null | undefined, name: string): Element | null {
  if (!e) return null
  const all = e.getElementsByTagNameNS('*', name)
  return all.length ? all[0] : null
}
export const findAll = (e: Element | Document | null | undefined, name: string): Element[] => (e ? Array.from(e.getElementsByTagNameNS('*', name)) : [])

/** A w: attribute (also accepts it without the prefix, as some generators write it). */
export function wa(e: Element | null | undefined, name: string): string | null {
  if (!e) return null
  return e.getAttributeNS(NS.w, name) ?? e.getAttribute('w:' + name) ?? e.getAttribute(name)
}
export const ra = (e: Element | null | undefined, name: string): string | null => (e ? e.getAttributeNS(NS.r, name) ?? e.getAttribute('r:' + name) : null)
export const val = (e: Element | null | undefined) => wa(e, 'val')
export const num = (v: string | null | undefined): number | undefined => {
  if (v == null || v === '') return undefined
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}
/** A twip value (1/20 pt) as points. */
export const twip = (v: string | null | undefined) => { const n = num(v); return n == null ? undefined : n / 20 }
export const emu = (v: string | null | undefined) => { const n = num(v); return n == null ? undefined : n / 12700 }
/** On/off properties: present with no value means on. */
export function onOff(e: Element | null | undefined): boolean | undefined {
  if (!e) return undefined
  const v = val(e)
  return v == null || !['0', 'false', 'off', 'none'].includes(v.toLowerCase())
}
export const textOf = (e: Element | null | undefined) => (e ? findAll(e, 't').map(t => t.textContent || '').join('') : '')

// ---------- package ----------

export interface Rel { id: string; type: string; target: string; external: boolean }

export class Pkg {
  files: Record<string, Uint8Array>
  private xmlCache = new Map<string, Document | null>()
  private relCache = new Map<string, Map<string, Rel>>()
  constructor(data: Uint8Array) {
    this.files = unzipSync(data)
  }
  has(path: string) { return !!this.files[path] }
  bytes(path: string): Uint8Array | null { return this.files[path] || null }
  xml(path: string): Document | null {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path)!
    const b = this.files[path]
    let d: Document | null = null
    if (b) {
      d = new DOMParser().parseFromString(strFromU8(b), 'application/xml')
      if (d.getElementsByTagName('parsererror').length) d = null
    }
    this.xmlCache.set(path, d)
    return d
  }
  /** Relationships of a part, with targets resolved to package paths. */
  rels(part: string): Map<string, Rel> {
    let m = this.relCache.get(part)
    if (m) return m
    m = new Map()
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : ''
    const name = part.slice(dir.length)
    const d = this.xml(`${dir}_rels/${name}.rels`)
    for (const r of findAll(d, 'Relationship')) {
      const external = r.getAttribute('TargetMode') === 'External'
      const t = r.getAttribute('Target') || ''
      m.set(r.getAttribute('Id') || '', { id: r.getAttribute('Id') || '', type: r.getAttribute('Type') || '', target: external ? t : resolvePath(dir, t), external })
    }
    this.relCache.set(part, m)
    return m
  }
  relOfType(part: string, suffix: string): Rel | undefined {
    for (const r of this.rels(part).values()) if (r.type.endsWith('/' + suffix)) return r
    return undefined
  }
  mainPart(): string {
    const r = this.relOfType('', 'officeDocument')
    return r?.target || 'word/document.xml'
  }
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dir + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

// ---------- theme ----------

export interface Theme { major: string; minor: string; colors: Record<string, string> }

export function readTheme(pkg: Pkg, main: string): Theme {
  const t: Theme = { major: 'Calibri Light', minor: 'Calibri', colors: {} }
  const rel = pkg.relOfType(main, 'theme')
  const d = rel ? pkg.xml(rel.target) : null
  if (!d) return t
  const fs = find(d.documentElement, 'fontScheme')
  const face = (n: string) => find(child(fs, n), 'latin')?.getAttribute('typeface') || ''
  t.major = face('majorFont') || t.major
  t.minor = face('minorFont') || t.minor
  const cs = find(d.documentElement, 'clrScheme')
  for (const c of kids(cs)) {
    const s = child(c, 'srgbClr')?.getAttribute('val') || child(c, 'sysClr')?.getAttribute('lastClr')
    if (s) t.colors[c.localName] = '#' + s.toLowerCase()
  }
  return t
}

const THEME_NAMES: Record<string, string> = {
  dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2', text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2',
  hyperlink: 'hlink', followedHyperlink: 'folHlink'
}

const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
export function hexOf(r: number, g: number, b: number) { return '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('') }
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]
}

/** A colour from w:color / w:shd style attributes, with theme colours, tints and shades. Null for automatic. */
export function colorOf(e: Element | null, theme: Theme, attr = 'val', themeAttr = 'themeColor'): string | null | undefined {
  if (!e) return undefined
  const tc = wa(e, themeAttr)
  let c: string | null = null
  if (tc) {
    const k = THEME_NAMES[tc] || tc
    c = theme.colors[k] || null
  }
  if (!c) {
    const v = wa(e, attr)
    if (!v) return undefined
    if (v === 'auto') return null
    if (!/^[0-9a-f]{6}$/i.test(v)) return undefined
    c = '#' + v.toLowerCase()
  }
  const tint = wa(e, attr === 'fill' ? 'themeFillTint' : 'themeTint'), shade = wa(e, attr === 'fill' ? 'themeFillShade' : 'themeShade')
  if (tint || shade) {
    let [r, g, b] = rgbOf(c)
    if (tint) { const k = parseInt(tint, 16) / 255; r = r * k + 255 * (1 - k); g = g * k + 255 * (1 - k); b = b * k + 255 * (1 - k) }
    if (shade) { const k = parseInt(shade, 16) / 255; r *= k; g *= k; b *= k }
    c = hexOf(r, g, b)
  }
  return c
}

export const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff'
}

// ---------- properties ----------

/** Character formatting. Only what is set is present. */
export interface RP {
  font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean
  color?: string | null; highlight?: string | null; caps?: boolean; smallCaps?: boolean; vert?: 'super' | 'sub' | null
  spacing?: number; hidden?: boolean; kern?: number; lang?: string; style?: string
}

/** Paragraph formatting. Only what is set is present. firstLine is negative for a hanging indent. */
export interface PP {
  style?: string; align?: Align; left?: number; right?: number; firstLine?: number; before?: number; after?: number
  line?: number; lineRule?: 'auto' | 'exact' | 'atLeast'; keepNext?: boolean; breakBefore?: boolean; contextual?: boolean
  numId?: string; ilvl?: number; outline?: number; bar?: { w: number; gap: number; color: string | null } | null
  shd?: string | null; tabs?: { pos: number; type: string }[]
}

export function parseRPr(e: Element | null, theme: Theme): RP {
  const o: RP = {}
  if (!e) return o
  for (const c of kids(e)) {
    switch (c.localName) {
      case 'rStyle': o.style = val(c) || undefined; break
      case 'rFonts': {
        const th = wa(c, 'asciiTheme') || wa(c, 'hAnsiTheme')
        const f = th ? (th.startsWith('major') ? theme.major : theme.minor) : wa(c, 'ascii') || wa(c, 'hAnsi') || wa(c, 'cs') || wa(c, 'eastAsia')
        if (f) o.font = f
        break
      }
      case 'sz': { const n = num(val(c)); if (n != null) o.size = n / 2; break }
      case 'b': o.bold = onOff(c); break
      case 'i': o.italic = onOff(c); break
      case 'u': { const v = val(c); o.underline = !!v && v !== 'none'; break }
      case 'strike': case 'dstrike': o.strike = onOff(c); break
      case 'color': { const v = colorOf(c, theme); if (v !== undefined) o.color = v; break }
      case 'highlight': { const v = val(c); o.highlight = v && v !== 'none' ? HIGHLIGHT[v] || null : null; break }
      case 'shd': {
        const f = colorOf(c, theme, 'fill', 'themeFill')
        if (f && f !== '#ffffff' && o.highlight === undefined) o.highlight = f
        break
      }
      case 'caps': o.caps = onOff(c); break
      case 'smallCaps': o.smallCaps = onOff(c); break
      case 'vertAlign': { const v = val(c); o.vert = v === 'superscript' ? 'super' : v === 'subscript' ? 'sub' : null; break }
      case 'spacing': o.spacing = twip(val(c)); break
      case 'vanish': o.hidden = onOff(c); break
      case 'kern': o.kern = (num(val(c)) || 0) / 2; break
      case 'lang': { const v = val(c); if (v) o.lang = v; break }
    }
  }
  return o
}

const ALIGN: Record<string, Align> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify', justify: 'justify' }

export function parsePPr(e: Element | null, theme: Theme): PP {
  const o: PP = {}
  if (!e) return o
  for (const c of kids(e)) {
    switch (c.localName) {
      case 'pStyle': o.style = val(c) || undefined; break
      case 'jc': { const v = val(c); if (v && ALIGN[v]) o.align = ALIGN[v]; break }
      case 'ind': {
        const l = twip(wa(c, 'left') ?? wa(c, 'start')), r = twip(wa(c, 'right') ?? wa(c, 'end'))
        const f = twip(wa(c, 'firstLine')), h = twip(wa(c, 'hanging'))
        if (l != null) o.left = l
        if (r != null) o.right = r
        if (h != null) o.firstLine = -h
        else if (f != null) o.firstLine = f
        break
      }
      case 'spacing': {
        const b = twip(wa(c, 'before')), a = twip(wa(c, 'after')), ln = num(wa(c, 'line'))
        if (b != null) o.before = b
        if (a != null) o.after = a
        if (onOff(attrEl(c, 'beforeAutospacing'))) o.before = 14
        if (onOff(attrEl(c, 'afterAutospacing'))) o.after = 14
        if (ln != null) { o.line = ln; const r = wa(c, 'lineRule'); o.lineRule = r === 'exact' ? 'exact' : r === 'atLeast' ? 'atLeast' : 'auto' }
        break
      }
      case 'keepNext': o.keepNext = onOff(c); break
      case 'pageBreakBefore': o.breakBefore = onOff(c); break
      case 'contextualSpacing': o.contextual = onOff(c); break
      case 'numPr': {
        const id = val(child(c, 'numId')), lv = num(val(child(c, 'ilvl')))
        if (id != null) o.numId = id
        if (lv != null) o.ilvl = lv
        break
      }
      case 'outlineLvl': { const n = num(val(c)); if (n != null) o.outline = n; break }
      case 'pBdr': {
        const l = child(c, 'left') || child(c, 'start')
        const v = val(l)
        if (l && v && v !== 'none' && v !== 'nil') o.bar = { w: Math.max(0.5, (num(wa(l, 'sz')) || 4) / 8), gap: num(wa(l, 'space')) || 4, color: colorOf(l, theme, 'color') || null }
        else if (l) o.bar = null
        break
      }
      case 'shd': { const f = colorOf(c, theme, 'fill', 'themeFill'); if (f !== undefined) o.shd = f; break }
      case 'tabs': o.tabs = childrenNamed(c, 'tab').filter(t => val(t) !== 'clear').map(t => ({ pos: twip(wa(t, 'pos')) || 0, type: val(t) || 'left' })); break
    }
  }
  return o
}

/** spacing's autospacing flags are attributes; wrap one as a fake element for onOff. */
function attrEl(e: Element, name: string): Element | null {
  const v = wa(e, name)
  if (v == null) return null
  const f = e.ownerDocument.createElementNS(NS.w, 'w:x')
  f.setAttributeNS(NS.w, 'w:val', v)
  return f
}

const defined = <T extends object>(o: T): Partial<T> => { const r: any = {}; for (const k in o) if ((o as any)[k] !== undefined) r[k] = (o as any)[k]; return r }
export const mergeP = (...ps: PP[]): PP => Object.assign({}, ...ps.map(defined))
export const mergeR = (...rs: RP[]): RP => Object.assign({}, ...rs.map(defined))

// ---------- styles ----------

export interface Borders { top?: string | null; left?: string | null; bottom?: string | null; right?: string | null; insideH?: string | null; insideV?: string | null }
export interface TblProps { borders: Borders; mar: { top?: number; left?: number; bottom?: number; right?: number }; shd?: string | null; look?: Record<string, boolean> }
export interface Cond { pp: PP; rp: RP; shd?: string | null }
export interface StyleDef {
  id: string; name: string; type: string; basedOn?: string; isDefault: boolean
  pp: PP; rp: RP; tbl?: TblProps; cond: Record<string, Cond>
}

/** A border: null for none, a colour (or '#000000' for automatic) otherwise. */
function borderOf(e: Element | null, theme: Theme): string | null | undefined {
  if (!e) return undefined
  const v = val(e)
  if (!v || v === 'none' || v === 'nil') return null
  return colorOf(e, theme, 'color') || '#000000'
}

export function parseTblPr(e: Element | null, theme: Theme): TblProps {
  const t: TblProps = { borders: {}, mar: {} }
  if (!e) return t
  const b = child(e, 'tblBorders')
  if (b) for (const k of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const) {
    const el = child(b, k) || (k === 'left' ? child(b, 'start') : k === 'right' ? child(b, 'end') : null)
    const v = borderOf(el, theme)
    if (v !== undefined) t.borders[k] = v
  }
  const m = child(e, 'tblCellMar')
  if (m) for (const k of ['top', 'left', 'bottom', 'right'] as const) {
    const el = child(m, k) || (k === 'left' ? child(m, 'start') : k === 'right' ? child(m, 'end') : null)
    const w = twip(wa(el, 'w'))
    if (w != null) t.mar[k] = w
  }
  const lk = child(e, 'tblLook')
  if (lk) {
    const hex = parseInt(val(lk) || '0', 16) || 0
    const f = (a: string, bit: number) => { const v = wa(lk, a); return v != null ? v === '1' || v === 'true' : !!(hex & bit) }
    t.look = { firstRow: f('firstRow', 0x20), lastRow: f('lastRow', 0x40), firstColumn: f('firstColumn', 0x80), lastColumn: f('lastColumn', 0x100), noHBand: f('noHBand', 0x200), noVBand: f('noVBand', 0x400) }
  }
  return t
}

const mergeTbl = (a: TblProps | undefined, b: TblProps | undefined): TblProps => ({
  borders: { ...(a?.borders || {}), ...(b?.borders || {}) },
  mar: { ...(a?.mar || {}), ...(b?.mar || {}) },
  shd: b?.shd !== undefined ? b.shd : a?.shd,
  look: b?.look || a?.look
})

export class Styles {
  byId = new Map<string, StyleDef>()
  byName = new Map<string, StyleDef>()
  docP: PP = {}
  docR: RP = {}
  defaultPara = 'Normal'
  defaultTable = ''
  defaultChar = ''
  private pCache = new Map<string, { pp: PP; rp: RP }>()
  private tCache = new Map<string, StyleDef>()

  constructor(pkg: Pkg, main: string, public theme: Theme) {
    const rel = pkg.relOfType(main, 'styles')
    const d = rel ? pkg.xml(rel.target) : null
    if (!d) return
    const root = d.documentElement
    const dd = child(root, 'docDefaults')
    this.docR = parseRPr(child(child(dd, 'rPrDefault'), 'rPr'), theme)
    this.docP = parsePPr(child(child(dd, 'pPrDefault'), 'pPr'), theme)
    for (const s of childrenNamed(root, 'style')) {
      const id = wa(s, 'styleId') || ''
      const type = wa(s, 'type') || 'paragraph'
      const def: StyleDef = {
        id, type, name: val(child(s, 'name')) || id, basedOn: val(child(s, 'basedOn')) || undefined,
        isDefault: onOff(attrEl(s, 'default')) || false,
        pp: parsePPr(child(s, 'pPr'), theme), rp: parseRPr(child(s, 'rPr'), theme), cond: {}
      }
      if (type === 'table') {
        def.tbl = parseTblPr(child(s, 'tblPr'), theme)
        const tcShd = child(child(s, 'tcPr'), 'shd')
        if (tcShd) def.tbl.shd = colorOf(tcShd, theme, 'fill', 'themeFill') ?? null
        for (const c of childrenNamed(s, 'tblStylePr')) {
          const sh = child(child(c, 'tcPr'), 'shd')
          def.cond[wa(c, 'type') || ''] = { pp: parsePPr(child(c, 'pPr'), theme), rp: parseRPr(child(c, 'rPr'), theme), shd: sh ? colorOf(sh, theme, 'fill', 'themeFill') ?? null : undefined }
        }
      }
      this.byId.set(id, def)
      this.byName.set(def.name.toLowerCase(), def)
      if (def.isDefault) {
        if (type === 'paragraph') this.defaultPara = id
        else if (type === 'table') this.defaultTable = id
        else if (type === 'character') this.defaultChar = id
      }
    }
  }

  private chain(id: string | undefined): StyleDef[] {
    const out: StyleDef[] = []
    const seen = new Set<string>()
    let s = id ? this.byId.get(id) : undefined
    while (s && !seen.has(s.id)) { seen.add(s.id); out.unshift(s); s = s.basedOn ? this.byId.get(s.basedOn) : undefined }
    return out
  }

  /** Paragraph style with its base styles, not including document defaults. */
  paraOnly(id: string | undefined): { pp: PP; rp: RP } {
    const key = id || this.defaultPara
    let r = this.pCache.get(key)
    if (!r) {
      const ch = this.chain(this.byId.has(key) ? key : this.defaultPara)
      r = { pp: mergeP(...ch.map(s => s.pp)), rp: mergeR(...ch.map(s => s.rp)) }
      // numPr lives in the style's pPr; keep it.
      this.pCache.set(key, r)
    }
    return r
  }

  /** Paragraph style including document defaults. */
  para(id: string | undefined): { pp: PP; rp: RP } {
    const p = this.paraOnly(id)
    return { pp: mergeP(this.docP, p.pp), rp: mergeR(this.docR, p.rp) }
  }

  char(id: string | undefined): RP {
    if (!id) return {}
    return mergeR(...this.chain(id).map(s => s.rp))
  }

  table(id: string | undefined): StyleDef | null {
    const key = id && this.byId.has(id) ? id : this.defaultTable
    if (!key) return null
    let t = this.tCache.get(key)
    if (!t) {
      const ch = this.chain(key)
      const cond: Record<string, Cond> = {}
      for (const s of ch) for (const k in s.cond) {
        const a = cond[k], b = s.cond[k]
        cond[k] = a ? { pp: mergeP(a.pp, b.pp), rp: mergeR(a.rp, b.rp), shd: b.shd !== undefined ? b.shd : a.shd } : b
      }
      t = {
        id: key, name: ch[ch.length - 1]?.name || key, type: 'table', isDefault: false,
        pp: mergeP(...ch.map(s => s.pp)), rp: mergeR(...ch.map(s => s.rp)),
        tbl: ch.reduce<TblProps | undefined>((a, s) => mergeTbl(a, s.tbl), undefined), cond
      }
      this.tCache.set(key, t)
    }
    return t
  }

  name(id: string | undefined): string { return (id && this.byId.get(id)?.name) || '' }
}

// ---------- numbering ----------

export interface Lvl { fmt: string; text: string; start: number; pp: PP; rp: RP; restart?: number; legal?: boolean }

export class Numbering {
  private abs = new Map<string, Lvl[]>()
  private absLink = new Map<string, string>()
  private nums = new Map<string, { abs: string; ov: Map<number, { start?: number; lvl?: Lvl }> }>()

  constructor(pkg: Pkg, main: string, theme: Theme, private styles: Styles) {
    const rel = pkg.relOfType(main, 'numbering')
    const d = rel ? pkg.xml(rel.target) : null
    if (!d) return
    const root = d.documentElement
    const lvlOf = (l: Element): Lvl => ({
      fmt: val(child(l, 'numFmt')) || 'decimal',
      text: val(child(l, 'lvlText')) ?? '',
      start: num(val(child(l, 'start'))) ?? 1,
      pp: parsePPr(child(l, 'pPr'), theme), rp: parseRPr(child(l, 'rPr'), theme),
      restart: num(val(child(l, 'lvlRestart'))),
      legal: onOff(child(l, 'isLgl')) || false
    })
    for (const a of childrenNamed(root, 'abstractNum')) {
      const id = wa(a, 'abstractNumId') || ''
      const lv: Lvl[] = []
      for (const l of childrenNamed(a, 'lvl')) lv[num(wa(l, 'ilvl')) || 0] = lvlOf(l)
      this.abs.set(id, lv)
      const link = val(child(a, 'numStyleLink'))
      if (link) this.absLink.set(id, link)
    }
    for (const n of childrenNamed(root, 'num')) {
      const id = wa(n, 'numId') || ''
      const ov = new Map<number, { start?: number; lvl?: Lvl }>()
      for (const o of childrenNamed(n, 'lvlOverride')) {
        const l = child(o, 'lvl')
        ov.set(num(wa(o, 'ilvl')) || 0, { start: num(val(child(o, 'startOverride'))), lvl: l ? lvlOf(l) : undefined })
      }
      this.nums.set(id, { abs: val(child(n, 'abstractNumId')) || '', ov })
    }
  }

  private levels(absId: string, depth = 0): Lvl[] {
    const link = this.absLink.get(absId)
    if (link && depth < 3) {
      const numId = this.styles.paraOnly(link).pp.numId
      const n = numId ? this.nums.get(numId) : undefined
      if (n && n.abs !== absId) return this.levels(n.abs, depth + 1)
    }
    return this.abs.get(absId) || []
  }

  /** The list level a paragraph uses, or null when it is not numbered. */
  lvl(numId: string | undefined, ilvl: number): Lvl | null {
    if (!numId || numId === '0') return null
    const n = this.nums.get(numId)
    if (!n) return null
    const ov = n.ov.get(ilvl)
    const base = ov?.lvl || this.levels(n.abs)[ilvl]
    if (!base) return null
    return ov?.start != null ? { ...base, start: ov.start } : base
  }

  /** Identity of the abstract list, so numbering continues across interruptions. */
  absOf(numId: string): string { return this.nums.get(numId)?.abs || numId }
  hasOverride(numId: string, ilvl: number) { return this.nums.get(numId)?.ov.get(ilvl)?.start != null }
}

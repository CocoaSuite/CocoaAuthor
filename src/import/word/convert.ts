// Converts a Word document into a CocoaAuthor document, keeping as much of Word's layout as the model can hold:
// styles become CocoaAuthor styles (built-in where they match, custom otherwise), and anything a paragraph or run
// does differently from its style becomes direct formatting.

import { getSchema } from '@tiptap/core'
import { extensions } from '../../editor/extensions'
import { newDoc } from '../../model/doc'
import { addImageAsset } from '../../ui/commands'
import { uid } from '../../util'
import {
  defaultStyles, defaultSettings, FONT_METRICS, FONTS, fontKey, type CADocument, type TextStyleDef, type StyleSet,
  type PageSettings, type CustomStyle, type FrameData, type HF, type Align, type NumberFormat, type StyleKey
} from '../../model/types'
import {
  Pkg, Styles, Numbering, readTheme, kids, child, childrenNamed, find, findAll, wa, ra, val, num, twip, emu, onOff, textOf,
  parsePPr, parseRPr, parseTblPr, mergeP, mergeR, colorOf, type Theme, type PP, type RP, type StyleDef, type Lvl
} from './ooxml'

type Target = { node: 'paragraph'; kind: 'body' | 'title' | 'subtitle' | 'caption'; custom?: string } | { node: 'heading'; level: number; custom?: string }

interface Ctx {
  where: 'body' | 'cell' | 'box'
  /** Width of the text column in pt. */
  cw: number
  tbl?: { style: StyleDef | null; conds: string[] }
}

/** One inline piece of a paragraph, or something that splits it. */
type Item = { k: 'inline'; node: any } | { k: 'block'; node: any } | { k: 'page' }

interface PRec { node: any; styleId: string; contextual: boolean; before: number; after: number; def: TextStyleDef }

interface Geom {
  w: number; h: number; land: boolean; margin: { top: number; right: number; bottom: number; left: number }
  numFmt?: string; numStart?: number; titlePg: boolean; type: string; hdr: Record<string, string>; ftr: Record<string, string>
}

interface Field { instr: string; phase: 'instr' | 'result'; kind?: 'link' | 'skip' | 'keep'; href?: string | null }

const r1 = (x: number) => Math.round(x * 10) / 10
const r3 = (x: number) => Math.round(x * 1000) / 1000
const near = (a: number, b: number, e = 0.05) => Math.abs(a - b) <= e
const LIST_PAD = 22

/** Containers collect blocks; numbered paragraphs are gathered into nested lists. */
class Builder {
  out: any[] = []
  paras: (PRec | null)[] = []
  private stack: { list: any; level: number; key: string; ordered: boolean }[] = []
  constructor(public where: Ctx['where']) {}
  push(node: any, para?: PRec) {
    this.stack = []
    this.out.push(node)
    this.paras.push(para || null)
  }
  /** Adds a list item; returns its nesting depth (0 for the outermost list). */
  item(para: any, rec: PRec, level: number, key: string, ordered: boolean, attrs: () => any): number {
    const top = () => this.stack[this.stack.length - 1]
    while (this.stack.length && top().level > level) this.stack.pop()
    if (this.stack.length && top().level === level && (top().key !== key || top().ordered !== ordered)) this.stack.pop()
    if (!this.stack.length || top().level < level) {
      const list = { type: ordered ? 'orderedList' : 'bulletList', attrs: attrs(), content: [] as any[] }
      const t = this.stack.length ? top() : null
      const li = t ? t.list.content[t.list.content.length - 1] : null
      if (li) li.content.push(list)
      else { this.stack = []; this.out.push(list) }
      this.stack.push({ list, level, key, ordered })
    }
    top().list.content.push({ type: 'listItem', content: [para] })
    this.paras.push(rec)
    return this.stack.length - 1
  }
  /** Something that belongs to the last list item (the rest of a split paragraph). */
  toItem(node: any): boolean {
    const t = this.stack[this.stack.length - 1]
    const li = t?.list.content[t.list.content.length - 1]
    if (!li) return false
    li.content.push(node)
    return true
  }
  inList() { return this.stack.length > 0 }
}

export async function convertDocx(data: Uint8Array, fileName: string): Promise<CADocument> {
  const c = new Converter(data, fileName)
  return c.run()
}

class Converter {
  pkg: Pkg
  main: string
  theme: Theme
  st: Styles
  nb: Numbering
  doc: CADocument
  S: StyleSet
  title: string
  frames: FrameData[] = []
  fields: Field[] = []
  foot = new Map<string, string>()
  end = new Map<string, string>()
  /** Bookmark name → id of the heading/caption it marks, or of a bookmark node. */
  bm = new Map<string, string>()
  /** Paragraph element → id it should carry (it is the target of a bookmark). */
  paraId = new Map<Element, string>()
  bmNode = new Set<string>()
  customs = new Map<string, CustomStyle>()
  fontFamilies = new Map<string, string>()
  counters = new Map<string, number[]>()
  imgCache = new Map<string, Promise<{ id: string; w: number; h: number } | null>>()
  page = 0
  rendered = false
  tocSkip = 0
  headingNumbers = false
  geom!: Geom
  lastTocHeading: { b: Builder; node: any; text: string } | null = null

  constructor(data: Uint8Array, fileName: string) {
    this.pkg = new Pkg(data)
    this.main = this.pkg.mainPart()
    if (!this.pkg.xml(this.main)) throw new Error('Not a Word document')
    this.theme = readTheme(this.pkg, this.main)
    this.st = new Styles(this.pkg, this.main, this.theme)
    this.nb = new Numbering(this.pkg, this.main, this.theme, this.st)
    this.title = fileName.replace(/\.docx$/i, '')
    this.doc = newDoc(this.title)
    this.S = defaultStyles()
  }

  async run(): Promise<CADocument> {
    const d = this.pkg.xml(this.main)!
    const body = find(d.documentElement, 'body')
    if (!body) throw new Error('Empty Word document')
    this.readFontTable()
    this.readNotes()
    this.rendered = findAll(body, 'lastRenderedPageBreak').length > 0
    this.buildStyles(body)
    this.scanBookmarks(body)

    // Split the body into Word sections: a paragraph carrying sectPr ends its section.
    const secs: { els: Element[]; sectPr: Element | null }[] = []
    let cur: Element[] = []
    let finalSect: Element | null = null
    for (const el of kids(body)) {
      if (el.localName === 'sectPr') { finalSect = el; continue }
      cur.push(el)
      const sp = el.localName === 'p' ? child(child(el, 'pPr'), 'sectPr') : null
      if (sp) { secs.push({ els: cur, sectPr: sp }); cur = [] }
    }
    secs.push({ els: cur, sectPr: finalSect })

    const geoms = secs.map(s => this.geomOf(s.sectPr))
    // Word inherits headers from the previous section; CocoaAuthor has one set, taken from the first section.
    const g0 = geoms[0]
    const out: any[] = []
    let prevLand = g0.land
    for (let i = 0; i < secs.length; i++) {
      this.geom = geoms[i]
      const g = geoms[i]
      if (i > 0 && g.type !== 'continuous' && !this.rendered) this.page++
      const b = new Builder('body')
      const ctx: Ctx = { where: 'body', cw: g.w - g.margin.left - g.margin.right }
      await this.blocks(secs[i].els, ctx, b)
      this.finishSpacing(b)
      const merge = i > 0 && out.length && g.type === 'continuous' && g.land === prevLand && g.numStart == null
      if (merge) out[out.length - 1].content.push(...b.out)
      else out.push({ type: 'section', attrs: { landscape: g.land !== g0.land ? g.land : null, restart: i > 0 && g.numStart != null ? g.numStart : null }, content: b.out })
      prevLand = g.land
    }
    for (const s of out) if (!s.content.length) s.content.push({ type: 'paragraph' })

    const settings = this.settings(g0, d)
    this.S.custom = [...this.customs.values()]
    this.doc.content = { type: 'doc', attrs: { settings, styles: this.S, frames: this.frames.length ? this.frames : null }, content: out }
    this.readMeta()
    const schema = getSchema(extensions())
    schema.nodeFromJSON(this.doc.content).check()
    return this.doc
  }

  // ---------- document-wide parts ----------

  private readFontTable() {
    const rel = this.pkg.relOfType(this.main, 'fontTable')
    const d = rel ? this.pkg.xml(rel.target) : null
    for (const f of findAll(d, 'font')) {
      const fam = val(child(f, 'family'))
      const name = wa(f, 'name')
      if (name && fam) this.fontFamilies.set(name.toLowerCase(), fam)
    }
  }

  private readNotes() {
    for (const [type, map, tag] of [['footnotes', this.foot, 'footnote'], ['endnotes', this.end, 'endnote']] as const) {
      const rel = this.pkg.relOfType(this.main, type)
      const d = rel ? this.pkg.xml(rel.target) : null
      for (const n of findAll(d, tag)) {
        const t = wa(n, 'type')
        if (t && t !== 'normal') continue
        const text = childrenNamed(n, 'p').map(p => textOf(p)).join(' ').replace(/\s+/g, ' ').trim()
        map.set(wa(n, 'id') || '', text)
      }
    }
  }

  private readMeta() {
    const d = this.pkg.xml('docProps/core.xml')
    if (!d) return
    const g = (n: string) => findAll(d, n)[0]?.textContent?.trim() || ''
    const t = g('title')
    if (t) this.doc.meta.title = t
    this.doc.meta.author = g('creator')
    this.doc.meta.subject = g('subject')
    this.doc.meta.keywords = g('keywords')
  }

  /** Every bookmark that marks a heading or a caption points at that paragraph; others become bookmark nodes. */
  private scanBookmarks(body: Element) {
    for (const b of findAll(body, 'bookmarkStart')) {
      const name = wa(b, 'name') || ''
      if (!name || name === '_GoBack') continue
      let p: Element | null = b.parentElement
      while (p && p.localName !== 'p') p = p.parentElement
      // A bookmark just before a paragraph (at body level) belongs to the next paragraph.
      if (!p) { let n = b.nextElementSibling; while (n && n.localName !== 'p') n = n.nextElementSibling; p = n }
      const t = p ? this.target(parsePPr(child(p, 'pPr'), this.theme).style || this.st.defaultPara) : null
      if (p && t && (t.node === 'heading' || t.kind === 'caption')) {
        let id = this.paraId.get(p)
        if (!id) { id = uid(t.node === 'heading' ? 'h' : 'c'); this.paraId.set(p, id) }
        this.bm.set(name, id)
      } else if (!name.startsWith('_')) {
        const id = 'bm' + uid()
        this.bm.set(name, id)
        this.bmNode.add(name)
      }
    }
  }

  // ---------- styles ----------

  /** What a Word paragraph style becomes in CocoaAuthor. */
  target(styleId: string): Target {
    const s = this.st.byId.get(styleId)
    const name = (s?.name || '').toLowerCase()
    if (!s || styleId === this.st.defaultPara) return { node: 'paragraph', kind: 'body' }
    if (name === 'title') return { node: 'paragraph', kind: 'title' }
    if (name === 'subtitle') return { node: 'paragraph', kind: 'subtitle' }
    if (name === 'caption') return { node: 'paragraph', kind: 'caption' }
    const h = /^heading ([1-9])$/.exec(name)
    if (h && +h[1] <= 4) return { node: 'heading', level: +h[1] }
    const ol = this.st.paraOnly(styleId).pp.outline
    if (ol != null && ol >= 0 && ol < 4) return { node: 'heading', level: ol + 1, custom: this.custom(styleId, ('h' + (ol + 1)) as StyleKey) }
    return { node: 'paragraph', kind: 'body', custom: this.custom(styleId, 'body') }
  }

  /** Registers a Word style as a CocoaAuthor custom paragraph style (lazily, so only used styles are kept). */
  private custom(styleId: string, base: StyleKey): string {
    const id = 'w-' + styleId.replace(/[^\w-]/g, '_')
    if (this.customs.has(id)) return id
    const r = this.st.para(styleId)
    const full = this.toDef(r.pp, r.rp)
    const from = this.S.text[base]
    const o: Partial<TextStyleDef> = {}
    const keys = new Set([...Object.keys(full), ...Object.keys(from)]) as Set<keyof TextStyleDef>
    for (const k of keys) {
      const a = (full as any)[k], b = (from as any)[k]
      if (a === b) continue
      ;(o as any)[k] = a ?? (typeof b === 'number' ? 0 : typeof b === 'boolean' ? false : undefined)
    }
    const s = this.st.byId.get(styleId)
    const name = s?.name || styleId
    this.customs.set(id, { id, name: name.charAt(0).toUpperCase() + name.slice(1), type: 'para', base, o })
    return id
  }

  font(name: string | undefined): string {
    if (!name) return 'Calibri'
    const n = name.trim()
    const l = n.toLowerCase()
    const own = FONTS.find(f => f.name.toLowerCase() === l)
    if (own) return own.name
    const map: Record<string, string> = {
      'calibri light': 'Calibri', carlito: 'Calibri', aptos: 'Arial', 'aptos display': 'Arial', 'aptos narrow': 'Calibri',
      'cambria math': 'Cambria', caladea: 'Cambria', georgia: 'Cambria', 'book antiqua': 'Cambria', 'palatino linotype': 'Cambria',
      helvetica: 'Arial', 'helvetica neue': 'Arial', arimo: 'Arial', 'liberation sans': 'Arial', verdana: 'Arial', tahoma: 'Arial', 'segoe ui': 'Arial', roboto: 'Arial', 'open sans': 'Arial', 'arial narrow': 'Calibri',
      times: 'Times New Roman', tinos: 'Times New Roman', 'liberation serif': 'Times New Roman', garamond: 'Times New Roman', 'pt serif': 'Times New Roman',
      courier: 'Courier New', consolas: 'Courier New', 'lucida console': 'Courier New', cousine: 'Courier New', 'liberation mono': 'Courier New', 'cascadia code': 'Courier New', 'cascadia mono': 'Courier New'
    }
    if (map[l]) return map[l]
    const fam = this.fontFamilies.get(l)
    if (fam === 'roman') return 'Times New Roman'
    if (fam === 'modern' || /mono|code|courier|consol/.test(l)) return 'Courier New'
    if (/serif/.test(l) && !/sans/.test(l)) return 'Times New Roman'
    return fam === 'swiss' ? 'Arial' : 'Calibri'
  }

  /** Word's line spacing as a CSS line-height (a multiple of the font size). */
  lh(pp: PP, font: string, size: number): number {
    const m = FONT_METRICS[fontKey(font)] || FONT_METRICS.inter
    const single = m.asc + m.desc
    const line = pp.line
    if (line == null || pp.lineRule === 'auto' || !pp.lineRule) return r3(((line ?? 240) / 240) * single)
    const pt = line / 20
    if (pp.lineRule === 'exact') return r3(pt / size)
    return r3(Math.max(pt, single * size) / size)
  }

  toDef(pp: PP, rp: RP): TextStyleDef {
    const font = this.font(rp.font)
    const size = rp.size ?? 10
    const t: TextStyleDef = {
      font, size, weight: rp.bold ? 700 : 400, italic: !!rp.italic, color: (rp.color || '#000000').toLowerCase(),
      lineHeight: this.lh(pp, font, size), before: r1(pp.before ?? 0), after: r1(pp.after ?? 0), align: pp.align || 'left',
      tracking: rp.spacing ? r3(rp.spacing / size) : 0, caps: !!rp.caps,
      kern: rp.kern != null && rp.kern > 0 && size >= rp.kern, liga: false
    }
    if (pp.firstLine) t.firstLine = r1(pp.firstLine)
    if (pp.left) t.indent = r1(pp.left)
    if (rp.smallCaps) t.smcp = true
    return t
  }

  private buildStyles(body: Element) {
    const T = this.S.text
    const by = (n: string) => this.st.byName.get(n)
    const set = (k: StyleKey, name: string) => { const s = by(name); if (s && s.type === 'paragraph') { const r = this.st.para(s.id); T[k] = this.toDef(r.pp, r.rp) } }
    const n = this.st.para(this.st.defaultPara)
    T.body = this.toDef(n.pp, n.rp)
    T.list = { ...T.body }
    // Table text: Normal as the first table's style changes it (most documents use one table style).
    const t0 = find(body, 'tbl')
    const ts = this.st.table(val(child(child(t0, 'tblPr'), 'tblStyle')) || undefined)
    const np = this.st.paraOnly(this.st.defaultPara)
    T.table = ts ? this.toDef(mergeP(this.st.docP, np.pp, ts.pp), mergeR(this.st.docR, np.rp, ts.rp)) : { ...T.body }
    set('title', 'title'); set('subtitle', 'subtitle')
    for (let i = 1; i <= 4; i++) set(('h' + i) as StyleKey, 'heading ' + i)
    set('caption', 'caption'); set('quote', 'quote'); set('footnote', 'footnote text'); set('header', 'header')
    const link = by('hyperlink')
    const lc = link ? this.st.char(link.id).color : null
    this.S.link = lc || this.theme.colors.hlink || this.S.link
    if (this.theme.colors.accent1) this.S.accent = this.theme.colors.accent1
    // Headings numbered through their style ("1", "1.1"): CocoaAuthor numbers headings itself.
    const h1 = by('heading 1')
    const hn = h1 ? this.st.paraOnly(h1.id).pp : null
    const lv = hn?.numId ? this.nb.lvl(hn.numId, hn.ilvl || 0) : null
    if (lv && lv.fmt === 'decimal' && /%1/.test(lv.text)) this.headingNumbers = true
  }

  /** The style CSS gives a paragraph in this place, which its own formatting is compared against. */
  private def(t: Target, ctx: Ctx, inList: boolean): TextStyleDef {
    if (t.custom) {
      const c = this.customs.get(t.custom)!
      const base = c.base as StyleKey
      return { ...this.S.text[base], ...c.o } as TextStyleDef
    }
    if (t.node === 'heading') return this.S.text[('h' + t.level) as StyleKey]
    if (t.kind !== 'body') return this.S.text[t.kind]
    if (inList) return this.S.text.list
    if (ctx.where === 'cell') return this.S.text.table
    return this.S.text.body
  }

  // ---------- blocks ----------

  private async blocks(els: Element[], ctx: Ctx, b: Builder) {
    for (const el of els) {
      switch (el.localName) {
        case 'p': await this.para(el, ctx, b); break
        case 'tbl': {
          if (this.tocSkip) { this.skipFields(el); break }
          const t = await this.table(el, ctx)
          if (t) b.push(t)
          break
        }
        case 'sdt': {
          const content = child(el, 'sdtContent')
          const gallery = val(find(child(el, 'sdtPr'), 'docPartGallery')) || ''
          if (/table of contents/i.test(gallery) || (findAll(content, 'instrText').some(i => /^\s*TOC\b/.test(i.textContent || '')) && !this.tocSkip)) {
            const ps = findAll(content, 'p')
            const head = ps.find(p => /toc heading/i.test(this.st.name(parsePPr(child(p, 'pPr'), this.theme).style)))
            const instr = findAll(content, 'instrText').map(i => i.textContent || '').join('')
            b.push(this.toc(instr, head ? textOf(head) : 'Contents'))
            break
          }
          await this.blocks(kids(content), ctx, b)
          break
        }
        case 'customXml': case 'ins': case 'moveTo': await this.blocks(kids(el), ctx, b); break
        case 'AlternateContent': await this.blocks(kids(choose(el)), ctx, b); break
      }
    }
  }

  private toc(instr: string, title: string) {
    const m = /\\o\s+"(\d)-(\d)"/.exec(instr)
    const levels = Math.max(1, Math.min(4, m ? +m[2] : 3))
    return { type: 'toc', attrs: { id: uid('t'), title: title.trim() || 'Contents', levels } }
  }

  /** Inside a TOC field: count field begins and ends until it closes. */
  private skipFields(el: Element) {
    for (const f of findAll(el, '*')) {
      if (f.localName === 'lastRenderedPageBreak') { this.page++; continue }
      if (f.localName !== 'fldChar') continue
      const t = wa(f, 'fldCharType')
      if (t === 'begin') this.tocSkip++
      else if (t === 'end') this.tocSkip--
      if (this.tocSkip <= 0) { this.tocSkip = 0; return }
    }
  }

  private async para(p: Element, ctx: Ctx, b: Builder) {
    if (this.tocSkip) { this.skipFields(p); return }
    const pPr = child(p, 'pPr')
    const direct = parsePPr(pPr, this.theme)
    const styleId = direct.style && this.st.byId.has(direct.style) ? direct.style : this.st.defaultPara

    // A TOC field starting here: everything up to its end is the generated table of contents.
    const first = findAll(p, 'instrText')[0]
    if (first && /^\s*TOC\b/.test(this.leadingInstr(p))) {
      let title = 'Contents'
      const lt = this.lastTocHeading
      if (lt && lt.b === b && b.out[b.out.length - 1] === lt.node) { b.out.pop(); b.paras.pop(); title = lt.text }
      b.push(this.toc(this.leadingInstr(p), title))
      this.tocSkip = 0
      this.skipFields(p)
      return
    }

    const tgt = this.target(styleId)
    // Resolve: defaults, table style (below or above Normal, as Word does), paragraph style, numbering, direct.
    const ps = this.st.paraOnly(styleId)
    let pp: PP, rp: RP
    if (ctx.tbl?.style) {
      const ts = ctx.tbl.style
      const conds = ctx.tbl.conds.map(c => ts.cond[c]).filter(Boolean)
      const tp = mergeP(ts.pp, ...conds.map(c => c.pp)), tr = mergeR(ts.rp, ...conds.map(c => c.rp))
      if (styleId === this.st.defaultPara) { pp = mergeP(this.st.docP, ps.pp, tp); rp = mergeR(this.st.docR, ps.rp, tr) }
      else { pp = mergeP(this.st.docP, tp, ps.pp); rp = mergeR(this.st.docR, tr, ps.rp) }
    } else { pp = mergeP(this.st.docP, ps.pp); rp = mergeR(this.st.docR, ps.rp) }
    const numId = direct.numId ?? pp.numId
    const ilvl = direct.ilvl ?? pp.ilvl ?? 0
    const lvl = tgt.node === 'paragraph' && tgt.kind === 'body' && ctx.where !== 'box' ? this.nb.lvl(numId, ilvl) : null
    const isList = !!lvl && lvl.fmt !== 'none' && lvl.text !== ''
    const { style: _s, ...dpp } = direct
    pp = mergeP(pp, lvl ? lvl.pp : {}, dpp)

    const info = { label: null as string | null, id: this.paraId.get(p) || null }
    const def = this.def(tgt, ctx, isList)
    const outer = this.info
    this.info = info
    const items = await this.inlines(kids(p), rp, def, ctx, info, pp)
    this.info = outer

    if (pp.breakBefore && !this.rendered) this.page++

    // Paragraph node(s): split around page breaks and pictures.
    const attrs = (): any => {
      const a: any = {}
      if (tgt.node === 'heading') a.level = tgt.level
      else { a.kind = tgt.kind; if (info.label) a.label = info.label }
      if (tgt.custom) a.pstyle = tgt.custom
      if (info.id) a.id = info.id
      if ((pp.align || 'left') !== def.align) a.textAlign = pp.align || 'left'
      let left = pp.left || 0, fl = pp.firstLine || 0
      if (pp.bar) { a.barW = r1(pp.bar.w); a.barGap = r1(pp.bar.gap); if (pp.bar.color) a.barColor = pp.bar.color; left = Math.max(0, left - pp.bar.w - pp.bar.gap) }
      if (isList) fl = 0
      if (!isList && !near(left, def.indent || 0)) a.left = r1(left)
      if (!near(fl, def.firstLine || 0)) a.firstLine = r1(fl)
      if (pp.right) a.right = r1(pp.right)
      const want = this.lh(pp, def.font, def.size)
      if (!near(want, def.lineHeight, 0.004)) a.lh = want
      if (pp.keepNext && tgt.node !== 'heading') a.keepNext = true
      if (pp.breakBefore) a.breakBefore = true
      return a
    }
    const mk = (content: any[]) => {
      const n: any = { type: tgt.node, attrs: attrs() }
      if (tgt.node === 'paragraph' && info.label) stripCaptionLabel(content)
      const merged = mergeText(content)
      if (merged.length) n.content = merged
      return n
    }
    const rec = (node: any): PRec => ({ node, styleId, contextual: !!pp.contextual, before: pp.before ?? 0, after: pp.after ?? 0, def })

    const segs: ({ inl: any[] } | { block: any } | { page: true })[] = [{ inl: [] }]
    for (const it of items) {
      if (it.k === 'inline') { const l = segs[segs.length - 1]; if ('inl' in l) l.inl.push(it.node); else segs.push({ inl: [it.node] }) }
      else if (it.k === 'block') segs.push({ block: it.node })
      else segs.push({ page: true })
    }
    // Drop empty text segments next to pictures and breaks, but keep a paragraph that is empty on its own.
    const hasOther = segs.some(s => !('inl' in s))
    const parts = segs.filter(s => !('inl' in s) || s.inl.some(n => n.type !== 'text' || n.text.trim() !== '' || !hasOther))
    if (!parts.length) parts.push({ inl: [] })
    let placed = false
    const textParts = parts.filter(s => 'inl' in s)
    for (const s of parts) {
      if ('page' in s) { b.push({ type: 'pageBreak' }); if (!this.rendered) this.page++; continue }
      if ('block' in s) {
        if (isList && placed && b.inList()) b.toItem(s.block)
        else b.push(s.block)
        continue
      }
      const node = mk(s.inl)
      const r = rec(node)
      if (textParts.length > 1) {
        // A paragraph split in pieces keeps its space before on the first piece and after on the last.
        if (s !== textParts[0]) r.before = 0
        if (s !== textParts[textParts.length - 1]) r.after = 0
      }
      if (isList && !placed) {
        const key = this.nb.hasOverride(numId!, ilvl) ? numId! : this.nb.absOf(numId!)
        const ctr = this.counters.get(key) || []
        if (ctr[ilvl] == null) ctr[ilvl] = lvl!.start - 1
        ctr[ilvl]++
        for (let k = ilvl + 1; k < ctr.length; k++) delete ctr[k]
        this.counters.set(key, ctr)
        const ordered = lvl!.fmt !== 'bullet'
        const depth = b.item(node, r, ilvl, key, ordered, () => listAttrs(lvl!, ilvl, ctr[ilvl]))
        // Word places list text at its indent; CocoaAuthor indents each level by the marker width.
        const left = (pp.left || 0) - LIST_PAD * (depth + 1)
        if (!near(left, def.indent || 0)) node.attrs.left = r1(left)
        placed = true
      } else if (isList && placed && b.inList()) {
        b.toItem(node)
      } else b.push(node, r)
    }
    if (/toc heading/i.test(this.st.name(styleId))) {
      const last = b.out[b.out.length - 1]
      this.lastTocHeading = { b, node: last, text: textOf(p) }
    }
  }

  private leadingInstr(p: Element): string {
    let s = ''
    let on = false
    for (const e of findAll(p, '*')) {
      if (e.localName === 'fldChar') {
        const t = wa(e, 'fldCharType')
        if (t === 'begin') { if (on) break; on = true }
        else if (on) break
      } else if (on && e.localName === 'instrText') s += e.textContent || ''
    }
    return s
  }

  /** Space between paragraphs: Word adds space after and space before (no collapsing, like the flex layout), except
   * contextual spacing between paragraphs of the same style. Table cells drop the outer margins in CSS, so set them. */
  private finishSpacing(b: Builder) {
    const ps = b.paras
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1], c = ps[i]
      if (!a || !c || a.styleId !== c.styleId) continue
      if (c.contextual) c.before = 0
      if (a.contextual) a.after = 0
    }
    const real = ps.filter((x): x is PRec => !!x)
    const firstNode = b.out[0], lastNode = b.out[b.out.length - 1]
    for (const r of real) {
      const atTop = b.where === 'cell' && r.node === firstNode
      const atBottom = b.where === 'cell' && r.node === lastNode
      const db = atTop ? 0 : r.def.before, da = atBottom ? 0 : r.def.after
      if (!near(r.before, db)) r.node.attrs.before = r1(r.before)
      if (!near(r.after, da)) r.node.attrs.after = r1(r.after)
    }
  }

  // ---------- inline content ----------

  private async inlines(els: Element[], base: RP, def: TextStyleDef, ctx: Ctx, info: { label: string | null; id: string | null }, pp: PP, link: string | null = null): Promise<Item[]> {
    const out: Item[] = []
    const linkNow = () => {
      for (let i = this.fields.length - 1; i >= 0; i--) if (this.fields[i].kind === 'link') return this.fields[i].href || null
      return link
    }
    const muted = () => this.fields.some(f => f.phase === 'instr' || f.kind === 'skip')
    for (const el of els) {
      switch (el.localName) {
        case 'r': {
          const d = parseRPr(child(el, 'rPr'), this.theme)
          const rp = mergeR(base, this.st.char(d.style), d)
          for (const c of kids(el)) {
            const ln = c.localName
            if (ln === 'fldChar') { this.fldChar(c, out); continue }
            if (ln === 'instrText') { const f = this.fields[this.fields.length - 1]; if (f && f.phase === 'instr') f.instr += c.textContent || ''; continue }
            if (ln === 'lastRenderedPageBreak') { this.page++; continue }
            if (muted() || rp.hidden) continue
            switch (ln) {
              case 't': this.text(out, c.textContent || '', rp, def, linkNow()); break
              case 'tab': case 'ptab': this.text(out, '\t', rp, def, linkNow()); break
              case 'noBreakHyphen': this.text(out, '‑', rp, def, linkNow()); break
              case 'softHyphen': this.text(out, '­', rp, def, linkNow()); break
              case 'sym': this.text(out, symbol(wa(c, 'font') || '', wa(c, 'char') || ''), rp, def, linkNow()); break
              case 'br': {
                const t = wa(c, 'type')
                if (t === 'page') out.push({ k: 'page' })
                else out.push({ k: 'inline', node: { type: 'hardBreak' } })
                break
              }
              case 'cr': out.push({ k: 'inline', node: { type: 'hardBreak' } }); break
              case 'footnoteReference': case 'endnoteReference': {
                const end = ln === 'endnoteReference'
                const text = (end ? this.end : this.foot).get(wa(c, 'id') || '') ?? ''
                out.push({ k: 'inline', node: { type: 'footnote', attrs: { id: uid('f'), text, kind: end ? 'end' : 'foot' } } })
                break
              }
              case 'drawing': out.push(...(await this.drawing(c, ctx, pp))); break
              case 'pict': case 'object': out.push(...(await this.vml(c, ctx, pp))); break
              case 'AlternateContent':
                for (const k of kids(choose(c))) {
                  if (k.localName === 'drawing') out.push(...(await this.drawing(k, ctx, pp)))
                  else if (k.localName === 'pict' || k.localName === 'object') out.push(...(await this.vml(k, ctx, pp)))
                }
                break
            }
          }
          break
        }
        case 'hyperlink': {
          const id = ra(el, 'id')
          const anchor = wa(el, 'anchor')
          let href: string | null = null
          if (id) href = this.pkg.rels(this.main).get(id)?.target || null
          if (anchor) { const t = this.bm.get(anchor); href = t ? '#' + t : href }
          out.push(...(await this.inlines(kids(el), base, def, ctx, info, pp, href ?? link)))
          break
        }
        case 'fldSimple': {
          const f: Field = { instr: wa(el, 'instr') || '', phase: 'result' }
          this.fields.push(f)
          this.decide(f, out, info)
          out.push(...(await this.inlines(kids(el), base, def, ctx, info, pp, link)))
          this.fields.pop()
          break
        }
        case 'bookmarkStart': {
          const name = wa(el, 'name') || ''
          if (this.bmNode.has(name) && !muted()) {
            this.bmNode.delete(name)
            out.push({ k: 'inline', node: { type: 'bookmark', attrs: { id: this.bm.get(name), name } } })
          }
          break
        }
        case 'smartTag': case 'customXml': case 'ins': case 'moveTo': case 'dir': case 'bdo':
          out.push(...(await this.inlines(kids(el), base, def, ctx, info, pp, link)))
          break
        case 'sdt':
          out.push(...(await this.inlines(kids(child(el, 'sdtContent')), base, def, ctx, info, pp, link)))
          break
        case 'oMath': case 'oMathPara':
          if (!muted()) this.text(out, findAll(el, 't').map(t => t.textContent || '').join(''), mergeR(base, { italic: true }), def, link)
          break
        case 'AlternateContent':
          out.push(...(await this.inlines(kids(choose(el)), base, def, ctx, info, pp, link)))
          break
      }
    }
    return out
  }

  private fldChar(c: Element, out: Item[]) {
    const t = wa(c, 'fldCharType')
    if (t === 'begin') this.fields.push({ instr: '', phase: 'instr' })
    else if (t === 'separate') {
      const f = this.fields[this.fields.length - 1]
      if (f && f.phase === 'instr') { f.phase = 'result'; this.decide(f, out, null) }
    } else if (t === 'end') {
      const f = this.fields.pop()
      if (f && f.phase === 'instr') { f.phase = 'result'; this.decide(f, out, null) }
    }
  }

  /** What to do with a field's result: links, cross-references and caption numbers are rebuilt; the rest keeps Word's text. */
  private decide(f: Field, out: Item[], info: { label: string | null } | null) {
    const ins = f.instr.trim()
    const name = (/^(\S+)/.exec(ins)?.[1] || '').toUpperCase()
    const arg = /^\S+\s+(?:"([^"]*)"|(\S+))/.exec(ins)
    const a1 = arg ? arg[1] ?? arg[2] : ''
    if (name === 'HYPERLINK') {
      const l = /\\l\s+"([^"]*)"/.exec(ins)
      f.kind = 'link'
      if (l) { const t = this.bm.get(l[1]); f.href = t ? '#' + t : null }
      else f.href = a1 && !a1.startsWith('\\') ? a1 : null
    } else if (name === 'REF' || name === 'PAGEREF') {
      const id = this.bm.get(a1)
      if (!id) { f.kind = 'keep'; return }
      const caption = id.startsWith('c')
      const show = name === 'PAGEREF' ? 'page' : /\\[rnw]/.test(ins) || caption ? 'number' : 'text'
      out.push({ k: 'inline', node: { type: 'xref', attrs: { target: id, show } } })
      f.kind = 'skip'
    } else if (name === 'SEQ') {
      f.kind = 'skip'
      const i = info || this.info
      if (i) i.label = /tab|табл/i.test(a1) ? 'table' : 'figure'
    } else f.kind = 'keep'
  }

  /** The paragraph being converted, for SEQ fields met in its runs. */
  private info: { label: string | null } | null = null

  private text(out: Item[], s: string, rp: RP, def: TextStyleDef, link: string | null) {
    if (!s) return
    const marks: any[] = []
    if (rp.bold && def.weight < 600) marks.push({ type: 'bold' })
    if (rp.italic && !def.italic) marks.push({ type: 'italic' })
    if (rp.underline && !link) marks.push({ type: 'underline' })
    if (rp.strike) marks.push({ type: 'strike' })
    if (rp.vert === 'super') marks.push({ type: 'superscript' })
    else if (rp.vert === 'sub') marks.push({ type: 'subscript' })
    if (rp.highlight) marks.push({ type: 'highlight', attrs: { color: rp.highlight } })
    const ts: any = {}
    const font = this.font(rp.font)
    if (font !== def.font) ts.fontFamily = font
    const size = rp.size ?? 10
    if (!near(size, def.size, 0.01)) ts.fontSize = size + 'px'
    const color = (rp.color || '#000000').toLowerCase()
    if (color !== def.color.toLowerCase() && !(link && color === this.S.link.toLowerCase())) ts.color = color
    const tr = rp.spacing ? r3(rp.spacing / size) : 0
    if (!near(tr, def.tracking || 0, 0.001)) ts.letterSpacing = tr
    if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: { color: null, fontFamily: null, fontSize: null, letterSpacing: null, ...ts } })
    if (link) marks.push({ type: 'link', attrs: { href: link } })
    if (rp.caps && !def.caps) s = s.toUpperCase()
    out.push({ k: 'inline', node: marks.length ? { type: 'text', text: s, marks } : { type: 'text', text: s } })
  }

  // ---------- pictures, text boxes and charts ----------

  private async image(rid: string | null, part = this.main): Promise<{ id: string; w: number; h: number } | null> {
    if (!rid) return null
    const rel = this.pkg.rels(part).get(rid)
    if (!rel || rel.external) return null
    let p = this.imgCache.get(rel.target)
    if (!p) {
      p = (async () => {
        const bytes = this.pkg.bytes(rel.target)
        const ext = (rel.target.split('.').pop() || '').toLowerCase()
        const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }
        if (!bytes || !mime[ext]) return null
        try { return await addImageAsset(this.doc, new Blob([bytes as BlobPart], { type: mime[ext] }), rel.target.split('/').pop() || 'image') } catch { return null }
      })()
      this.imgCache.set(rel.target, p)
    }
    return p
  }

  private alignOf(pp: PP): string { return pp.align === 'center' ? 'center' : pp.align === 'right' ? 'right' : 'left' }

  private imageNode(a: { id: string; w: number; h: number }, wpt: number, hpt: number, ctx: Ctx, align: string, alt: string, crop: any) {
    const node: any = { type: 'image', attrs: { src: 'asset:' + a.id, w: a.w, h: a.h, width: Math.max(1, Math.min(100, Math.round((wpt / ctx.cw) * 1000) / 10)), align, alt } }
    if (crop) node.attrs.cropRect = crop
    else if (wpt > 0 && hpt > 0 && Math.abs(hpt / wpt - a.h / a.w) > 0.02 * (a.h / a.w)) { node.attrs.crop = `${r3(wpt)}:${r3(hpt)}`; node.attrs.fit = 'stretch' }
    return node
  }

  private async drawing(d: Element, ctx: Ctx, pp: PP): Promise<Item[]> {
    const box = child(d, 'inline') || child(d, 'anchor')
    if (!box) return []
    const ext = child(box, 'extent')
    const w = emu(ext?.getAttribute('cx')) || 0, h = emu(ext?.getAttribute('cy')) || 0
    const pr = child(box, 'docPr')
    const alt = pr?.getAttribute('descr') || pr?.getAttribute('title') || ''
    const gd = find(box, 'graphicData')
    const uri = gd?.getAttribute('uri') || ''
    const anchored = box.localName === 'anchor'

    if (/chart/.test(uri)) {
      const ch = find(gd, 'chart')
      const node = this.chart(ra(ch, 'id'), w, h, ctx, this.alignOf(pp))
      return node ? [{ k: 'block', node }] : []
    }
    const blip = find(gd, 'blip')
    if (blip) {
      const a = await this.image(ra(blip, 'embed'))
      if (!a) return []
      const sr = find(gd, 'srcRect')
      let crop: any = null
      if (sr) {
        const g = (k: string) => (num(sr.getAttribute(k)) || 0) / 100000
        const l = g('l'), t = g('t'), r = g('r'), b = g('b')
        if (l || t || r || b) crop = { x: l, y: t, w: Math.max(0.01, 1 - l - r), h: Math.max(0.01, 1 - t - b) }
      }
      if (anchored) {
        const pos = this.anchorPos(box, w, h, ctx)
        if (pos) {
          const f: FrameData = { id: uid('fr'), kind: 'image', page: this.page, x: r1(pos.x), y: r1(pos.y), w: r1(w), h: r1(h), wrap: pos.wrap, gap: pos.gap, src: 'asset:' + a.id, iw: a.w, ih: a.h, fit: crop ? null : 'stretch', cropRect: crop, alt }
          return this.placeFrame(f, pos)
        }
        const al = find(child(box, 'positionH'), 'align')?.textContent || this.alignOf(pp)
        return [{ k: 'block', node: this.imageNode(a, w, h, ctx, al === 'center' ? 'center' : al === 'right' ? 'right' : 'left', alt, crop) }]
      }
      return [{ k: 'block', node: this.imageNode(a, w, h, ctx, this.alignOf(pp), alt, crop) }]
    }
    const tx = find(gd, 'txbxContent')
    if (tx) {
      const content = await this.boxContent(tx, w)
      const pos = anchored ? this.anchorPos(box, w, h, ctx) : null
      if (pos) {
        const sp = find(gd, 'spPr'), bp = find(gd, 'bodyPr')
        const fill = find(child(sp, 'solidFill'), 'srgbClr')?.getAttribute('val')
        const ln = child(sp, 'ln')
        const noLine = !!child(ln, 'noFill')
        const lc = find(child(ln, 'solidFill'), 'srgbClr')?.getAttribute('val')
        const ins = (k: string, dflt: number) => { const v = emu(bp?.getAttribute(k)); return v ?? dflt }
        const anchor = bp?.getAttribute('anchor')
        return this.placeFrame({
          id: uid('fr'), kind: 'text', page: this.page, x: r1(pos.x), y: r1(pos.y), w: r1(w), h: r1(h), wrap: pos.wrap, gap: pos.gap,
          content: { type: 'doc', content }, pad: r1(Math.max(ins('lIns', 7.2), ins('tIns', 3.6))),
          fill: fill ? '#' + fill.toLowerCase() : null, border: ln && !noLine ? r1(emu(ln.getAttribute('w')) || 0.75) : 0, borderColor: lc ? '#' + lc.toLowerCase() : '#000000',
          valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'
        }, pos)
      }
      return content.map(n => ({ k: 'block', node: n }) as Item)
    }
    return []
  }

  /** Adds a frame; one tied to its paragraph leaves a bookmark there for the first layout to find. */
  private placeFrame(f: FrameData, pos: { y: number; para: boolean }): Item[] {
    if (!pos.para) { this.frames.push(f); return [] }
    const id = 'anc' + uid()
    this.frames.push({ ...f, y: r1(this.geom.margin.top + pos.y), anchor: id, dy: r1(pos.y) })
    return [{ k: 'inline', node: { type: 'bookmark', attrs: { id, name: 'Anchor' } } }]
  }

  /** Text box content: paragraphs, headings and lists (what a CocoaAuthor text box holds). */
  private async boxContent(tx: Element, w: number): Promise<any[]> {
    const b = new Builder('box')
    const saved = this.fields
    this.fields = []
    await this.blocks(kids(tx), { where: 'box', cw: Math.max(20, w - 14.4) }, b)
    this.fields = saved
    this.finishSpacing(b)
    const ok = (n: any): any[] => {
      if (['paragraph', 'heading', 'bulletList', 'orderedList'].includes(n.type)) return [n]
      if (n.type === 'table') return (n.content || []).flatMap((r: any) => (r.content || []).flatMap((c: any) => (c.content || []).flatMap(ok)))
      return []
    }
    const out = b.out.flatMap(ok)
    return out.length ? out : [{ type: 'paragraph' }]
  }

  /**
   * Where an anchored object sits: on the page (y from the page top), or relative to its paragraph (y is the offset
   * from the paragraph's top, resolved after layout). Null inside text boxes, which cannot hold frames.
   */
  private anchorPos(box: Element, w: number, h: number, ctx: Ctx): { x: number; y: number; para: boolean; wrap: FrameData['wrap']; gap: number } | null {
    if (ctx.where === 'box') return null
    const g = this.geom
    const [pw, ph] = g.land ? [g.h, g.w] : [g.w, g.h]
    const m = g.margin
    const ph_ = child(box, 'positionH'), pv = child(box, 'positionV')
    const hRel = ph_?.getAttribute('relativeFrom') || 'column', vRel = pv?.getAttribute('relativeFrom') || 'paragraph'
    const para = !['page', 'margin', 'topMargin', 'bottomMargin'].includes(vRel)
    const range = (rel: string, horiz: boolean): [number, number] => {
      if (horiz) {
        if (rel === 'page') return [0, pw]
        if (rel === 'leftMargin' || rel === 'insideMargin') return [0, m.left]
        if (rel === 'rightMargin' || rel === 'outsideMargin') return [pw - m.right, m.right]
        return [m.left, pw - m.left - m.right]
      }
      if (rel === 'page') return [0, ph]
      if (rel === 'topMargin') return [0, m.top]
      if (rel === 'bottomMargin') return [ph - m.bottom, m.bottom]
      return [m.top, ph - m.top - m.bottom]
    }
    const place = (el: Element | null, rel: string, size: number, horiz: boolean) => {
      const [o, len] = range(rel, horiz)
      const off = emu(child(el, 'posOffset')?.textContent)
      if (off != null) return o + off
      const al = child(el, 'align')?.textContent || 'left'
      if (al === 'center') return o + (len - size) / 2
      if (al === 'right' || al === 'bottom' || al === 'outside') return o + len - size
      return o
    }
    const x = place(ph_, hRel, w, true)
    const y = para ? emu(child(pv, 'posOffset')?.textContent) || 0 : place(pv, vRel, h, false)
    const behind = box.getAttribute('behindDoc') === '1' || box.getAttribute('behindDoc') === 'true'
    const wrapEl = kids(box).find(k => k.localName.startsWith('wrap'))
    const wrap: FrameData['wrap'] = !wrapEl || wrapEl.localName === 'wrapNone' ? (behind ? 'behind' : 'front') : 'around'
    const gap = ['distL', 'distR', 'distT', 'distB'].map(k => emu(box.getAttribute(k)) || 0)
    return { x, y, para, wrap, gap: r1(Math.max(...gap, 0) || 8) }
  }

  /** Old-style VML pictures and text boxes. */
  private async vml(el: Element, ctx: Ctx, pp: PP): Promise<Item[]> {
    const out: Item[] = []
    const shape = find(el, 'shape') || find(el, 'rect')
    const style = shape?.getAttribute('style') || ''
    const dim = (k: string) => { const m = new RegExp('(?:^|;)\\s*' + k + ':\\s*([\\d.]+)(pt|in|px|cm|mm)?').exec(style); if (!m) return 0; const v = parseFloat(m[1]); return m[2] === 'in' ? v * 72 : m[2] === 'cm' ? v * 72 / 2.54 : m[2] === 'mm' ? v * 72 / 25.4 : m[2] === 'px' ? v * 0.75 : v }
    const imd = find(el, 'imagedata')
    if (imd) {
      const a = await this.image(ra(imd, 'id'))
      if (a) out.push({ k: 'block', node: this.imageNode(a, dim('width') || a.w * 0.75, dim('height') || a.h * 0.75, ctx, this.alignOf(pp), imd.getAttribute('o:title') || '', null) })
    }
    const tb = find(el, 'txbxContent')
    if (tb) for (const n of await this.boxContent(tb, dim('width') || ctx.cw)) out.push({ k: 'block', node: n })
    return out
  }

  private chart(rid: string | null, w: number, h: number, ctx: Ctx, align: string): any {
    const rel = rid ? this.pkg.rels(this.main).get(rid) : null
    const d = rel ? this.pkg.xml(rel.target) : null
    const plot = find(d?.documentElement, 'plotArea')
    if (!plot) return null
    const types = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'areaChart', 'area3DChart', 'pieChart', 'pie3DChart', 'doughnutChart']
    const te = kids(plot).find(k => types.includes(k.localName))
    if (!te) return null
    const t = te.localName
    const kind = t.startsWith('bar') ? (val(child(te, 'barDir')) === 'bar' ? 'bar' : 'column') : t.startsWith('line') ? 'line' : t.startsWith('area') ? 'area' : 'pie'
    const pts = (e: Element | null) => findAll(e, 'pt').sort((a, b) => (num(a.getAttribute('idx')) || 0) - (num(b.getAttribute('idx')) || 0)).map(p => find(p, 'v')?.textContent || '')
    let labels: string[] = []
    const series = childrenNamed(te, 'ser').map((s, i) => {
      const cat = pts(child(s, 'cat'))
      if (cat.length > labels.length) labels = cat
      return { name: findAll(child(s, 'tx'), 'v')[0]?.textContent || textOf(child(s, 'tx')) || 'Series ' + (i + 1), values: pts(child(s, 'val')).map(v => parseFloat(v) || 0) }
    })
    if (!series.length) return null
    const chartEl = find(d?.documentElement, 'chart')
    const title = textOf(child(chartEl, 'title'))
    return { type: 'chart', attrs: { kind, title, legend: !!child(chartEl, 'legend'), ratio: w > 0 ? r3(h / w) : 0.56, width: Math.max(10, Math.min(100, Math.round((w / ctx.cw) * 100))), align, labels, series } }
  }

  // ---------- tables ----------

  private async table(tbl: Element, ctx: Ctx): Promise<any> {
    const tblPr = child(tbl, 'tblPr')
    const direct = parseTblPr(tblPr, this.theme)
    const ts = this.st.table(val(child(tblPr, 'tblStyle')) || undefined)
    const borders = { ...(ts?.tbl?.borders || {}), ...direct.borders }
    const mar = { top: 0, left: 5.4, bottom: 0, right: 5.4, ...(ts?.tbl?.mar || {}), ...direct.mar }
    const look = direct.look || ts?.tbl?.look || { firstRow: true, noVBand: true }
    const grid = childrenNamed(child(tbl, 'tblGrid'), 'gridCol').map(g => twip(wa(g, 'w')) || 0)
    const rowsEl: Element[] = []
    const collect = (e: Element) => { for (const k of kids(e)) { if (k.localName === 'tr') rowsEl.push(k); else if (['sdt', 'sdtContent', 'customXml', 'ins'].includes(k.localName)) collect(k) } }
    collect(tbl)
    if (!rowsEl.length) return null

    type CellE = { tc: Element | null; col: number; span: number; rowspan: number; row: number }
    const rows: CellE[][] = []
    const owner = new Map<number, CellE>()
    rowsEl.forEach((tr, ri) => {
      const trPr = child(tr, 'trPr')
      let col = num(val(child(trPr, 'gridBefore'))) || 0
      const cells: CellE[] = []
      for (let k = 0; k < col; k++) cells.push({ tc: null, col: k, span: 1, rowspan: 1, row: ri })
      const tcs: Element[] = []
      const gather = (e: Element) => { for (const k of kids(e)) { if (k.localName === 'tc') tcs.push(k); else if (['sdt', 'sdtContent', 'customXml'].includes(k.localName)) gather(k) } }
      gather(tr)
      for (const tc of tcs) {
        const tcPr = child(tc, 'tcPr')
        const span = num(val(child(tcPr, 'gridSpan'))) || 1
        const vm = child(tcPr, 'vMerge')
        const cont = vm && (val(vm) || 'continue') === 'continue'
        if (cont && owner.has(col)) { owner.get(col)!.rowspan++; col += span; continue }
        const ce: CellE = { tc, col, span, rowspan: 1, row: ri }
        cells.push(ce)
        if (vm) owner.set(col, ce); else owner.delete(col)
        for (let k = 1; k < span; k++) owner.delete(col + k)
        col += span
      }
      rows.push(cells)
    })

    const nRows = rows.length
    const out: any[] = []
    for (let ri = 0; ri < nRows; ri++) {
      const cells: any[] = []
      for (const ce of rows[ri]) {
        const conds: string[] = []
        const lastCol = grid.length ? ce.col + ce.span >= grid.length : false
        const header = look.firstRow && ri === 0
        const footer = look.lastRow && ri === nRows - 1 && nRows > 1
        if (!look.noVBand) conds.push(Math.floor((ce.col - (look.firstColumn ? 1 : 0)) % 2) === 0 ? 'band1Vert' : 'band2Vert')
        if (!look.noHBand && !header && !footer) conds.push(((ri - (look.firstRow ? 1 : 0)) % 2) === 0 ? 'band1Horz' : 'band2Horz')
        if (look.firstColumn && ce.col === 0) conds.push('firstCol')
        if (look.lastColumn && lastCol) conds.push('lastCol')
        if (header) conds.push('firstRow')
        if (footer) conds.push('lastRow')
        const tcPr = child(ce.tc, 'tcPr')
        let bg: string | null | undefined = ts?.tbl?.shd
        for (const c of conds) { const s = ts?.cond[c]?.shd; if (s !== undefined) bg = s }
        const dsh = child(tcPr, 'shd')
        if (dsh) { const f = colorOf(dsh, this.theme, 'fill', 'themeFill'); if (f !== undefined) bg = f }
        const w = grid.length ? grid.slice(ce.col, ce.col + ce.span).reduce((a, b) => a + b, 0) : ctx.cw / Math.max(1, rows[0].length)
        const cctx: Ctx = { where: 'cell', cw: Math.max(10, w - mar.left - mar.right), tbl: { style: ts, conds } }
        const b = new Builder('cell')
        if (ce.tc) await this.blocks(kids(ce.tc).filter(k => k.localName !== 'tcPr'), cctx, b)
        this.finishSpacing(b)
        const attrs: any = { colspan: ce.span, rowspan: ce.rowspan }
        if (grid.length) attrs.colwidth = grid.slice(ce.col, ce.col + ce.span).map(x => Math.max(10, r1(x)))
        if (bg && bg !== '#ffffff') attrs.backgroundColor = bg
        cells.push({ type: 'tableCell', attrs, content: b.out.length ? b.out : [{ type: 'paragraph' }] })
      }
      if (cells.length) out.push({ type: 'tableRow', content: cells })
    }
    if (!out.length) return null
    const lines = [borders.top, borders.left, borders.bottom, borders.right, borders.insideH, borders.insideV]
    const gridAttr = lines.every(x => x == null) ? 'none' : (borders.insideH || borders.top || borders.insideV || borders.left || '#000000')
    return { type: 'table', attrs: { grid: gridAttr, pad: [r1(mar.top), r1(mar.right), r1(mar.bottom), r1(mar.left)] }, content: out }
  }

  // ---------- sections, headers and footers ----------

  private geomOf(sp: Element | null): Geom {
    const g: Geom = { w: 612, h: 792, land: false, margin: { top: 72, right: 72, bottom: 72, left: 72 }, titlePg: false, type: 'nextPage', hdr: {}, ftr: {} }
    if (!sp) return g
    const sz = child(sp, 'pgSz')
    const w = twip(wa(sz, 'w')), h = twip(wa(sz, 'h'))
    if (w && h) { g.land = wa(sz, 'orient') === 'landscape' || w > h; g.w = Math.min(w, h); g.h = Math.max(w, h) }
    const mg = child(sp, 'pgMar')
    if (mg) {
      const a = (k: string, d: number) => { const v = twip(wa(mg, k)); return v == null ? d : Math.abs(v) }
      g.margin = { top: a('top', 72), right: a('right', 72), bottom: a('bottom', 72), left: a('left', 72) + (twip(wa(mg, 'gutter')) || 0) }
    }
    const pn = child(sp, 'pgNumType')
    g.numFmt = wa(pn, 'fmt') || undefined
    g.numStart = num(wa(pn, 'start'))
    g.titlePg = onOff(child(sp, 'titlePg')) || false
    g.type = val(child(sp, 'type')) || 'nextPage'
    for (const r of childrenNamed(sp, 'headerReference')) g.hdr[wa(r, 'type') || 'default'] = ra(r, 'id') || ''
    for (const r of childrenNamed(sp, 'footerReference')) g.ftr[wa(r, 'type') || 'default'] = ra(r, 'id') || ''
    return g
  }

  /** A Word header or footer as CocoaAuthor's left / centre / right text with {page}, {pages} and {section}. */
  private hf(rid: string | undefined): HF {
    const empty: HF = { left: '', center: '', right: '' }
    const rel = rid ? this.pkg.rels(this.main).get(rid) : undefined
    const d = rel ? this.pkg.xml(rel.target) : null
    if (!d) return empty
    const slots: string[][] = [[], [], []]
    for (const p of findAll(d.documentElement, 'p')) {
      if (p.parentElement && p.parentElement.localName === 'txbxContent') continue
      const segs: string[] = ['']
      const ptabAt: number[] = []
      const fields: { instr: string; phase: string; tok?: string }[] = []
      const add = (s: string) => { if (!fields.some(f => f.phase === 'instr' || f.tok)) segs[segs.length - 1] += s }
      const tokOf = (instr: string) => {
        const n = (/^\s*(\S+)/.exec(instr)?.[1] || '').toUpperCase()
        return n === 'PAGE' ? '{page}' : n === 'NUMPAGES' || n === 'SECTIONPAGES' ? '{pages}' : n === 'STYLEREF' ? '{section}' : n === 'TITLE' ? '{title}' : n === 'AUTHOR' ? '{author}' : undefined
      }
      const walk = (e: Element) => {
        for (const c of kids(e)) {
          switch (c.localName) {
            case 't': add(c.textContent || ''); break
            case 'tab': if (!fields.some(f => f.phase === 'instr')) segs.push(''); break
            case 'ptab': { segs.push(''); ptabAt[segs.length - 1] = ({ center: 1, right: 2 } as any)[wa(c, 'alignment') || ''] ?? 0; break }
            case 'pgNum': add('{page}'); break
            case 'fldSimple': { const tk = tokOf(wa(c, 'instr') || ''); if (tk) add(tk); else walk(c); break }
            case 'fldChar': {
              const t = wa(c, 'fldCharType')
              if (t === 'begin') fields.push({ instr: '', phase: 'instr' })
              else if (t === 'separate' || t === 'end') {
                const f = fields[fields.length - 1]
                if (f && f.phase === 'instr') { f.phase = 'result'; const tk = tokOf(f.instr); if (tk) { segs[segs.length - 1] += tk; f.tok = tk } }
                if (t === 'end') fields.pop()
              }
              break
            }
            case 'instrText': { const f = fields[fields.length - 1]; if (f && f.phase === 'instr') f.instr += c.textContent || ''; break }
            case 'pPr': case 'rPr': case 'drawing': case 'pict': case 'del': break
            default: walk(c)
          }
        }
      }
      walk(p)
      if (!segs.some(s => s.trim())) continue
      const align = parsePPr(child(p, 'pPr'), this.theme).align
      let place: number[]
      if (ptabAt.some(x => x != null)) place = segs.map((_, i) => ptabAt[i] ?? (i === 0 ? 0 : Math.min(2, i)))
      else if (segs.length === 1) place = [align === 'center' ? 1 : align === 'right' ? 2 : 0]
      else if (segs.length === 2) {
        const tabs = parsePPr(child(p, 'pPr'), this.theme).tabs || this.st.para(parsePPr(child(p, 'pPr'), this.theme).style || 'Header').pp.tabs || []
        const onlyRight = tabs.length > 0 && tabs.every(t => t.type === 'right' || t.type === 'end')
        place = [0, onlyRight ? 2 : 1]
      } else place = segs.map((_, i) => Math.min(2, i))
      segs.forEach((s, i) => { if (s.trim()) slots[place[i]].push(s.trim()) })
    }
    return { left: slots[0].join('\n'), center: slots[1].join('\n'), right: slots[2].join('\n') }
  }

  private settings(g: Geom, d: Document): PageSettings {
    const s = defaultSettings()
    s.width = g.w; s.height = g.h; s.landscape = g.land
    const near3 = (a: number, b: number) => Math.abs(a - b) < 3
    s.size = Object.entries({ A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A5: [419.53, 595.28], A3: [841.89, 1190.55], Tabloid: [792, 1224] }).find(([, [w, h]]) => near3(w, g.w) && near3(h, g.h))?.[0] || 'Custom'
    s.margin = { top: r1(g.margin.top), right: r1(g.margin.right), bottom: r1(g.margin.bottom), left: r1(g.margin.left) }
    s.units = s.size === 'Letter' || s.size === 'Legal' || s.size === 'Tabloid' ? 'in' : 'mm'
    const NUM: Record<string, NumberFormat> = { decimal: 'decimal', lowerRoman: 'lower-roman', upperRoman: 'upper-roman', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha' }
    s.numberFormat = NUM[g.numFmt || 'decimal'] || 'decimal'
    s.numberStart = g.numStart ?? 1
    s.header = this.hf(g.hdr.default); s.footer = this.hf(g.ftr.default)
    s.firstDifferent = g.titlePg
    s.firstHeader = g.titlePg ? this.hf(g.hdr.first) : { left: '', center: '', right: '' }
    s.firstFooter = g.titlePg ? this.hf(g.ftr.first) : { left: '', center: '', right: '' }
    const setRel = this.pkg.relOfType(this.main, 'settings')
    const sd = setRel ? this.pkg.xml(setRel.target) : null
    s.oddEven = !!onOff(find(sd?.documentElement, 'evenAndOddHeaders'))
    s.evenHeader = this.hf(g.hdr.even); s.evenFooter = this.hf(g.ftr.even)
    const any = (h: HF) => !!(h.left || h.center || h.right)
    s.headerOn = any(s.header) || any(s.firstHeader) || any(s.evenHeader)
    s.footerOn = any(s.footer) || any(s.firstFooter) || any(s.evenFooter)
    s.hyphenate = !!onOff(find(sd?.documentElement, 'autoHyphenation'))
    s.headingNumbers = this.headingNumbers
    s.spaceAtTop = true
    const lang = (this.st.docR.lang || '').toLowerCase()
    s.lang = lang.startsWith('ru') ? 'ru' : lang === 'en-gb' ? 'en-GB' : lang.startsWith('en') ? 'en-US' : s.lang
    const bg = colorOf(child(d.documentElement, 'background'), this.theme, 'color')
    if (bg) s.background = bg
    return s
  }
}

// ---------- helpers ----------

/** Picks the branch of mc:AlternateContent this reader understands (drawingML shapes), else the fallback. */
function choose(el: Element): Element | null {
  const ok = ['wps', 'wpg', 'wp14', 'w14', 'w15', 'a14', 'wpc']
  for (const c of childrenNamed(el, 'Choice')) {
    const req = (c.getAttribute('Requires') || '').split(/\s+/)
    if (req.every(r => ok.includes(r))) return c
  }
  return child(el, 'Fallback')
}

const FMT: Record<string, string> = { decimal: 'decimal', decimalZero: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman' }

function listAttrs(l: Lvl, ilvl: number, start: number): any {
  if (l.fmt === 'bullet') return { char: bulletChar(l.text), tight: true }
  const fmt = FMT[l.fmt] || 'decimal'
  const a: any = { start, fmt, tight: true }
  if (l.text !== `%${ilvl + 1}.`) a.pat = l.text
  return a
}

function bulletChar(t: string): string | null {
  const c = t.charCodeAt(0)
  if (!t) return null
  const PUA: Record<number, string> = { 0xf0b7: '•', 0xf0a7: '▪', 0xf0a8: '□', 0xf076: '❖', 0xf0d8: '➢', 0xf0fc: '✓', 0xf06e: '■', 0xf0b2: '◊', 0xf02d: '–', 0xf0e0: '→' }
  if (PUA[c]) return PUA[c]
  if (c >= 0xf000 && c <= 0xf0ff) return '•'
  if (t === 'o') return '◦'
  if (t === '§') return '▪'
  return t
}

function symbol(font: string, hex: string): string {
  const c = parseInt(hex, 16)
  if (isNaN(c)) return ''
  const PUA: Record<number, string> = { 0xf0b7: '•', 0xf0a7: '▪', 0xf0fc: '✓', 0xf0fb: '✗', 0xf0e0: '→', 0xf0d8: '➢', 0xf0a8: '□', 0xf06f: '□', 0xf078: '☒', 0xf0fe: '☑' }
  if (PUA[c]) return PUA[c]
  if (/symbol/i.test(font)) {
    const sym: Record<number, string> = { 0xf0b7: '•', 0xf0d3: '©', 0xf0d2: '®', 0xf0b0: '°', 0xf0b1: '±', 0xf0b4: '×', 0xf0b8: '÷', 0xf0a3: '≤', 0xf0b3: '≥', 0xf0b9: '≠', 0xf0ae: '→', 0xf0ac: '←' }
    if (sym[c]) return sym[c]
  }
  return c < 0xf000 ? String.fromCodePoint(c) : ''
}

/** Joins neighbouring text nodes with the same marks. */
function mergeText(nodes: any[]): any[] {
  const out: any[] = []
  for (const n of nodes) {
    const p = out[out.length - 1]
    if (n.type === 'text' && p && p.type === 'text' && JSON.stringify(p.marks || []) === JSON.stringify(n.marks || [])) p.text += n.text
    else out.push(n.type === 'text' ? { ...n } : n)
  }
  return out.filter(n => n.type !== 'text' || n.text.length)
}

/** CocoaAuthor writes "Figure 3: " itself; remove Word's typed label and separator around the SEQ number. */
function stripCaptionLabel(content: any[]) {
  let i = 0
  let stage = 0
  while (i < content.length && stage < 2) {
    const n = content[i]
    if (n.type !== 'text') break
    let t: string = n.text
    if (stage === 0) { t = t.replace(/^\s*(Figure|Fig\.|Table|Рисунок|Рис\.|Таблица)\s*/i, ''); stage = 1 }
    if (stage === 1) { const u = t.replace(/^\s*[:.\-–—]?\s*/, ''); if (u !== t || t) stage = 2; t = u }
    if (t) { content[i] = { ...n, text: t }; break }
    content.splice(i, 1)
  }
}

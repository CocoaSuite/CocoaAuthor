import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ExternalHyperlink, InternalHyperlink, Bookmark, ImageRun, PageBreak, PageReference, SimpleField, TableOfContents, FootnoteReferenceRun,
  EndnoteReferenceRun, Header, Footer, PageNumber, TabStopType, NumberFormat, LevelFormat, PageOrientation, Tab, VerticalAlignTable, TableLayoutType
} from 'docx'
import type { CADocument, PageSettings, StyleSet, TextStyleDef, HF } from '../model/types'
import { defaultStyles, pageDims, fontKey, FONTS } from '../model/types'
import { getSettings, collectTargets, xrefText, textOf } from '../layout/plugin'
import { fontBytes, fontFile } from '../layout/fonts'
import { assets } from '../editor/registry'
import type { Layout } from '../layout/paginate'
import { ensureAssets } from './render'
import { getSchema } from '@tiptap/core'
import { extensions } from '../editor/extensions'

let _schema: any = null
const schema = () => (_schema ||= getSchema(extensions()))

const tw = (pt: number) => Math.round(pt * 20)
const hp = (pt: number) => Math.round(pt * 2)
const hex = (c: string) => (c || '#000000').replace('#', '').slice(0, 6).toUpperCase()
const bm = (id: string) => ('b_' + String(id).replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 40)
const ALIGN: Record<string, any> = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }
const NUMFMT: Record<string, any> = { decimal: NumberFormat.DECIMAL, 'lower-roman': NumberFormat.LOWER_ROMAN, 'upper-roman': NumberFormat.UPPER_ROMAN, 'lower-alpha': NumberFormat.LOWER_LETTER, 'upper-alpha': NumberFormat.UPPER_LETTER }

function runStyle(t: TextStyleDef) {
  return { font: t.font, size: hp(t.size), bold: t.weight >= 600, italics: t.italic, color: hex(t.color), allCaps: t.caps, characterSpacing: t.tracking ? Math.round(t.tracking * t.size * 20) : undefined }
}
function paraStyle(t: TextStyleDef) {
  return { spacing: { before: tw(t.before), after: tw(t.after), line: Math.round(240 * t.lineHeight) }, alignment: ALIGN[t.align] }
}

export async function buildDOCX(doc: CADocument, layout: Layout | null, opts: { embedFonts: boolean } = { embedFonts: true }): Promise<Blob> {
  await ensureAssets(doc)
  const content = doc.content
  const pmDoc = schema().nodeFromJSON(content)
  const s: PageSettings = getSettings(pmDoc)
  const S: StyleSet = { ...defaultStyles(), ...(content.attrs?.styles || {}) }
  S.text = { ...defaultStyles().text, ...(content.attrs?.styles?.text || {}) }
  const idPage = layout?.idPage || {}
  const targets = collectTargets(pmDoc, s)
  const usedFonts = new Set<string>()
  const footnotes: Record<string, { children: Paragraph[] }> = {}
  const endnotes: Record<string, { children: Paragraph[] }> = {}
  let fnN = 0, enN = 0, olInstance = 0, figN = 0, tabN = 0
  const hc = [0, 0, 0, 0]
  const headingsList: { id: string; text: string; level: number }[] = []

  const firstIdOnPage = (label: string) => Object.keys(idPage).find(k => idPage[k] === label)

  const runsOf = (n: any, base: Record<string, any> = {}): any[] => {
    const out: any[] = []
    let linkBuf: { href: string; runs: any[] } | null = null
    const flushLink = () => {
      if (!linkBuf) return
      const href = linkBuf.href
      if (href.startsWith('#page=')) {
        const id = firstIdOnPage(href.slice(6))
        out.push(id ? new InternalHyperlink({ anchor: bm(id), children: linkBuf.runs }) : linkBuf.runs)
      } else if (href.startsWith('#')) out.push(new InternalHyperlink({ anchor: bm(href.slice(1)), children: linkBuf.runs }))
      else out.push(new ExternalHyperlink({ link: href, children: linkBuf.runs }))
      linkBuf = null
    }
    for (const c of n.content || []) {
      if (c.type === 'text') {
        const o: any = { text: c.text, ...base }
        let link: string | null = null
        for (const m of c.marks || []) {
          const a = m.attrs || {}
          if (m.type === 'bold') o.bold = true
          else if (m.type === 'italic') o.italics = true
          else if (m.type === 'underline') o.underline = {}
          else if (m.type === 'strike') o.strike = true
          else if (m.type === 'hint') { o.color = '8B919B'; o.italics = true }
          else if (m.type === 'highlight') o.shading = { type: ShadingType.CLEAR, fill: hex(a.color || '#fff3a3'), color: 'auto' }
          else if (m.type === 'textStyle') {
            if (a.color) o.color = hex(a.color)
            if (a.fontFamily) { o.font = a.fontFamily.replace(/["']/g, '').split(',')[0].trim(); usedFonts.add(o.font) }
            if (a.fontSize) o.size = hp(parseFloat(a.fontSize))
          } else if (m.type === 'link') link = a.href
        }
        if (link) { o.style = 'Hyperlink'; o.color = hex(S.link); o.underline = {} }
        const run = new TextRun(o)
        if (link) {
          if (linkBuf && linkBuf.href !== link) flushLink()
          linkBuf ||= { href: link, runs: [] }
          linkBuf.runs.push(run)
        } else { flushLink(); out.push(run) }
        continue
      }
      flushLink()
      if (c.type === 'hardBreak') out.push(new TextRun({ break: 1, ...base }))
      else if (c.type === 'footnote') {
        const para = new Paragraph({ style: 'FootnoteText', children: [new TextRun(c.attrs.text || '')] })
        if (c.attrs.kind === 'end') { enN++; endnotes[enN] = { children: [para] }; out.push(new EndnoteReferenceRun(enN)) }
        else { fnN++; footnotes[fnN] = { children: [para] }; out.push(new FootnoteReferenceRun(fnN)) }
      } else if (c.type === 'xref') {
        const tg = targets.get(c.attrs.target)
        const show = c.attrs.show
        const b = bm(c.attrs.target)
        const st = { style: 'Hyperlink', color: hex(S.link), ...base }
        if (!tg) out.push(new TextRun({ text: '[missing reference]', color: 'C0392B' }))
        else if (show === 'page') out.push(new PageReference(b, { hyperlink: true }))
        else if (show === 'textpage') {
          const t = xrefText(tg, 'textpage', idPage[c.attrs.target]).text.replace(/, page .*$/, '')
          out.push(new InternalHyperlink({ anchor: b, children: [new TextRun({ text: t + ', page ', ...st })] }), new PageReference(b, { hyperlink: true }))
        } else out.push(new InternalHyperlink({ anchor: b, children: [new TextRun({ text: xrefText(tg, show, idPage[c.attrs.target]).text, ...st })] }))
      } else if (c.type === 'bookmark') out.push(new Bookmark({ id: bm(c.attrs.id), children: [new TextRun('')] }))
    }
    flushLink()
    return out.flat()
  }

  const contentWidthPx = (land: boolean) => { const [w] = pageDims(s, land); return (w - s.margin.left - s.margin.right) * 96 / 72 }

  const imagePara = async (n: any, land: boolean) => {
    const id = String(n.attrs.src || '').replace('asset:', '')
    const blob = assets.blob(id)
    if (!blob) return new Paragraph({ children: [new TextRun({ text: '[image missing]', color: '999999' })] })
    const ratio = n.attrs.crop ? (() => { const [a, b] = n.attrs.crop.split(':').map(Number); return b / a })() : n.attrs.h / n.attrs.w
    const wpx = contentWidthPx(land) * (n.attrs.width || 100) / 100
    const { data, type } = await imageData(blob, n.attrs.crop ? 1 / ratio : null)
    return new Paragraph({
      alignment: ALIGN[n.attrs.align] || AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 80 },
      children: [new ImageRun({ type, data, transformation: { width: Math.round(wpx), height: Math.round(wpx * ratio) }, altText: { name: n.attrs.alt || 'Image', description: n.attrs.alt || '', title: n.attrs.alt || '' } } as any)]
    })
  }

  const blocks = async (nodes: any[], ctx: { quote?: boolean; list?: { ref: string; level: number; instance: number }; cell?: boolean; callout?: string; land: boolean }): Promise<any[]> => {
    const out: any[] = []
    for (const n of nodes || []) {
      const a = n.attrs || {}
      if (n.type === 'paragraph') {
        let style: string | undefined = a.kind === 'title' ? 'Title' : a.kind === 'subtitle' ? 'Subtitle' : a.kind === 'caption' ? 'Caption' : undefined
        if (!style && ctx.quote) style = 'Quote'
        if (!style && ctx.cell) style = 'TableText'
        if (!style && ctx.list) style = 'ListParagraph'
        let kids = runsOf(n)
        if (a.kind === 'caption' && (a.label === 'figure' || a.label === 'table')) {
          const nm = a.label === 'figure' ? 'Figure' : 'Table'
          const num = a.label === 'figure' ? ++figN : ++tabN
          kids = [new TextRun({ text: nm + ' ', bold: true }), new SimpleField(`SEQ ${nm} \\* ARABIC`, String(num)), new TextRun({ text: kids.length ? ': ' : '', bold: true }), ...kids]
        }
        if (a.id) kids = [new Bookmark({ id: bm(a.id), children: kids })]
        out.push(new Paragraph({
          style, children: kids,
          alignment: a.textAlign ? ALIGN[a.textAlign] : undefined,
          indent: a.indent ? { left: tw(a.indent * 18) } : undefined,
          numbering: ctx.list ? { reference: ctx.list.ref, level: ctx.list.level, instance: ctx.list.instance } : undefined,
          keepNext: a.kind === 'title' || a.kind === 'subtitle' || (a.kind === 'caption' && a.label === 'table') ? true : undefined,
          ...(ctx.callout ? calloutProps(ctx.callout) : {})
        }))
      } else if (n.type === 'heading') {
        const l = Math.min(4, a.level)
        hc[l - 1]++
        for (let k = l; k < 4; k++) hc[k] = 0
        const num = s.headingNumbers ? hc.slice(0, l).map(x => x || 1).join('.') : ''
        const kids = [...(num ? [new TextRun(num + '  ')] : []), ...runsOf(n)]
        headingsList.push({ id: a.id, text: (num ? num + ' ' : '') + textOf(schema().nodeFromJSON(n)), level: l })
        out.push(new Paragraph({
          heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][l - 1],
          alignment: a.textAlign ? ALIGN[a.textAlign] : undefined,
          children: a.id ? [new Bookmark({ id: bm(a.id), children: kids })] : kids
        }))
      } else if (n.type === 'bulletList' || n.type === 'orderedList') {
        const lvl = ctx.list ? ctx.list.level + 1 : 0
        const ordered = n.type === 'orderedList'
        const inst = ordered ? ++olInstance : 0
        for (const li of n.content || []) {
          out.push(...(await blocks(li.content, { ...ctx, list: { ref: ordered ? 'numbers' : 'bullets', level: Math.min(8, lvl), instance: inst } })))
        }
      } else if (n.type === 'blockquote') out.push(...(await blocks(n.content, { ...ctx, quote: true })))
      else if (n.type === 'callout') out.push(...(await blocks(n.content, { ...ctx, callout: a.tone || 'note' })))
      else if (n.type === 'horizontalRule') out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(S.grid), space: 1 } }, spacing: { before: 120, after: 240 } }))
      else if (n.type === 'pageBreak') out.push(new Paragraph({ children: [new PageBreak()] }))
      else if (n.type === 'image') out.push(await imagePara(n, ctx.land))
      else if (n.type === 'toc') {
        if (a.title) out.push(new Paragraph({ style: 'TOCHeading', children: a.id ? [new Bookmark({ id: bm(a.id), children: [new TextRun(a.title)] })] : [new TextRun(a.title)] }))
        out.push({ __toc: a.levels || 3 })
      } else if (n.type === 'table') out.push(await table(n, ctx))
    }
    return out
  }

  const calloutProps = (tone: string) => {
    const col: Record<string, [string, string]> = { note: [S.accent, S.calloutBg], tip: ['#2f7d5b', '#eef6f1'], warning: ['#b5651d', '#fbf2e8'], key: ['#1d1d1f', '#f2f2f2'] }
    const [b, f] = col[tone] || col.note
    return { shading: { type: ShadingType.CLEAR, fill: hex(f), color: 'auto' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: hex(b), space: 8 } }, indent: { left: 200, right: 200 } }
  }

  const table = async (n: any, ctx: any) => {
    const rows = n.content || []
    const cols = Math.max(1, ...rows.map((r: any) => (r.content || []).reduce((a: number, c: any) => a + (c.attrs?.colspan || 1), 0)))
    const border = { style: BorderStyle.SINGLE, size: 4, color: hex(S.grid) }
    const trs: TableRow[] = []
    for (const r of rows) {
      const head = (r.content || []).every((c: any) => c.type === 'tableHeader')
      const cells: TableCell[] = []
      for (const c of r.content || []) {
        const bg = c.attrs?.backgroundColor || (c.type === 'tableHeader' ? S.tableHead : null)
        const kids = await blocks(c.content, { ...ctx, cell: true, list: undefined })
        cells.push(new TableCell({
          children: kids.length ? kids : [new Paragraph('')],
          columnSpan: c.attrs?.colspan > 1 ? c.attrs.colspan : undefined,
          rowSpan: c.attrs?.rowspan > 1 ? c.attrs.rowspan : undefined,
          shading: bg ? { type: ShadingType.CLEAR, fill: hex(bg), color: 'auto' } : undefined,
          verticalAlign: VerticalAlignTable.TOP,
          margins: { top: 100, bottom: 100, left: 140, right: 140 }
        }))
      }
      trs.push(new TableRow({ children: cells, tableHeader: head || undefined, cantSplit: true }))
    }
    const totalTw = tw(pageDims(s, ctx.land)[0] - s.margin.left - s.margin.right)
    return new Table({
      rows: trs,
      width: { size: totalTw, type: WidthType.DXA },
      columnWidths: Array(cols).fill(Math.floor(totalTw / cols)),
      layout: TableLayoutType.FIXED,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }
    })
  }

  const hfPara = (t: HF, land: boolean) => {
    const parts = [t.left, t.center, t.right]
    const kids: any[] = []
    parts.forEach((p, i) => {
      if (i > 0) kids.push(new TextRun({ children: [new Tab()] }))
      const toks = p.split(/(\{\w+\})/)
      for (const tk of toks) {
        if (!tk) continue
        if (tk === '{page}') kids.push(new TextRun({ children: [PageNumber.CURRENT] }))
        else if (tk === '{pages}') kids.push(new TextRun({ children: [PageNumber.TOTAL_PAGES] }))
        else if (tk === '{section}') kids.push(new SimpleField('STYLEREF "Heading 1" \\* MERGEFORMAT', ''))
        else kids.push(new TextRun(tk.replace('{title}', doc.meta.title).replace('{subtitle}', doc.meta.subtitle).replace('{author}', doc.meta.author).replace('{date}', new Date(doc.meta.modified).toLocaleDateString())))
      }
    })
    const cw = tw(pageDims(s, land)[0] - s.margin.left - s.margin.right)
    return new Paragraph({ style: 'Header', tabStops: [{ type: TabStopType.CENTER, position: Math.round(cw / 2) }, { type: TabStopType.RIGHT, position: cw }], children: kids })
  }
  const hasHF = (t: HF) => !!(t.left || t.center || t.right)

  const sections: any[] = []
  const secNodes = content.content || []
  for (let i = 0; i < secNodes.length; i++) {
    const sn = secNodes[i]
    const land = sn.attrs?.landscape ?? s.landscape
    const kids = await blocks(sn.content, { land })
    const [pw, ph] = pageDims(s, false)
    const mk = (t: HF, on: boolean, ctor: any) => new ctor({ children: on && hasHF(t) ? [hfPara(t, land)] : [new Paragraph('')] })
    const headers: any = { default: mk(s.header, s.headerOn, Header) }
    const footers: any = { default: mk(s.footer, s.footerOn, Footer) }
    if (s.firstDifferent && i === 0) { headers.first = mk(s.firstHeader, s.headerOn, Header); footers.first = mk(s.firstFooter, s.footerOn, Footer) }
    if (s.oddEven) { headers.even = mk(s.evenHeader, s.headerOn, Header); footers.even = mk(s.evenFooter, s.footerOn, Footer) }
    const restart = sn.attrs?.restart
    sections.push({
      properties: {
        titlePage: s.firstDifferent && i === 0,
        page: {
          size: { width: tw(pw), height: tw(ph), orientation: land ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: tw(s.margin.top), right: tw(s.margin.right), bottom: tw(s.margin.bottom), left: tw(s.margin.left), header: tw(Math.max(18, s.margin.top * 0.45)), footer: tw(Math.max(18, s.margin.bottom * 0.45)) },
          pageNumbers: { start: i === 0 ? s.numberStart : restart ?? undefined, formatType: NUMFMT[s.numberFormat] }
        }
      },
      headers, footers,
      children: kids
    })
  }

  for (const sec of sections) {
    sec.children = sec.children.flatMap((c: any) => {
      if (!c || !c.__toc) return [c]
      const lv = c.__toc
      return [new TableOfContents('Contents', {
        hyperlink: true, headingStyleRange: `1-${lv}`,
        cachedEntries: headingsList.filter(x => x.level <= lv).map(x => ({ title: x.text, level: x.level, page: parseInt(idPage[x.id]) || undefined, href: bm(x.id) }))
      } as any)]
    })
  }

  const T = S.text
  const pstyle = (id: string, name: string, t: TextStyleDef, extra: any = {}) => ({ id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: runStyle(t), paragraph: { ...paraStyle(t), ...extra } })
  for (const k of Object.keys(T)) usedFonts.add((T as any)[k].font)

  let fonts: any[] | undefined
  if (opts.embedFonts) {
    fonts = []
    for (const name of usedFonts) {
      const f = FONTS.find(x => x.name === name)
      if (!f) continue
      const key = fontKey(name)
      try {
        const [r, b, it, bi] = await Promise.all([fontBytes(fontFile(key, 400, false)), fontBytes(fontFile(key, 700, false)), fontBytes(fontFile(key, 400, true)), fontBytes(fontFile(key, 700, true))])
        fonts.push({ name, data: r, bold: b, italics: it, boldItalics: bi, characterSet: '00' })
      } catch {}
    }
  }

  const levels = (ordered: boolean) => Array.from({ length: 9 }, (_, l) => ({
    level: l,
    format: ordered ? [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][l % 3] : LevelFormat.BULLET,
    text: ordered ? `%${l + 1}.` : ['•', '◦', '▪'][l % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 440 + l * 440, hanging: 300 } }, ...(ordered ? {} : { run: { font: 'Inter' } }) }
  }))

  const docx = new Document({
    creator: doc.meta.author || 'CocoaAuthor',
    lastModifiedBy: doc.meta.author || 'CocoaAuthor',
    title: doc.meta.title,
    subject: doc.meta.subject || doc.meta.subtitle,
    keywords: doc.meta.keywords,
    description: doc.meta.subtitle,
    evenAndOddHeaderAndFooters: s.oddEven,
    fonts,
    features: { updateFields: false },
    pageNumbers: Object.assign(() => ({
      bookmarks: new Map(Object.entries(idPage).map(([k, v]) => [bm(k), v])),
      bookmarkPageNumbers: new Map(Object.entries(idPage).map(([k, v]) => [bm(k), parseInt(v) || 0])),
      pageCount: layout?.pages.length
    }), {}),
    numbering: { config: [{ reference: 'bullets', levels: levels(false) }, { reference: 'numbers', levels: levels(true) }] },
    styles: {
      default: {
        document: { run: runStyle(T.body), paragraph: paraStyle(T.body) },
        title: { run: runStyle(T.title), paragraph: paraStyle(T.title) },
        heading1: { run: runStyle(T.h1), paragraph: { ...paraStyle(T.h1), keepNext: true, keepLines: true } },
        heading2: { run: runStyle(T.h2), paragraph: { ...paraStyle(T.h2), keepNext: true, keepLines: true } },
        heading3: { run: runStyle(T.h3), paragraph: { ...paraStyle(T.h3), keepNext: true, keepLines: true } },
        heading4: { run: runStyle(T.h4), paragraph: { ...paraStyle(T.h4), keepNext: true, keepLines: true } },
        listParagraph: { run: runStyle(T.list), paragraph: paraStyle(T.list) },
        hyperlink: { run: { color: hex(S.link), underline: {} } }
      },
      paragraphStyles: [
        pstyle('Subtitle', 'Subtitle', T.subtitle),
        pstyle('Caption', 'caption', T.caption),
        pstyle('Quote', 'Quote', T.quote, { indent: { left: 320 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: hex(S.accent), space: 10 } } }),
        pstyle('TableText', 'Table Text', T.table),
        pstyle('FootnoteText', 'footnote text', T.footnote),
        pstyle('Header', 'header', T.header),
        pstyle('Footer', 'footer', T.header),
        pstyle('TOCHeading', 'TOC Heading', T.h1, { keepNext: true })
      ]
    },
    footnotes,
    endnotes,
    sections
  } as any)
  return Packer.toBlob(docx)
}

async function imageData(blob: Blob, crop: number | null): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' }> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const png = bytes[0] === 0x89 && bytes[1] === 0x50
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8
  const gif = bytes[0] === 0x47 && bytes[1] === 0x49
  if (!crop && (png || jpg || gif)) return { data: bytes, type: png ? 'png' : jpg ? 'jpg' : 'gif' }
  const url = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise(r => { img.onload = img.onerror = r; img.src = url })
  URL.revokeObjectURL(url)
  let w = img.naturalWidth || 1200, h = img.naturalHeight || 900
  let sx = 0, sy = 0, sw = w, sh = h
  if (crop) {
    const want = crop
    if (w / h > want) { sw = h * want; sx = (w - sw) / 2 } else { sh = w / want; sy = (h - sh) / 2 }
  }
  const k = Math.min(1, 4096 / Math.max(sw, sh))
  const cv = document.createElement('canvas')
  cv.width = Math.round(sw * k); cv.height = Math.round(sh * k)
  cv.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height)
  const out = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'))
  return { data: new Uint8Array(await out!.arrayBuffer()), type: 'png' }
}

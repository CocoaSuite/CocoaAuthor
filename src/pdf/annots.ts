import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFString, PDFHexString, type PDFFont, type PDFObject } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { uid } from '../util'

/** Review annotations, in PDF user-space points (origin bottom-left). */
export interface Reply { id: string; author: string; date: number; text: string }
interface Base { id: string; page: number; author: string; date: number; color: string; opacity: number; contents: string; replies: Reply[] }
export type Ink = Base & { type: 'ink'; width: number; paths: number[][]; marker?: boolean }
export type Box = Base & { type: 'rect' | 'ellipse'; rect: number[]; width: number }
export type Line = Base & { type: 'arrow' | 'line'; pts: number[]; width: number }
export type Text = Base & { type: 'text'; rect: number[]; size: number }
export type Note = Base & { type: 'note'; x: number; y: number }
export type Mark = Base & { type: 'highlight' | 'underline' | 'strike'; quads: number[] }
export type Annot = Ink | Box | Line | Text | Note | Mark

export const NOTE = 20

export const TYPE_LABEL: Record<Annot['type'], string> = {
  ink: 'Drawing', rect: 'Rectangle', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', text: 'Text', note: 'Comment', highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough'
}

/** Bounding box [x1, y1, x2, y2] in PDF points. */
export function bounds(a: Annot): number[] {
  switch (a.type) {
    case 'ink': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
      for (const p of a.paths) for (let i = 0; i < p.length; i += 2) { x1 = Math.min(x1, p[i]); x2 = Math.max(x2, p[i]); y1 = Math.min(y1, p[i + 1]); y2 = Math.max(y2, p[i + 1]) }
      const w = a.width / 2
      return [x1 - w, y1 - w, x2 + w, y2 + w]
    }
    case 'rect': case 'ellipse': case 'text': return norm(a.rect)
    case 'arrow': case 'line': { const r = norm(a.pts); const w = a.width * 3 + 4; return [r[0] - w, r[1] - w, r[2] + w, r[3] + w] }
    case 'note': return [a.x, a.y - NOTE, a.x + NOTE, a.y]
    default: {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
      for (let i = 0; i < a.quads.length; i += 2) { x1 = Math.min(x1, a.quads[i]); x2 = Math.max(x2, a.quads[i]); y1 = Math.min(y1, a.quads[i + 1]); y2 = Math.max(y2, a.quads[i + 1]) }
      return [x1, y1, x2, y2]
    }
  }
}
export const norm = (r: number[]) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]

export function translate(a: Annot, dx: number, dy: number) {
  const mv = (p: number[]) => { for (let i = 0; i < p.length; i += 2) { p[i] += dx; p[i + 1] += dy } }
  switch (a.type) {
    case 'ink': a.paths.forEach(mv); break
    case 'rect': case 'ellipse': case 'text': mv(a.rect); break
    case 'arrow': case 'line': mv(a.pts); break
    case 'note': a.x += dx; a.y += dy; break
    default: mv(a.quads)
  }
}

// ---------- reading ----------

const N = (s: string) => PDFName.of(s)
const SUPPORTED = new Set(['/Ink', '/Square', '/Circle', '/Line', '/FreeText', '/Text', '/Highlight', '/Underline', '/StrikeOut'])

function nums(o: PDFObject | undefined, ctx: PDFDocument['context']): number[] | null {
  const a = o instanceof PDFRef ? ctx.lookup(o) : o
  if (!(a instanceof PDFArray)) return null
  const out: number[] = []
  for (let i = 0; i < a.size(); i++) { const v = ctx.lookup(a.get(i)); if (v instanceof PDFNumber) out.push(v.asNumber()); else return null }
  return out
}
function text(d: PDFDict, k: string): string {
  const v = d.lookup(N(k))
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : ''
}
function hexColor(c: number[] | null): string {
  if (!c || !c.length) return '#ffd400'
  let rgb = c
  if (c.length === 1) rgb = [c[0], c[0], c[0]]
  else if (c.length === 4) rgb = [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])]
  return '#' + rgb.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
}
function pdfDate(s: string): number {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s)
  if (!m) return Date.now()
  return new Date(+m[1], +(m[2] || 1) - 1, +(m[3] || 1), +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime()
}
const toPdfDate = (t: number) => {
  const d = new Date(t), p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export interface Extracted { base: Uint8Array; annots: Annot[]; editable: boolean }

/** Pull the review annotations out of a PDF so they can be edited; the rest of the file is left as it was. */
export async function extract(bytes: Uint8Array): Promise<Extracted> {
  let doc: PDFDocument
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }) } catch { return { base: bytes, annots: [], editable: false } }
  const ctx = doc.context
  const annots: Annot[] = []
  const byRef = new Map<string, Annot>()
  const replies: { parent: string; r: Reply; ref: PDFRef }[] = []
  const strip = new Set<string>()
  const pages = doc.getPages()
  pages.forEach((page, pi) => {
    const arr = page.node.Annots()
    if (!arr) return
    for (let j = 0; j < arr.size(); j++) {
      const ref = arr.get(j)
      const d = ctx.lookup(ref)
      if (!(d instanceof PDFDict) || !(ref instanceof PDFRef)) continue
      const sub = d.lookup(N('Subtype'))?.toString() || ''
      if (!SUPPORTED.has(sub)) continue
      const base: Base = {
        id: text(d, 'NM') || uid('a'), page: pi, author: text(d, 'T'), date: pdfDate(text(d, 'M') || text(d, 'CreationDate')),
        color: hexColor(nums(d.get(N('C')), ctx)), opacity: (d.lookup(N('CA')) as PDFNumber | undefined)?.asNumber?.() ?? 1, contents: text(d, 'Contents'), replies: []
      }
      const irt = d.get(N('IRT'))
      if (sub === '/Text' && irt instanceof PDFRef && (d.lookup(N('RT'))?.toString() ?? '/R') === '/R') {
        replies.push({ parent: irt.toString(), r: { id: base.id, author: base.author, date: base.date, text: base.contents }, ref })
        continue
      }
      const rect = nums(d.get(N('Rect')), ctx) || [0, 0, 0, 0]
      const bs = d.lookup(N('BS'))
      const w = (bs instanceof PDFDict ? (bs.lookup(N('W')) as PDFNumber | undefined)?.asNumber() : undefined) ?? 1
      let a: Annot | null = null
      if (sub === '/Ink') {
        const il = d.lookup(N('InkList'))
        const paths: number[][] = []
        if (il instanceof PDFArray) for (let k = 0; k < il.size(); k++) { const p = nums(il.get(k), ctx); if (p && p.length >= 2) paths.push(p) }
        if (paths.length) a = { ...base, type: 'ink', width: w, paths, marker: base.opacity < 0.8 && w >= 6 }
      } else if (sub === '/Square' || sub === '/Circle') {
        const rd = nums(d.get(N('RD')), ctx)
        const r = norm(rect), ins = rd || [w / 2, w / 2, w / 2, w / 2]
        a = { ...base, type: sub === '/Square' ? 'rect' : 'ellipse', width: w, rect: [r[0] + ins[0], r[1] + ins[3], r[2] - ins[2], r[3] - ins[1]] }
      } else if (sub === '/Line') {
        let pts = nums(d.get(N('L')), ctx) || rect
        const le = d.lookup(N('LE'))
        const ends = le instanceof PDFArray ? [0, 1].map(k => le.lookup(k)?.toString() || '/None') : ['/None', '/None']
        const isArrow = (s: string) => /Arrow/.test(s)
        if (isArrow(ends[0]) && !isArrow(ends[1])) pts = [pts[2], pts[3], pts[0], pts[1]]
        a = { ...base, type: ends.some(isArrow) ? 'arrow' : 'line', width: w, pts }
      } else if (sub === '/FreeText') {
        const da = text(d, 'DA')
        const size = +(/([\d.]+)\s+Tf/.exec(da)?.[1] || 12) || 12
        const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da)
        a = { ...base, type: 'text', rect: norm(rect), size, color: rg ? hexColor([+rg[1], +rg[2], +rg[3]]) : '#000000' }
      } else if (sub === '/Text') {
        a = { ...base, type: 'note', x: rect[0], y: rect[3] || rect[1] + NOTE }
      } else {
        const q = nums(d.get(N('QuadPoints')), ctx)
        if (q && q.length >= 8) {
          const quads: number[] = []
          for (let k = 0; k + 8 <= q.length; k += 8) {
            const xs = [q[k], q[k + 2], q[k + 4], q[k + 6]], ys = [q[k + 1], q[k + 3], q[k + 5], q[k + 7]]
            const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys)
            quads.push(x1, y2, x2, y2, x1, y1, x2, y1)
          }
          a = { ...base, type: sub === '/Highlight' ? 'highlight' : sub === '/Underline' ? 'underline' : 'strike', quads }
        }
      }
      if (!a) continue
      annots.push(a)
      byRef.set(ref.toString(), a)
      strip.add(ref.toString())
    }
  })
  for (const { parent, r, ref } of replies) {
    const p = byRef.get(parent)
    if (p) { p.replies.push(r); strip.add(ref.toString()) }
  }
  for (const a of annots) a.replies.sort((x, y) => x.date - y.date)
  if (!strip.size) return { base: bytes, annots, editable: true }
  // Remove what was taken out, plus pop-ups that belonged to it.
  for (const page of pages) {
    const arr = page.node.Annots()
    if (!arr) continue
    const keep: PDFObject[] = []
    for (let j = 0; j < arr.size(); j++) {
      const ref = arr.get(j)
      if (strip.has(ref.toString())) continue
      const d = ctx.lookup(ref)
      if (d instanceof PDFDict && d.lookup(N('Subtype'))?.toString() === '/Popup') {
        const par = d.get(N('Parent'))
        if (par && strip.has(par.toString())) continue
      }
      keep.push(ref)
    }
    if (keep.length === arr.size()) continue
    if (keep.length) page.node.set(N('Annots'), ctx.obj(keep as any))
    else page.node.delete(N('Annots'))
  }
  return { base: await doc.save(), annots, editable: true }
}

// ---------- writing ----------

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
const col = (hex: string, op: 'RG' | 'rg') => rgb(hex).map(f).join(' ') + ' ' + op

/** Wrap text to a width, for text boxes. */
export function wrapLines(t: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of t.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line && measure(next.trimEnd()) > width) { out.push(line.trimEnd()); line = word.trimStart() }
      else line = next
    }
    out.push(line.trimEnd())
  }
  return out
}

let fontBytes: Promise<ArrayBuffer> | null = null
const interBytes = () => (fontBytes ||= fetch('fonts/inter-400.ttf').then(r => r.arrayBuffer()))

/** Write the annotations into the PDF as standard annotations with appearances, so any viewer shows them. */
export async function build(base: Uint8Array, annots: Annot[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base, { updateMetadata: false })
  const ctx = doc.context
  const pages = doc.getPages()
  let font: PDFFont | null = null
  if (annots.some(a => a.type === 'text')) { doc.registerFontkit(fontkit); font = await doc.embedFont(await interBytes(), { subset: false }) } // subsetting garbles Inter
  const str = (s: string) => PDFHexString.fromText(s)

  const ap = (rect: number[], body: string, res: Record<string, any> = {}) => ctx.register(ctx.flateStream(body, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: res }))
  const gs = (op: number, multiply = false) => ({ ExtGState: { G0: { Type: 'ExtGState', CA: op, ca: op, ...(multiply ? { BM: 'Multiply' } : {}) } } })

  for (const a of annots) {
    const page = pages[a.page]
    if (!page) continue
    const rect = bounds(a).map(v => +f(v))
    const common: Record<string, any> = {
      Type: 'Annot', Rect: rect, P: page.ref, F: 4, C: rgb(a.color),
      M: PDFString.of(toPdfDate(a.date)), CreationDate: PDFString.of(toPdfDate(a.date)), NM: str(a.id), T: str(a.author || '')
    }
    if (a.contents && a.type !== 'text') common.Contents = str(a.contents)
    if (a.opacity < 1) common.CA = a.opacity
    let dict: Record<string, any>
    let body = ''
    let res: Record<string, any> = gs(a.opacity, a.type === 'highlight' || (a.type === 'ink' && !!a.marker))
    switch (a.type) {
      case 'ink':
        dict = { Subtype: 'Ink', InkList: a.paths.map(p => p.map(v => +f(v))), BS: { W: a.width } }
        body = `q /G0 gs ${col(a.color, 'RG')} ${f(a.width)} w 1 J 1 j ` + a.paths.map(p => {
          let s = `${f(p[0])} ${f(p[1])} m `
          if (p.length === 2) s += `${f(p[0] + 0.01)} ${f(p[1])} l `
          for (let i = 2; i < p.length; i += 2) s += `${f(p[i])} ${f(p[i + 1])} l `
          return s + 'S'
        }).join(' ') + ' Q'
        break
      case 'rect': case 'ellipse': {
        const r = norm(a.rect), w = a.width
        dict = { Subtype: a.type === 'rect' ? 'Square' : 'Circle', BS: { W: w }, RD: [w / 2, w / 2, w / 2, w / 2] }
        common.Rect = [r[0] - w / 2, r[1] - w / 2, r[2] + w / 2, r[3] + w / 2].map(v => +f(v))
        if (a.type === 'rect') body = `q /G0 gs ${col(a.color, 'RG')} ${f(w)} w ${f(r[0])} ${f(r[1])} ${f(r[2] - r[0])} ${f(r[3] - r[1])} re S Q`
        else {
          const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, rx = (r[2] - r[0]) / 2, ry = (r[3] - r[1]) / 2, k = 0.5523
          body = `q /G0 gs ${col(a.color, 'RG')} ${f(w)} w ${f(cx + rx)} ${f(cy)} m ` +
            `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c ` +
            `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c ` +
            `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c ` +
            `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c S Q`
        }
        res = gs(a.opacity)
        break
      }
      case 'arrow': case 'line': {
        const [x1, y1, x2, y2] = a.pts
        dict = { Subtype: 'Line', L: a.pts.map(v => +f(v)), BS: { W: a.width }, LE: ['None', a.type === 'arrow' ? 'OpenArrow' : 'None'] }
        body = `q /G0 gs ${col(a.color, 'RG')} ${f(a.width)} w 1 J 1 j ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`
        if (a.type === 'arrow') {
          const ang = Math.atan2(y2 - y1, x2 - x1), L = a.width * 4 + 6
          const p = (d: number) => `${f(x2 - L * Math.cos(ang + d))} ${f(y2 - L * Math.sin(ang + d))}`
          body += ` ${p(0.45)} m ${f(x2)} ${f(y2)} l ${p(-0.45)} l S`
        }
        body += ' Q'
        res = gs(a.opacity)
        break
      }
      case 'text': {
        const r = norm(a.rect), pad = 3, fnt = font!
        dict = { Subtype: 'FreeText', Contents: str(a.contents), DA: PDFString.of(`/F1 ${f(a.size)} Tf ${col(a.color, 'rg')}`) }
        const lines = wrapLines(a.contents, r[2] - r[0] - pad * 2, s => fnt.widthOfTextAtSize(s, a.size))
        const lh = a.size * 1.25
        body = `q /G0 gs BT /F1 ${f(a.size)} Tf ${col(a.color, 'rg')} ` + lines.map((l, i) =>
          `1 0 0 1 ${f(r[0] + pad)} ${f(r[3] - pad - a.size * 0.95 - i * lh)} Tm ${fnt.encodeText(l).toString()} Tj`).join(' ') + ' ET Q'
        res = { ...gs(a.opacity), Font: { F1: fnt.ref } }
        delete common.C
        break
      }
      case 'note': {
        const [x1, y1, x2, y2] = rect
        dict = { Subtype: 'Text', Name: 'Comment', Open: false }
        common.F = 28
        body = `q ${col(a.color, 'rg')} 0.25 0.25 0.25 RG 0.8 w ${f(x1 + 1)} ${f(y1 + 5)} ${f(x2 - x1 - 2)} ${f(y2 - y1 - 6)} re B ` +
          `${f(x1 + 5)} ${f(y1 + 5)} m ${f(x1 + 5)} ${f(y1 + 1)} l ${f(x1 + 9)} ${f(y1 + 5)} l f ` +
          `0.25 0.25 0.25 RG 1.2 w ${f(x1 + 5)} ${f(y2 - 6)} m ${f(x2 - 5)} ${f(y2 - 6)} l ${f(x1 + 5)} ${f(y2 - 10)} m ${f(x2 - 5)} ${f(y2 - 10)} l ${f(x1 + 5)} ${f(y2 - 14)} m ${f(x2 - 9)} ${f(y2 - 14)} l S Q`
        res = {}
        break
      }
      default: {
        const q = a.quads
        dict = { Subtype: a.type === 'highlight' ? 'Highlight' : a.type === 'underline' ? 'Underline' : 'StrikeOut', QuadPoints: q.map(v => +f(v)) }
        const parts: string[] = []
        for (let i = 0; i + 8 <= q.length; i += 8) {
          const x1 = q[i], y2 = q[i + 1], x2 = q[i + 2], y1 = q[i + 5], hgt = y2 - y1
          if (a.type === 'highlight') parts.push(`${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(hgt)} re f`)
          else {
            const y = a.type === 'underline' ? y1 + hgt * 0.08 : y1 + hgt * 0.4
            parts.push(`${f(Math.max(0.6, hgt * 0.07))} w ${f(x1)} ${f(y)} m ${f(x2)} ${f(y)} l S`)
          }
        }
        body = `q /G0 gs ${col(a.color, 'rg')} ${col(a.color, 'RG')} ` + parts.join(' ') + ' Q'
      }
    }
    const ref = ctx.register(ctx.obj({ ...common, ...dict, AP: { N: ap(common.Rect, body, res) } } as any))
    page.node.addAnnot(ref)
    for (const r of a.replies) {
      const rr = ctx.register(ctx.obj({
        Type: 'Annot', Subtype: 'Text', Rect: common.Rect, P: page.ref, F: 30, IRT: ref, RT: 'R', Name: 'Comment',
        NM: str(r.id), T: str(r.author || ''), Contents: str(r.text), M: PDFString.of(toPdfDate(r.date)), CreationDate: PDFString.of(toPdfDate(r.date))
      } as any))
      page.node.addAnnot(rr)
    }
  }
  return doc.save()
}

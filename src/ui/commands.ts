import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { getSettings, collectTargets, textOf, type Target } from '../layout/plugin'
import { defaultStyles, type PageSettings, type StyleSet, type CADocument } from '../model/types'
import { assets } from '../editor/registry'
import { store, openFile } from '../storage/store'
import { uid } from '../util'
import { toast } from './dialogs'

export function settingsOf(ed: Editor): PageSettings { return getSettings(ed.state.doc) }

export function stylesOf(ed: Editor): StyleSet {
  const d = defaultStyles()
  const s = ed.state.doc.attrs.styles || {}
  return { ...d, ...s, text: { ...d.text, ...(s.text || {}) } }
}

export function setSettings(ed: Editor, patch: Partial<PageSettings>) {
  const cur = settingsOf(ed)
  ed.view.dispatch(ed.state.tr.setDocAttribute('settings', { ...cur, ...patch }))
}

export function setStyles(ed: Editor, fn: (s: StyleSet) => void) {
  const s = structuredClone(stylesOf(ed))
  fn(s)
  ed.view.dispatch(ed.state.tr.setDocAttribute('styles', s))
}

export type BlockStyle = 'body' | 'title' | 'subtitle' | 'caption' | 'h1' | 'h2' | 'h3' | 'h4'

export function currentBlockStyle(ed: Editor): BlockStyle | '' {
  const { $from } = ed.state.selection
  const n = $from.parent
  if (n.type.name === 'heading') return ('h' + n.attrs.level) as BlockStyle
  if (n.type.name === 'paragraph') return n.attrs.kind || 'body'
  return ''
}

export function setBlockStyle(ed: Editor, s: BlockStyle) {
  const c = ed.chain().focus()
  if (s[0] === 'h') c.setNode('heading', { level: +s[1] }).run()
  else c.setNode('paragraph', { kind: s, label: s === 'caption' ? 'figure' : null }).run()
}

export function sectionAt(ed: Editor): { node: PMNode; pos: number; index: number } | null {
  const $f = ed.state.selection.$from
  if ($f.depth < 1) {
    const i = Math.min($f.index(0), ed.state.doc.childCount - 1)
    let pos = 0
    for (let k = 0; k < i; k++) pos += ed.state.doc.child(k).nodeSize
    return { node: ed.state.doc.child(i), pos, index: i }
  }
  return { node: $f.node(1), pos: $f.before(1), index: $f.index(0) }
}

export function insertSectionBreak(ed: Editor) {
  const { state } = ed
  const $f = state.selection.$from
  if ($f.depth < 2 || !$f.parent.isTextblock) { toast('Place the cursor in a paragraph to add a section break.'); return }
  const tr = state.tr
  if (!state.selection.empty) tr.deleteSelection()
  const pos = tr.selection.$from.pos
  const depth = tr.selection.$from.depth
  const types: any[] = []
  for (let d = depth; d >= 1; d--) types.unshift(d === 1 ? { type: state.schema.nodes.section, attrs: { landscape: null, restart: null } } : null)
  tr.split(pos, depth, types.map(t => t || undefined) as any)
  ed.view.dispatch(tr.scrollIntoView())
  ed.commands.focus()
}

export function removeSectionBreak(ed: Editor, index: number) {
  if (index < 1) return
  const doc = ed.state.doc
  let pos = 0
  for (let k = 0; k < index; k++) pos += doc.child(k).nodeSize
  ed.view.dispatch(ed.state.tr.join(pos))
}

export function setSectionAttr(ed: Editor, pos: number, attr: string, v: any) {
  ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, attr, v))
}

export function allTargets(ed: Editor): Target[] {
  return [...collectTargets(ed.state.doc).values()]
}

export interface HeadingRow { pos: number; level: number; text: string; id: string; sec: number }

export function headings(doc: PMNode): HeadingRow[] {
  const out: HeadingRow[] = []
  doc.forEach((sec, so, si) => {
    sec.descendants((n, p) => {
      if (n.type.name === 'heading') out.push({ pos: so + 1 + p, level: n.attrs.level, text: textOf(n), id: n.attrs.id, sec: si })
      return !n.isTextblock && n.type.name !== 'table'
    })
  })
  return out
}

export function headingRange(doc: PMNode, pos: number): { from: number; to: number } {
  const $p = doc.resolve(pos)
  const sec = $p.node(1)
  const secStart = $p.start(1)
  const lvl = doc.nodeAt(pos)!.attrs.level
  let to = $p.end(1)
  let found = false
  sec.forEach((c, off) => {
    const p = secStart + off
    if (p <= pos || found) return
    if (c.type.name === 'heading' && c.attrs.level <= lvl) { to = p; found = true }
  })
  return { from: pos, to }
}

export function moveHeading(ed: Editor, pos: number, target: number | 'end') {
  const doc = ed.state.doc
  const r = headingRange(doc, pos)
  if (target !== 'end' && target >= r.from && target < r.to) return
  const $p = doc.resolve(pos)
  if ($p.depth !== 1) { toast('Only top-level headings can be moved from the outline.'); return }
  if (r.from === $p.start(1) && r.to === $p.end(1)) { toast('This heading fills its whole section, so it cannot be moved.'); return }
  const slice = doc.slice(r.from, r.to)
  const tr = ed.state.tr.delete(r.from, r.to)
  const ins = target === 'end' ? tr.doc.resolve(tr.doc.content.size - 1).end(1) : tr.mapping.map(target, -1)
  tr.insert(ins, slice.content)
  ed.view.dispatch(tr.scrollIntoView())
}

export function shiftHeading(ed: Editor, pos: number, d: number) {
  const doc = ed.state.doc
  const r = headingRange(doc, pos)
  const tr = ed.state.tr
  doc.nodesBetween(r.from, r.to, (n, p) => {
    if (n.type.name === 'heading') tr.setNodeAttribute(p, 'level', Math.max(1, Math.min(4, n.attrs.level + d)))
    return n.type.name !== 'heading'
  })
  ed.view.dispatch(tr)
}

export function deleteHeadingRange(ed: Editor, pos: number) {
  const doc = ed.state.doc
  const r = headingRange(doc, pos)
  const $p = doc.resolve(pos)
  const tr = ed.state.tr
  if (r.from === $p.start(1) && r.to === $p.end(1)) tr.replaceWith(r.from, r.to, ed.schema.nodes.paragraph.create())
  else tr.delete(r.from, r.to)
  ed.view.dispatch(tr)
}

export function renameHeading(ed: Editor, pos: number, text: string) {
  const n = ed.state.doc.nodeAt(pos)
  if (!n) return
  const tr = ed.state.tr.replaceWith(pos + 1, pos + n.nodeSize - 1, text ? ed.schema.text(text) : [])
  ed.view.dispatch(tr)
}

export async function addImageAsset(doc: CADocument, blob: Blob, name: string): Promise<{ id: string; w: number; h: number }> {
  let w = 800, h = 600
  try {
    const bmp = await createImageBitmap(blob)
    w = bmp.width; h = bmp.height
    bmp.close()
  } catch {
    if (blob.type === 'image/svg+xml') {
      const u = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise(r => { img.onload = img.onerror = r; img.src = u })
      w = img.naturalWidth || 800; h = img.naturalHeight || 600
      URL.revokeObjectURL(u)
    } else throw new Error('This image could not be read.')
  }
  const id = uid('a')
  await store.putAsset(doc.meta.id, id, blob)
  assets.set(id, blob)
  const info = { mime: blob.type || 'image/png', name, w, h }
  assets.setInfo(id, info)
  doc.assets[id] = info
  return { id, w, h }
}

export async function insertImage(ed: Editor, doc: CADocument) {
  const f = await openFile(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  if (!f) return
  const ext = f.name.split('.').pop()!.toLowerCase()
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext
  try {
    const a = await addImageAsset(doc, new Blob([f.data as BlobPart], { type: mime }), f.name)
    ed.chain().focus().insertContent([
      { type: 'image', attrs: { src: 'asset:' + a.id, w: a.w, h: a.h, width: 100, align: 'center', alt: f.name.replace(/\.[^.]+$/, '') } },
      { type: 'paragraph', attrs: { kind: 'caption', label: 'figure' } }
    ]).run()
  } catch (e: any) { toast(e.message || 'This image could not be added.') }
}

export async function replaceImage(ed: Editor, doc: CADocument, pos: number) {
  const f = await openFile(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  if (!f) return
  const ext = f.name.split('.').pop()!.toLowerCase()
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext
  try {
    const a = await addImageAsset(doc, new Blob([f.data as BlobPart], { type: mime }), f.name)
    const n = ed.state.doc.nodeAt(pos)!
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: 'asset:' + a.id, w: a.w, h: a.h }))
  } catch (e: any) { toast(e.message || 'This image could not be added.') }
}

export function selectedNode(ed: Editor): { node: PMNode; pos: number } | null {
  const s = ed.state.selection
  return s instanceof NodeSelection ? { node: s.node, pos: s.from } : null
}

export function findParent(ed: Editor, name: string): { node: PMNode; pos: number } | null {
  const $f = ed.state.selection.$from
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === name) return { node: $f.node(d), pos: $f.before(d) }
  return null
}

export function countHints(doc: PMNode) {
  let n = 0
  doc.descendants(c => { if (c.isText && c.marks.some(m => m.type.name === 'hint')) n++ })
  return n
}

export function clearHints(ed: Editor) {
  const tr = ed.state.tr
  const ranges: [number, number][] = []
  ed.state.doc.descendants((c, p) => { if (c.isText && c.marks.some(m => m.type.name === 'hint')) ranges.push([p, p + c.nodeSize]) })
  for (let i = ranges.length - 1; i >= 0; i--) tr.delete(ranges[i][0], ranges[i][1])
  ed.view.dispatch(tr)
}

export function brokenRefs(ed: Editor) {
  const t = collectTargets(ed.state.doc)
  let n = 0
  ed.state.doc.descendants(c => {
    if (c.type.name === 'xref' && !t.has(c.attrs.target)) n++
    if (c.isText) for (const m of c.marks) if (m.type.name === 'link' && m.attrs.href?.startsWith('#') && !m.attrs.href.startsWith('#page=') && !t.has(m.attrs.href.slice(1))) n++
  })
  return n
}

export function docStats(doc: PMNode) {
  let words = 0, chars = 0, figs = 0, tables = 0, links = 0, notes = 0
  doc.descendants(c => {
    if (c.isText) {
      words += (c.text!.match(/\S+/g) || []).length
      chars += c.text!.length
      if (c.marks.some(m => m.type.name === 'link')) links++
    }
    if (c.type.name === 'image') figs++
    if (c.type.name === 'table') tables++
    if (c.type.name === 'footnote') notes++
  })
  return { words, chars, figs, tables, links, notes }
}

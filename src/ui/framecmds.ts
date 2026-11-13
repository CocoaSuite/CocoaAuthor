import type { Editor } from '@tiptap/core'
import type { DocView } from '../editor/docview'
import type { CADocument, FrameData } from '../model/types'
import { openFile } from '../storage/store'
import { addImageAsset, settingsOf } from './commands'
import { toast } from './dialogs'

/** Nudge a new frame off any frame already sitting at the same spot. */
const free = (dv: DocView, page: number, x: number, y: number) => {
  const list = dv.objects.frames()
  while (list.some(f => f.page === page && Math.abs(f.x - x) < 4 && Math.abs(f.y - y) < 4)) { x += 14; y += 14 }
  return { x, y }
}

const pageInfo = (dv: DocView) => {
  const L = dv.layout
  const i = Math.min(dv.currentPage(), (L?.pages.length || 1) - 1)
  const p = L?.pages[i]
  return { i, p }
}

export async function insertFloatingImage(ed: Editor, doc: CADocument, dv: DocView) {
  const f = await openFile(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  if (!f) return
  const ext = f.name.split('.').pop()!.toLowerCase()
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext
  try {
    const a = await addImageAsset(doc, new Blob([f.data as BlobPart], { type: mime }), f.name)
    const { i, p } = pageInfo(dv)
    const s = settingsOf(ed)
    const pw = p?.w || s.width, m = p?.m || s.margin
    const colW = pw - m.left - m.right
    const w = Math.min(colW / 2, a.w * 0.75)
    const h = w * a.h / a.w
    const at = free(dv, i, m.left, m.top + 24)
    dv.objects.add({ kind: 'image', page: i, x: at.x, y: at.y, w, h, wrap: 'around', gap: 8, src: 'asset:' + a.id, iw: a.w, ih: a.h, alt: f.name.replace(/\.[^.]+$/, '') })
  } catch (e: any) { toast(e.message || 'This image could not be added.') }
}

export function insertTextBox(ed: Editor, dv: DocView) {
  const { i, p } = pageInfo(dv)
  const s = settingsOf(ed)
  const pw = p?.w || s.width, m = p?.m || s.margin
  const colW = pw - m.left - m.right
  const at = free(dv, i, m.left + colW / 2 + 6, m.top + 24)
  dv.objects.add({ kind: 'text', page: i, x: at.x, y: at.y, w: colW / 2 - 6, h: 110, wrap: 'around', gap: 8, pad: 0, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text box' }] }] } })
}

/** Take an image out of the text and put it on its page at the same place. */
export function floatImage(ed: Editor, dv: DocView, pos: number) {
  const n = ed.state.doc.nodeAt(pos)
  const L = dv.layout
  if (!n || n.type.name !== 'image' || !L) return
  const dom = ed.view.nodeDOM(pos) as HTMLElement | null
  const box = (dom?.querySelector('.ca-imgb') || dom) as HTMLElement | null
  if (!box) return
  const rr = dv.root.getBoundingClientRect(), r = box.getBoundingClientRect(), sc = dv.scale
  const x = (r.left - rr.left) / sc, y = (r.top - rr.top) / sc, w = r.width / sc, h = r.height / sc
  let p = L.pages[0]
  for (const q of L.pages) if (q.top <= y) p = q
  const a = n.attrs
  const fr: FrameData = { id: '', kind: 'image', page: p.i, x: x - p.left, y: y - p.top, w, h, wrap: 'around', gap: 8, src: a.src, iw: a.w, ih: a.h, fit: a.fit, cx: a.cx, cy: a.cy, zoom: a.zoom, cropRect: a.cropRect, alt: a.alt }
  const list = dv.objects.frames()
  const id = 'f' + Math.random().toString(36).slice(2, 9)
  ed.view.dispatch(ed.state.tr.delete(pos, pos + n.nodeSize).setDocAttribute('frames', [...list, { ...fr, id }]))
  setTimeout(() => dv.objects.select(id), 400)
}

/** Put a floating image back into the text where its top edge is. */
export function unfloatImage(ed: Editor, dv: DocView, id: string) {
  const f = dv.objects.get(id)
  const L = dv.layout
  if (!f || f.kind !== 'image' || !L) return
  const p = L.pages[f.page]
  const rr = dv.root.getBoundingClientRect(), sc = dv.scale
  const hit = ed.view.posAtCoords({ left: rr.left + (p.left + p.m.left + 4) * sc, top: rr.top + (p.top + f.y) * sc })
  let at = ed.state.doc.content.size - 1
  if (hit) {
    const $p = ed.state.doc.resolve(hit.pos)
    at = $p.depth >= 1 ? $p.before(Math.max(2, Math.min($p.depth, 2))) : hit.pos
  }
  const colW = p.w - p.m.left - p.m.right
  const node = ed.schema.nodes.image.create({ src: f.src, w: f.iw, h: f.ih, width: Math.max(10, Math.min(100, Math.round(f.w / colW * 100))), align: 'center', alt: f.alt || '', fit: f.fit ?? null, cx: f.cx ?? null, cy: f.cy ?? null, zoom: f.zoom ?? null, cropRect: f.cropRect ?? null })
  try {
    ed.view.dispatch(ed.state.tr.insert(at, node).setDocAttribute('frames', dv.objects.frames().filter(x => x.id !== id)))
    dv.objects.select(null)
  } catch { toast('The image could not be put back into the text here.') }
}

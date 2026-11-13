import type { Editor } from '@tiptap/core'
import { h } from '../util'
import { modal } from './dialogs'
import { assets } from '../editor/registry'
import { frameRatio, placeImage, type CropRect } from '../editor/imagegeom'

const RATIOS: [string, string][] = [['', 'Free'], ['orig', 'Original'], ['1:1', 'Square'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['3:4', '3:4'], ['2:3', '2:3']]

/** Free crop: drag the frame or its handles over the full image. */
export function cropDialog(ed: Editor, pos: number) {
  const n = ed.state.doc.nodeAt(pos)
  if (!n || n.type.name !== 'image') return
  const a = n.attrs as any
  const nw = a.w || 800, nh = a.h || 600
  const src = String(a.src).startsWith('asset:') ? assets.url(String(a.src).slice(6)) : a.src

  // Start from what the frame shows now.
  const fr = frameRatio(a, nw, nh)
  const g = placeImage(a, nw, nh, 1, fr)
  const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
  let r: CropRect = a.cropRect ? { ...a.cropRect } : { x: clamp(-g.dx / g.dw), y: clamp(-g.dy / g.dh), w: clamp(1 / g.dw), h: clamp(fr / g.dh) }
  r.w = Math.min(r.w, 1 - r.x); r.h = Math.min(r.h, 1 - r.y)

  const MAXW = Math.min(720, innerWidth - 120), MAXH = Math.min(440, innerHeight - 260)
  const k = Math.min(MAXW / nw, MAXH / nh)
  const W = Math.round(nw * k), H = Math.round(nh * k)
  const stage = h('div', { class: 'crop-stage', style: { width: W + 'px', height: H + 'px' } })
  stage.append(h('img', { src, draggable: 'false', alt: '' }))
  const box = h('div', { class: 'crop-box' })
  for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) box.append(h('i', { 'data-h': d }))
  stage.append(box)
  const info = h('span', { class: 'mute' })
  let lock: number | null = null // h/w in image fractions
  const ratioSel = h('select', { onchange: () => setLock(ratioSel.value) }) as HTMLSelectElement
  for (const [v, l] of RATIOS) ratioSel.append(h('option', { value: v }, l))

  const draw = () => {
    box.style.left = r.x * W + 'px'; box.style.top = r.y * H + 'px'
    box.style.width = r.w * W + 'px'; box.style.height = r.h * H + 'px'
    info.textContent = `${Math.round(r.w * nw)} × ${Math.round(r.h * nh)} px`
  }

  function setLock(v: string) {
    if (!v) { lock = null; return }
    const ar = v === 'orig' ? nh / nw : (() => { const [x, y] = v.split(':').map(Number); return y / x })()
    lock = ar * nw / nh // convert pixel ratio to fraction ratio
    // Fit the locked shape inside the current box, centred.
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2
    let w = r.w, hh = w * lock
    if (hh > r.h) { hh = r.h; w = hh / lock }
    if (w > 1) { w = 1; hh = w * lock }
    if (hh > 1) { hh = 1; w = hh / lock }
    r = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - hh / 2, 0, 1 - hh), w, h: hh }
    draw()
  }

  stage.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement
    const mode = t.dataset.h || (t === box ? 'move' : null)
    if (!mode) return
    e.preventDefault()
    stage.setPointerCapture(e.pointerId)
    const sx = e.clientX, sy = e.clientY, r0 = { ...r }
    const min = 12 / W
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H
      if (mode === 'move') { r = { ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) }; draw(); return }
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h
      if (mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - min)
      if (mode.includes('e')) x1 = clamp(x1 + dx, x0 + min, 1)
      if (mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - min)
      if (mode.includes('s')) y1 = clamp(y1 + dy, y0 + min, 1)
      if (lock) {
        let w = x1 - x0, hh = y1 - y0
        if (mode === 'n' || mode === 's') w = hh / lock
        else if (mode === 'e' || mode === 'w') hh = w * lock
        else if (hh / w > lock) w = hh / lock; else hh = w * lock
        if (mode.includes('w')) x0 = x1 - w; else x1 = x0 + w
        if (mode.includes('n')) y0 = y1 - hh; else y1 = y0 + hh
        if (mode === 'n' || mode === 's') { const c = (r0.x * 2 + r0.w) / 2; x0 = c - w / 2; x1 = c + w / 2 }
        if (mode === 'e' || mode === 'w') { const c = (r0.y * 2 + r0.h) / 2; y0 = c - hh / 2; y1 = c + hh / 2 }
        if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1) return
      }
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      draw()
    }
    const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up) }
    stage.addEventListener('pointermove', move)
    stage.addEventListener('pointerup', up)
  })

  const apply = (rect: CropRect | null) => {
    const cur = ed.state.doc.nodeAt(pos)
    if (!cur || cur.type.name !== 'image') return
    const full = rect && rect.x < 0.001 && rect.y < 0.001 && rect.w > 0.999 && rect.h > 0.999
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, cropRect: full ? null : rect, crop: null, zoom: null, cx: null, cy: null, fit: full || !rect ? cur.attrs.fit : null }))
    m.close()
  }

  const m = modal('Crop image', [
    h('div', { class: 'crop-wrap' }, stage),
    h('div', { class: 'row crop-bar' }, h('label', { class: 'f inl' }, 'Shape', ratioSel), info, h('span', { class: 'sp' }),
      h('button', { onclick: () => apply(null) }, 'Remove crop'),
      h('button', { onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'pri', onclick: () => apply({ ...r }) }, 'Apply'))
  ], { wide: true, onKey: e => { if (e.key === 'Enter') { e.preventDefault(); apply({ ...r }) } } })
  m.box.style.maxWidth = W + 60 + 'px'
  m.box.style.width = 'auto'
  draw()
}

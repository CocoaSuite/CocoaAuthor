// One place that decides how an image sits in its frame, used by the editor, PDF and Word export.

export type Fit = 'fill' | 'fit' | 'stretch'
export interface CropRect { x: number; y: number; w: number; h: number }
export interface ImgAttrs { w: number; h: number; crop?: string | null; fit?: Fit | null; cx?: number | null; cy?: number | null; zoom?: number | null; cropRect?: CropRect | null }

export const CROP_PRESETS: [string, string][] = [['', 'Original'], ['1:1', 'Square'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['3:4', 'Portrait 3:4'], ['2:3', 'Portrait 2:3']]

const validRect = (r: any): r is CropRect => r && r.w > 0.001 && r.h > 0.001

/** Frame height divided by width. */
export function frameRatio(a: ImgAttrs, nw = a.w, nh = a.h): number {
  if (validRect(a.cropRect)) return (a.cropRect.h * nh) / (a.cropRect.w * nw)
  if (a.crop && a.crop.includes(':')) { const [x, y] = a.crop.split(':').map(Number); if (x > 0 && y > 0) return y / x }
  return nh / nw
}

/** Where the whole image is drawn, relative to a frame of fw × fh. Anything outside the frame is clipped. */
export function placeImage(a: ImgAttrs, nw: number, nh: number, fw: number, fh: number) {
  if (validRect(a.cropRect)) {
    const r = a.cropRect
    const sx = fw / (r.w * nw), sy = fh / (r.h * nh)
    return { dx: -r.x * nw * sx, dy: -r.y * nh * sy, dw: nw * sx, dh: nh * sy }
  }
  const fit = a.fit || 'fill'
  if (fit === 'stretch') return { dx: 0, dy: 0, dw: fw, dh: fh }
  const cx = a.cx ?? 0.5, cy = a.cy ?? 0.5
  if (fit === 'fit') {
    const k = Math.min(fw / nw, fh / nh)
    const dw = nw * k, dh = nh * k
    return { dx: (fw - dw) * cx, dy: (fh - dh) * cy, dw, dh }
  }
  const k = Math.max(fw / nw, fh / nh) * Math.max(1, a.zoom || 1)
  const dw = nw * k, dh = nh * k
  return { dx: -(dw - fw) * cx, dy: -(dh - fh) * cy, dw, dh }
}

/** True when the frame shows the image exactly as it is (no crop, no bars, no distortion). */
export function isPlain(a: ImgAttrs): boolean {
  return !validRect(a.cropRect) && !a.crop && (a.zoom || 1) === 1
}

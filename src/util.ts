import type { NumberFormat } from './model/types'

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)

export const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const k in attrs) {
    const v = attrs[k]
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k in el && typeof v !== 'string') (el as any)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of kids) if (c != null && c !== false) el.append(c as any)
  return el
}

export function roman(n: number): string {
  if (n <= 0) return String(n)
  const m: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let r = ''
  for (const [v, s] of m) while (n >= v) { r += s; n -= v }
  return r
}

export function alpha(n: number): string {
  let s = ''
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) }
  return s
}

export function fmtNum(n: number, f: NumberFormat): string {
  switch (f) {
    case 'lower-roman': return roman(n)
    case 'upper-roman': return roman(n).toUpperCase()
    case 'lower-alpha': return alpha(n)
    case 'upper-alpha': return alpha(n).toUpperCase()
    default: return String(n)
  }
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any
  const d = (...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
  d.flush = () => { clearTimeout(t); fn() }
  d.cancel = () => clearTimeout(t)
  return d as T & { flush(): void; cancel(): void }
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function relTime(t: number): string {
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'Just now'
  if (d < 3600) return Math.floor(d / 60) + ' min ago'
  if (d < 86400) return Math.floor(d / 3600) + ' h ago'
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' d ago'
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const ptToUnit = (pt: number, u: 'mm' | 'in') => u === 'mm' ? +(pt / 72 * 25.4).toFixed(1) : +(pt / 72).toFixed(2)
export const unitToPt = (v: number, u: 'mm' | 'in') => u === 'mm' ? v / 25.4 * 72 : v * 72

export function slugText(s: string, n = 40) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

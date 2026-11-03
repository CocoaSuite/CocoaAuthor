import { FONTS, FONT_METRICS, fontKey } from '../model/types'

const WEIGHTS = [400, 500, 600, 700]
let injected = false
const cache = new Map<string, Promise<Uint8Array>>()

export const fontFile = (key: string, weight: number, italic: boolean) => {
  const w = WEIGHTS.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), 400)
  return `${key}-${w}${italic ? 'i' : ''}.ttf`
}

export const fontURL = (file: string) => new URL('fonts/' + file, document.baseURI).href

export function injectFonts() {
  if (injected) return
  injected = true
  let css = ''
  for (const f of FONTS) {
    const m = FONT_METRICS[f.key]
    for (const w of WEIGHTS) for (const it of [false, true]) {
      css += `@font-face{font-family:"${f.name}";src:url("${fontURL(fontFile(f.key, w, it))}") format("truetype");font-weight:${w};font-style:${it ? 'italic' : 'normal'};font-display:block;ascent-override:${(m.asc * 100).toFixed(3)}%;descent-override:${(m.desc * 100).toFixed(3)}%;line-gap-override:0%}\n`
    }
  }
  const s = document.createElement('style')
  s.id = 'ca-fonts'
  s.textContent = css
  document.head.append(s)
}

export function fontBytes(file: string): Promise<Uint8Array> {
  let p = cache.get(file)
  if (!p) {
    p = fetch(fontURL(file)).then(r => {
      if (!r.ok) throw new Error('Font missing: ' + file)
      return r.arrayBuffer()
    }).then(b => new Uint8Array(b))
    cache.set(file, p)
    p.catch(() => cache.delete(file))
  }
  return p
}

export async function loadUsedFonts(root: HTMLElement) {
  const used = new Set<string>()
  const els = root.querySelectorAll<HTMLElement>('*')
  const seen = new Set<string>()
  for (const el of els) {
    const cs = getComputedStyle(el)
    const k = cs.fontFamily + '|' + cs.fontWeight + '|' + cs.fontStyle
    if (seen.has(k)) continue
    seen.add(k)
    const fam = FONTS.find(f => f.key === fontKey(cs.fontFamily))!.name
    used.add(`${cs.fontStyle === 'italic' ? 'italic ' : ''}${cs.fontWeight} 16px "${fam}"`)
  }
  await Promise.all([...used].map(u => document.fonts.load(u).catch(() => null)))
  await document.fonts.ready
}

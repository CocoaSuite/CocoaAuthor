import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { extensions } from '../editor/extensions'
import { docCSS } from '../layout/docstyle'
import { buildSpec, type Template } from '../templates'
import { themeStyles } from '../model/themes'
import { store } from '../storage/store'
import type { StyleSet } from '../model/types'
import { h } from '../util'

let schema: any = null
const done = new Set<string>()
let sheet: HTMLStyleElement | null = null
const ro = new ResizeObserver(es => { for (const e of es) { const v = e.target.firstElementChild as HTMLElement | null; if (v) v.style.zoom = String(e.contentRect.width / 595) } })

function scopeCSS(key: string, st: StyleSet) {
  if (done.has(key)) return
  done.add(key)
  if (!sheet) { sheet = document.createElement('style'); sheet.id = 'ca-thumbs'; document.head.append(sheet) }
  sheet.textContent += docCSS(st, '.ca-flow.tp-' + key)
}

function pick(blocks: any[]): any[] {
  const toc = blocks.findIndex((b, i) => i < 10 && b.type === 'toc')
  if (toc < 0) return blocks.filter(b => b.type !== 'pageBreak' && b.type !== 'toc').slice(0, 16)
  const head = blocks.slice(0, toc).filter(b => b.type === 'paragraph' && (b.attrs?.kind === 'title' || b.attrs?.kind === 'subtitle'))
  let rest = blocks.slice(toc + 1)
  const pb = rest.findIndex(b => b.type === 'pageBreak')
  if (pb >= 0 && pb < 3) rest = rest.slice(pb + 1)
  return [...head, ...rest.filter(b => b.type !== 'pageBreak' && b.type !== 'toc')].slice(0, 16)
}

function render(key: string, blocks: any[], st: StyleSet): HTMLElement {
  schema ||= getSchema(extensions())
  scopeCSS(key, st)
  const wrap = h('div', { class: 'tpw', 'aria-hidden': 'true' })
  const pm = h('div', { class: 'ProseMirror' })
  try {
    const node = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'section', content: blocks.length ? blocks : [{ type: 'paragraph' }] }] })
    pm.append(DOMSerializer.fromSchema(schema).serializeFragment(node.content))
  } catch {}
  wrap.append(h('div', { class: 'tpv ca-flow tp-' + key }, pm))
  ro.observe(wrap)
  return wrap
}

export function thumbFor(t: Template): HTMLElement {
  return render('t' + t.id.replace(/\W/g, ''), pick(buildSpec(t.name, t.spec)), themeStyles(t.category))
}

export function thumbForDoc(id: string, slot: HTMLElement) {
  store.load(id).then(d => {
    if (!d) return
    const st = d.content.attrs?.styles as StyleSet
    const key = 'd' + id.replace(/\W/g, '') + (d.meta.modified % 1e6)
    const t = render(key, pick(d.content.content?.[0]?.content || []), st)
    slot.replaceChildren(t)
  }).catch(() => {})
}

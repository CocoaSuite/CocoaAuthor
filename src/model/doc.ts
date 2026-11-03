import { defaultSettings, defaultStyles, type CADocument, type DocSummary, type PageSettings, type StyleSet } from './types'
import { uid } from '../util'

export function newDoc(title = 'Untitled document', content?: any, opts: { template?: string; settings?: Partial<PageSettings>; styles?: Partial<StyleSet> } = {}): CADocument {
  const now = Date.now()
  const settings = { ...defaultSettings(), ...(opts.settings || {}) }
  const styles = { ...defaultStyles(), ...(opts.styles || {}) }
  return {
    format: 'cocoaauthor',
    version: 1,
    meta: { id: uid('d'), title, subtitle: '', author: '', subject: '', keywords: '', status: 'draft', archived: false, template: opts.template || '', created: now, modified: now },
    content: content
      ? { type: 'doc', attrs: { settings, styles }, content: content.content || content }
      : { type: 'doc', attrs: { settings, styles }, content: [{ type: 'section', content: [{ type: 'paragraph', attrs: { kind: 'title' }, content: [{ type: 'text', text: title }] }, { type: 'paragraph' }] }] },
    assets: {}
  }
}

export function plainText(node: any, out: string[] = []): string[] {
  if (!node) return out
  if (node.type === 'text') out.push(node.text)
  if (Array.isArray(node.content)) {
    for (const c of node.content) plainText(c, out)
    if (node.type === 'paragraph' || node.type === 'heading') out.push('\n')
  }
  return out
}

export function summarize(d: CADocument): DocSummary {
  const text = plainText(d.content).join('')
  const words = (text.match(/\S+/g) || []).length
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean)
  const snippet = lines.filter(l => l !== d.meta.title).slice(0, 3).join(' ').slice(0, 220)
  const m = d.meta
  return { id: m.id, title: m.title, status: m.status, archived: m.archived, template: m.template, created: m.created, modified: m.modified, words, snippet }
}

export function assetIds(node: any, out = new Set<string>()): Set<string> {
  if (!node) return out
  if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src.startsWith('asset:')) out.add(node.attrs.src.slice(6))
  if (Array.isArray(node.content)) for (const c of node.content) assetIds(c, out)
  return out
}

export function normalize(d: any): CADocument {
  const base = newDoc()
  const doc: CADocument = { ...base, ...d, meta: { ...base.meta, ...(d.meta || {}) }, assets: d.assets || {} }
  const c = doc.content || base.content
  c.attrs = { settings: { ...defaultSettings(), ...(c.attrs?.settings || {}) }, styles: { ...defaultStyles(), ...(c.attrs?.styles || {}), text: { ...defaultStyles().text, ...(c.attrs?.styles?.text || {}) } } }
  if (!Array.isArray(c.content) || !c.content.length) c.content = base.content.content
  doc.content = c
  return doc
}

import { pr } from './pr'
import { content } from './content'
import { advertising } from './advertising'
import { marketing } from './marketing'

export interface Template {
  id: string
  category: string
  name: string
  description: string
  spec: string
}

export const TEMPLATES: Template[] = [...pr, ...content, ...advertising, ...marketing]
export const CATEGORIES = [...new Set(TEMPLATES.map(t => t.category))]

const txt = (t: string, hint = false) => (t ? [{ type: 'text', text: t, ...(hint ? { marks: [{ type: 'hint' }] } : {}) }] : [])
const para = (t: string, hint = false, kind = 'body') => ({ type: 'paragraph', attrs: { kind }, content: txt(t, hint) })
const inline = (s: string) => (s.startsWith('?') ? txt(s.slice(1).trim(), true) : txt(s))

export function buildSpec(title: string, spec: string): any[] {
  const out: any[] = []
  let list: any = null
  let table: any = null
  const flush = () => { if (list) out.push(list); if (table) out.push(table); list = null; table = null }
  for (const raw of spec.split('\n')) {
    const l = raw.trim()
    if (!l) { flush(); continue }
    if (l.startsWith('- ') || l.startsWith('1. ')) {
      const ordered = l.startsWith('1. ')
      if (table) flush()
      if (list && (list.type === 'orderedList') !== ordered) flush()
      list ||= { type: ordered ? 'orderedList' : 'bulletList', content: [] }
      list.content.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(l.slice(ordered ? 3 : 2)) }] })
      continue
    }
    if (l.startsWith('|')) {
      if (list) flush()
      const cells = l.slice(1).split('|').map(c => c.trim())
      if (cells[cells.length - 1] === '') cells.pop()
      const head = !table
      table ||= { type: 'table', content: [] }
      table.content.push({ type: 'tableRow', content: cells.map(c => ({ type: head ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: inline(c) }] })) })
      continue
    }
    flush()
    if (l === 'toc') out.push({ type: 'toc', attrs: { title: 'Contents', levels: 2 } })
    else if (l === 'pb') out.push({ type: 'pageBreak' })
    else if (l === 'hr') out.push({ type: 'horizontalRule' })
    else if (l.startsWith('### ')) out.push({ type: 'heading', attrs: { level: 3 }, content: txt(l.slice(4)) })
    else if (l.startsWith('## ')) out.push({ type: 'heading', attrs: { level: 2 }, content: txt(l.slice(3)) })
    else if (l.startsWith('# ')) out.push({ type: 'heading', attrs: { level: 1 }, content: txt(l.slice(2)) })
    else if (l.startsWith('>! ')) out.push({ type: 'callout', attrs: { tone: 'key' }, content: [para(l.slice(3).replace(/^\?\s*/, ''), l.slice(3).startsWith('?'))] })
    else if (l.startsWith('> ')) out.push({ type: 'callout', attrs: { tone: 'note' }, content: [para(l.slice(2).replace(/^\?\s*/, ''), l.slice(2).startsWith('?'))] })
    else if (l.startsWith('" ')) out.push({ type: 'blockquote', content: [para(l.slice(2).replace(/^\?\s*/, ''), l.slice(2).startsWith('?'))] })
    else if (l.startsWith('cap:table ')) out.push({ type: 'paragraph', attrs: { kind: 'caption', label: 'table' }, content: txt(l.slice(10)) })
    else if (l.startsWith('~ ')) { const v = l.slice(2); out.push(para(v.replace(/^\?\s*/, ''), v.startsWith('?'), 'subtitle')) }
    else if (l.startsWith('? ')) out.push(para(l.slice(2), true))
    else out.push({ type: 'paragraph', content: inline(l) })
  }
  flush()
  return [
    { type: 'paragraph', attrs: { kind: 'title' }, content: txt(title) },
    ...out
  ]
}

export function templateContent(t: Template) {
  return { content: [{ type: 'section', content: buildSpec(t.name, t.spec) }] }
}

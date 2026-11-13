import { generateJSON } from '@tiptap/core'
import { unzipSync } from 'fflate'
import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import { extensions } from '../editor/extensions'
import { newDoc } from '../model/doc'
import { addImageAsset } from '../ui/commands'
import { store } from '../storage/store'
import { esc, uid } from '../util'
import type { CADocument } from '../model/types'

export type FileMap = Map<string, Uint8Array>

export const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i
const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }

const norm = (p: string) => {
  const out: string[] = []
  for (const s of p.replace(/\\/g, '/').split('/')) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return out.join('/')
}
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')

/** Import a Markdown file, a .zip holding one, or a Markdown file with its images picked alongside it. */
export async function importMarkdownBundle(name: string, data: Uint8Array, extra: FileMap = new Map()): Promise<CADocument> {
  let mdName = name
  let text: string
  const files: FileMap = new Map()
  if (/\.zip$/i.test(name)) {
    const z = unzipSync(data)
    const paths = Object.keys(z).filter(p => !p.startsWith('__MACOSX/') && !p.endsWith('/'))
    const mds = paths.filter(p => MD_RE.test(p) && !/\.txt$/i.test(p))
    if (!mds.length) throw new Error('This archive has no Markdown file in it.')
    mds.sort((a, b) => a.split('/').length - b.split('/').length || score(a) - score(b))
    mdName = mds[0]
    for (const p of paths) files.set(norm(p), z[p])
    text = decode(z[mdName])
  } else {
    text = decode(data)
    for (const [k, v] of extra) files.set(norm(k), v)
  }
  return importMarkdown(text, mdName, files)
}

const score = (p: string) => (/^(readme|index)\./i.test(base(p)) ? 0 : 1)
const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '')

function frontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src)
  if (!m) return { meta: {}, body: src }
  const meta: Record<string, string> = {}
  let key = ''
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) {
      key = kv[1].toLowerCase()
      let v = kv[2].trim()
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => unq(x.trim())).filter(Boolean).join(', ')
      meta[key] = unq(v)
    } else {
      const li = /^\s*-\s+(.*)$/.exec(line)
      if (li && key) meta[key] = (meta[key] ? meta[key] + ', ' : '') + unq(li[1].trim())
    }
  }
  return { meta, body: src.slice(m[0].length) }
}
const unq = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2')

const slug = (s: string) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-')

export async function importMarkdown(src: string, fileName: string, files: FileMap = new Map()): Promise<CADocument> {
  const { meta, body: md0 } = frontMatter(src.replace(/\r\n?/g, '\n'))
  const fallback = base(fileName).replace(/\.[^.]+$/, '') || 'Imported document'
  const doc = newDoc(meta.title || fallback)
  doc.meta.author = meta.author || ''
  doc.meta.subject = meta.subject || meta.description || ''
  doc.meta.keywords = meta.keywords || meta.tags || ''
  doc.meta.subtitle = meta.subtitle || ''

  // Page breaks written the usual ways in Markdown.
  const md1 = md0.replace(/^[ \t]*(?:\\pagebreak|\\newpage|<!--\s*(?:page-?break|newpage)\s*-->|<div[^>]*page-break-(?:after|before)[^>]*>\s*<\/div>)[ \t]*$/gim, '\n<div class="ca-pb"></div>\n')

  const mdi = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(footnote)
  const html = mdi.render(md1)
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const body = dom.body
  body.querySelectorAll('script, style, iframe, object, embed').forEach(e => e.remove())

  // Footnotes → native notes.
  const notes = new Map<string, string>()
  body.querySelectorAll('li.footnote-item').forEach(li => {
    li.querySelectorAll('a.footnote-backref').forEach(a => a.remove())
    notes.set(li.id, (li.textContent || '').replace(/\s+/g, ' ').trim())
  })
  body.querySelectorAll('sup.footnote-ref').forEach(sup => {
    const id = sup.querySelector('a')?.getAttribute('href')?.slice(1) || ''
    const n = dom.createElement('sup')
    n.className = 'ca-fn'
    n.dataset.text = notes.get(id) || ''
    n.dataset.kind = 'foot'
    sup.replaceWith(n)
  })
  body.querySelectorAll('section.footnotes, hr.footnotes-sep').forEach(e => e.remove())

  // Headings: h5/h6 fold into h4; give every heading a stable id and point #slug links at it.
  body.querySelectorAll('h5, h6').forEach(e => { const n = dom.createElement('h4'); n.innerHTML = e.innerHTML; e.replaceWith(n) })
  const ids = new Map<string, string>()
  body.querySelectorAll('h1, h2, h3, h4').forEach(hd => {
    const s = slug(hd.textContent || '')
    let k = s, i = 1
    while (ids.has(k)) k = `${s}-${i++}`
    const id = uid('h')
    ids.set(k, id)
    const explicit = hd.getAttribute('id')
    if (explicit) ids.set(explicit, id)
    hd.setAttribute('id', id)
  })
  body.querySelectorAll('a[href^="#"]').forEach(a => {
    const t = decodeURIComponent(a.getAttribute('href')!.slice(1))
    const id = ids.get(t) || ids.get(slug(t))
    if (id) a.setAttribute('href', '#' + id)
  })

  // Title and subtitle.
  const first = body.firstElementChild
  const h1s = body.querySelectorAll('h1')
  const mkP = (kind: string, text: string) => { const p = dom.createElement('p'); p.dataset.kind = kind; p.textContent = text; return p }
  if (first?.tagName === 'H1' && (h1s.length === 1 || (meta.title && first.textContent?.trim() === meta.title))) {
    const p = dom.createElement('p'); p.dataset.kind = 'title'; p.innerHTML = first.innerHTML
    first.replaceWith(p)
    if (!meta.title) doc.meta.title = (p.textContent || '').trim() || fallback
  } else if (meta.title) body.prepend(mkP('title', meta.title))
  else if (h1s.length && !meta.title) doc.meta.title = (h1s[0].textContent || '').trim() || fallback
  if (meta.subtitle) {
    const t = body.querySelector('p[data-kind="title"]')
    if (t) t.after(mkP('subtitle', meta.subtitle)); else body.prepend(mkP('subtitle', meta.subtitle))
  }

  // GitHub-style alerts (> [!NOTE]) → callouts.
  const TONES: Record<string, string> = { note: 'note', info: 'note', tip: 'tip', important: 'key', warning: 'warning', caution: 'warning', danger: 'warning' }
  body.querySelectorAll('blockquote').forEach(bq => {
    const p = bq.firstElementChild
    if (!p || p.tagName !== 'P') return
    const m = /^\s*\[!(\w+)\]\s*/.exec(p.textContent || '')
    if (!m || !TONES[m[1].toLowerCase()]) return
    stripLead(p, m[0])
    if (!p.textContent?.trim() && !p.querySelector('img')) p.remove()
    const aside = dom.createElement('aside')
    aside.className = 'ca-callout'
    aside.dataset.tone = TONES[m[1].toLowerCase()]
    aside.innerHTML = bq.innerHTML || '<p></p>'
    bq.replaceWith(aside)
  })

  // Task lists.
  body.querySelectorAll('li').forEach(li => {
    const p = li.firstElementChild?.tagName === 'P' ? li.firstElementChild : li
    const m = /^\s*\[([ xX])\]\s+/.exec(p.textContent || '')
    if (m) stripLead(p, m[0], m[1] === ' ' ? '☐ ' : '☑ ')
  })

  // Code: inline in the mono face, blocks as a callout with line breaks kept.
  body.querySelectorAll('pre').forEach(pre => {
    const code = (pre.textContent || '').replace(/\n$/, '')
    const aside = dom.createElement('aside')
    aside.className = 'ca-callout'
    aside.dataset.tone = 'key'
    const p = dom.createElement('p')
    const span = dom.createElement('span')
    span.style.fontFamily = 'JetBrains Mono'
    code.split('\n').forEach((line, i) => {
      if (i) span.append(dom.createElement('br'))
      span.append(line.replace(/^ +/, s => ' '.repeat(s.length)).replace(/\t/g, '    '))
    })
    p.append(span)
    aside.append(p)
    pre.replaceWith(aside)
  })
  body.querySelectorAll('code').forEach(c => {
    const span = dom.createElement('span')
    span.style.fontFamily = 'JetBrains Mono'
    span.textContent = c.textContent
    c.replaceWith(span)
  })

  // Images: bring them in as assets; an image alone in a paragraph becomes a figure, its title the caption.
  const S = doc.content.attrs.settings
  const contentW = (S.width - S.margin.left - S.margin.right) || 450
  const mdDir = dir(norm(fileName))
  let missing = 0
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || ''
    const blob = await loadImage(src, mdDir, files)
    if (!blob) {
      missing++
      const alt = img.getAttribute('alt')
      if (alt) img.replaceWith(dom.createTextNode(`[${alt}]`)); else img.remove()
      continue
    }
    try {
      const a = await addImageAsset(doc, blob, base(src.split(/[?#]/)[0]) || 'image')
      img.setAttribute('src', 'asset:' + a.id)
      img.setAttribute('width', String(a.w))
      img.setAttribute('height', String(a.h))
      const pct = Math.round(Math.min(100, (a.w * 0.75 / contentW) * 100))
      img.setAttribute('data-pct', String(Math.max(10, pct)))
    } catch { missing++; img.remove(); continue }
    const caption = img.getAttribute('title')
    const p = img.parentElement
    const alone = p && p.tagName === 'P' && p.children.length === 1 && !(p.textContent || '').trim()
    if (alone) p!.replaceWith(img)
    if (caption) {
      const c = dom.createElement('p')
      c.dataset.kind = 'caption'
      c.dataset.label = 'figure'
      c.textContent = caption
      ;(alone || !p || p.tagName !== 'P' ? img : p).after(c)
    }
  }

  let out = body.innerHTML
  if (!out.trim()) out = `<p data-kind="title">${esc(doc.meta.title)}</p><p></p>`
  const json = generateJSON(out, extensions())
  const pcts = Array.from(body.querySelectorAll('img')).map(i => +(i.getAttribute('data-pct') || 100))
  doc.content = { type: 'doc', attrs: doc.content.attrs, content: json.content }
  finish(doc.content, doc, pcts)
  await store.save(doc)
  if (missing) (doc as any)._missing = missing
  return doc
}

function stripLead(el: Element, lead: string, replace = '') {
  let left = lead.length
  const walk = (n: Node): boolean => {
    if (n.nodeType === 3) {
      const t = n.textContent || ''
      if (t.length >= left) { n.textContent = replace + t.slice(left); return true }
      left -= t.length
      n.textContent = ''
      return false
    }
    for (const c of Array.from(n.childNodes)) if (walk(c)) return true
    return false
  }
  walk(el)
}

async function loadImage(src: string, mdDir: string, files: FileMap): Promise<Blob | null> {
  if (!src) return null
  try {
    if (src.startsWith('data:')) return await (await fetch(src)).blob()
    if (/^https?:/i.test(src)) {
      const r = await fetch(src)
      if (!r.ok) return null
      const b = await r.blob()
      return b.type.startsWith('image/') ? b : null
    }
  } catch { return null }
  let p = src.split(/[?#]/)[0]
  try { p = decodeURIComponent(p) } catch {}
  p = p.replace(/^file:\/\//i, '')
  const tries = [norm(mdDir + p), norm(p)]
  let bytes: Uint8Array | undefined
  for (const t of tries) if ((bytes = files.get(t))) break
  if (!bytes) {
    const b = base(norm(p)).toLowerCase()
    for (const [k, v] of files) if (base(k).toLowerCase() === b) { bytes = v; break }
  }
  if (!bytes) return null
  const ext = (p.split('.').pop() || '').toLowerCase()
  return new Blob([bytes as BlobPart], { type: IMG_MIME[ext] || 'image/png' })
}

function finish(root: any, doc: CADocument, pcts: number[]) {
  let i = 0
  const walk = (n: any) => {
    if (n.type === 'image') {
      const a = typeof n.attrs?.src === 'string' && n.attrs.src.startsWith('asset:') ? doc.assets[n.attrs.src.slice(6)] : null
      n.attrs = { ...n.attrs, ...(a?.w && a?.h ? { w: a.w, h: a.h } : {}), width: pcts[i++] ?? 100 }
    }
    for (const c of n.content || []) walk(c)
  }
  walk(root)
}

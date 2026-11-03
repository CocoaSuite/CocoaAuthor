import { generateJSON } from '@tiptap/core'
import { unzipSync, strFromU8 } from 'fflate'
import { extensions } from '../editor/extensions'
import { newDoc } from '../model/doc'
import { addImageAsset } from '../ui/commands'
import { store } from '../storage/store'
import { esc } from '../util'
import type { CADocument } from '../model/types'

export async function importDocx(data: Uint8Array, fileName: string): Promise<CADocument> {
  const mod: any = await import('mammoth/mammoth.browser.min.js')
  const mammoth = mod.default || mod
  const title = fileName.replace(/\.docx$/i, '')
  const doc = newDoc(title)
  const meta = readMeta(data)
  if (meta.title) doc.meta.title = meta.title
  if (meta.author) doc.meta.author = meta.author
  if (meta.subject) doc.meta.subject = meta.subject

  const result = await mammoth.convertToHtml({ arrayBuffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }, {
    styleMap: [
      "p[style-name='Title'] => p.ca-title:fresh",
      "p[style-name='Subtitle'] => p.ca-subtitle:fresh",
      "p[style-name='Caption'] => p.ca-caption:fresh",
      "p[style-name='caption'] => p.ca-caption:fresh",
      "p[style-name='Quote'] => blockquote > p:fresh",
      "p[style-name='TOC Heading'] => p.ca-toch:fresh",
      "p[style-name='toc 1'] => p.ca-tocitem:fresh",
      "p[style-name='toc 2'] => p.ca-tocitem:fresh",
      "p[style-name='toc 3'] => p.ca-tocitem:fresh",
      "p[style-name='toc 4'] => p.ca-tocitem:fresh",
      "p[style-name='Intense Quote'] => blockquote > p:fresh"
    ],
    convertImage: mammoth.images.imgElement(async (image: any) => {
      try {
        const buf = await image.read()
        const blob = new Blob([buf], { type: image.contentType || 'image/png' })
        const a = await addImageAsset(doc, blob, 'image')
        return { src: 'asset:' + a.id, width: String(a.w), height: String(a.h) }
      } catch { return { src: '' } }
    })
  })

  const dom = new DOMParser().parseFromString(`<body>${result.value}</body>`, 'text/html')
  const body = dom.body
  const notes = new Map<string, string>()
  body.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]').forEach(li => {
    li.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach(a => a.remove())
    notes.set(li.id, (li.textContent || '').trim())
  })
  body.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]').forEach(a => {
    const id = a.getAttribute('href')!.slice(1)
    if (!notes.has(id)) return
    const sup = a.closest('sup') || a
    const n = dom.createElement('sup')
    n.className = 'ca-fn'
    n.dataset.text = notes.get(id)!
    n.dataset.kind = id.startsWith('end') ? 'end' : 'foot'
    sup.replaceWith(n)
  })
  body.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]').forEach(li => {
    const ol = li.parentElement
    li.remove()
    if (ol && !ol.children.length) ol.remove()
  })
  const tocItems = Array.from(body.querySelectorAll('p.ca-tocitem'))
  if (tocItems.length) {
    const nav = dom.createElement('nav')
    nav.className = 'ca-toc'
    const prev = tocItems[0].previousElementSibling
    if (prev && (prev.classList.contains('ca-toch') || /^\s*(table of )?contents\s*$/i.test(prev.textContent || ''))) { nav.dataset.title = (prev.textContent || 'Contents').trim(); prev.remove() }
    tocItems[0].before(nav)
    tocItems.forEach(e => e.remove())
  }
  body.querySelectorAll('p.ca-toch').forEach(e => e.removeAttribute('class'))
  body.querySelectorAll('h5, h6').forEach(e => { const n = dom.createElement('h4'); n.innerHTML = e.innerHTML; e.replaceWith(n) })
  body.querySelectorAll('p.ca-title, p.ca-subtitle, p.ca-caption').forEach(p => {
    p.setAttribute('data-kind', p.className.replace('ca-', ''))
    if (p.className === 'ca-caption') p.setAttribute('data-label', /^\s*table/i.test(p.textContent || '') ? 'table' : 'figure')
    p.removeAttribute('class')
  })
  body.querySelectorAll('p[data-label]').forEach(p => {
    const first = p.firstChild
    if (first && first.nodeType === 3) first.textContent = first.textContent!.replace(/^\s*(Figure|Table)\s+\d+\s*[:.\-–]?\s*/i, '')
  })
  body.querySelectorAll('a[id]:not([href])').forEach(a => {
    if (!a.textContent) { const b = dom.createElement('span'); b.className = 'ca-bm'; b.id = a.id; b.dataset.name = a.id; a.replaceWith(b) }
  })
  body.querySelectorAll('img').forEach(img => {
    if (!img.getAttribute('src')) { img.remove(); return }
    const fig = img.closest('p')
    if (fig && fig.textContent?.trim() === '' && fig.querySelectorAll('img').length === 1) fig.replaceWith(img)
  })

  let html = body.innerHTML
  if (!html.trim()) html = `<p>${esc(title)}</p>`
  const json = generateJSON(html, extensions())
  const layout = readLayout(data)
  doc.content = { type: 'doc', attrs: { ...doc.content.attrs, settings: { ...doc.content.attrs.settings, ...layout } }, content: json.content }
  fixImageSizes(doc.content, doc)
  await store.save(doc)
  return doc
}

function fixImageSizes(n: any, doc: CADocument) {
  if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith('asset:')) {
    const a = doc.assets[n.attrs.src.slice(6)]
    if (a?.w && a?.h) n.attrs = { ...n.attrs, w: a.w, h: a.h }
  }
  for (const c of n.content || []) fixImageSizes(c, doc)
}

function readMeta(data: Uint8Array): { title?: string; author?: string; subject?: string } {
  try {
    const z = unzipSync(data, { filter: f => f.name === 'docProps/core.xml' })
    const x = z['docProps/core.xml']
    if (!x) return {}
    const d = new DOMParser().parseFromString(strFromU8(x), 'application/xml')
    const g = (tag: string) => d.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined
    return { title: g('dc:title'), author: g('dc:creator'), subject: g('dc:subject') }
  } catch { return {} }
}

function readLayout(data: Uint8Array): Record<string, any> {
  try {
    const z = unzipSync(data, { filter: f => f.name === 'word/document.xml' })
    const x = z['word/document.xml']
    if (!x) return {}
    const d = new DOMParser().parseFromString(strFromU8(x), 'application/xml')
    const secs = d.getElementsByTagName('w:sectPr')
    const sp = secs[secs.length - 1]
    if (!sp) return {}
    const sz = sp.getElementsByTagName('w:pgSz')[0]
    const mg = sp.getElementsByTagName('w:pgMar')[0]
    const out: Record<string, any> = {}
    const a = (e: Element | undefined, k: string) => (e ? parseFloat(e.getAttribute('w:' + k) || '') : NaN)
    const w = a(sz, 'w') / 20, hh = a(sz, 'h') / 20
    if (w > 0 && hh > 0) {
      const land = sz.getAttribute('w:orient') === 'landscape' || w > hh
      const pw = Math.min(w, hh), ph = Math.max(w, hh)
      const near = (x: number, y: number) => Math.abs(x - y) < 3
      out.size = near(pw, 595.28) && near(ph, 841.89) ? 'A4' : near(pw, 612) && near(ph, 792) ? 'Letter' : near(pw, 612) && near(ph, 1008) ? 'Legal' : 'Custom'
      out.width = pw; out.height = ph; out.landscape = land
    }
    if (mg) {
      const m = { top: a(mg, 'top') / 20, right: a(mg, 'right') / 20, bottom: a(mg, 'bottom') / 20, left: a(mg, 'left') / 20 }
      if (Object.values(m).every(v => v >= 0)) out.margin = m
    }
    return out
  } catch { return {} }
}

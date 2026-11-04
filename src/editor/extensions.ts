import { Node, Mark, Extension, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import Link from '@tiptap/extension-link'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { assets } from './registry'
import { uid, esc } from '../util'
import { layoutPlugin } from '../layout/plugin'
import { chartURL, type ChartData } from './chart'

const idAttr = {
  default: null,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => el.getAttribute('id') || el.getAttribute('data-id'),
  renderHTML: (a: any) => (a.id ? { id: a.id } : {})
}

export const CADoc = Document.extend({
  content: 'section+',
  addAttributes() {
    return { settings: { default: null, rendered: false }, styles: { default: null, rendered: false } }
  }
})

export const Section = Node.create({
  name: 'section',
  content: 'block+',
  isolating: false,
  addAttributes() {
    return {
      landscape: { default: null, parseHTML: el => (el.dataset.orient ? el.dataset.orient === 'landscape' : null), renderHTML: a => (a.landscape == null ? {} : { 'data-orient': a.landscape ? 'landscape' : 'portrait' }) },
      restart: { default: null, parseHTML: el => (el.dataset.restart ? +el.dataset.restart : null), renderHTML: a => (a.restart == null ? {} : { 'data-restart': a.restart }) }
    }
  },
  parseHTML: () => [{ tag: 'section.ca-sec' }],
  renderHTML: ({ HTMLAttributes }) => ['section', mergeAttributes(HTMLAttributes, { class: 'ca-sec' }), 0]
})

export const Para = Paragraph.extend({
  addAttributes() {
    return {
      kind: { default: 'body', keepOnSplit: false, parseHTML: el => el.getAttribute('data-kind') || 'body', renderHTML: a => ({ 'data-kind': a.kind, class: 'k-' + a.kind }) },
      label: { default: null, keepOnSplit: false, parseHTML: el => el.getAttribute('data-label'), renderHTML: a => (a.label ? { 'data-label': a.label } : {}) },
      id: idAttr,
      indent: { default: 0, parseHTML: el => +(el.getAttribute('data-indent') || 0), renderHTML: a => (a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 18}px` } : {}) }
    }
  }
})

export const Head = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), id: idAttr }
  },
  renderHTML({ node, HTMLAttributes }) {
    const l = node.attrs.level
    return ['h' + l, mergeAttributes(HTMLAttributes, { class: 'k-h' + l }), 0]
  }
}).configure({ levels: [1, 2, 3, 4] })

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { tone: { default: 'note', parseHTML: el => el.getAttribute('data-tone') || 'note', renderHTML: a => ({ 'data-tone': a.tone }) } }
  },
  parseHTML: () => [{ tag: 'aside.ca-callout' }],
  renderHTML: ({ HTMLAttributes }) => ['aside', mergeAttributes(HTMLAttributes, { class: 'ca-callout' }), 0]
})

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div.ca-pb' }, { tag: 'hr[data-page-break]' }],
  renderHTML: () => ['div', { class: 'ca-pb', contenteditable: 'false' }, ['span', { class: 'ca-pbl', 'data-abs': '' }, 'Page break']]
})

export const Img = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      w: { default: 800 },
      h: { default: 600 },
      width: { default: 100 },
      align: { default: 'center' },
      alt: { default: '' },
      crop: { default: null }
    }
  },
  parseHTML: () => [{
    tag: 'img[src]',
    getAttrs: el => {
      const i = el as HTMLImageElement
      return { src: i.getAttribute('src'), alt: i.alt || '', w: i.naturalWidth || +(i.getAttribute('width') || 800), h: i.naturalHeight || +(i.getAttribute('height') || 600) }
    }
  }],
  renderHTML: ({ HTMLAttributes: a }) => ['img', { src: a.src.startsWith('asset:') ? assets.url(a.src.slice(6)) : a.src, alt: a.alt, 'data-src': a.src }],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure')
      dom.className = 'ca-img'
      const box = document.createElement('div')
      box.className = 'ca-imgb'
      const img = document.createElement('img')
      img.draggable = false
      box.append(img)
      dom.append(box)
      const apply = (n: typeof node) => {
        const a = n.attrs
        dom.dataset.align = a.align
        box.style.width = a.width + '%'
        const ratio = a.crop ? a.crop.replace(':', ' / ') : `${a.w} / ${a.h}`
        box.style.aspectRatio = ratio
        const src = a.src.startsWith('asset:') ? assets.url(a.src.slice(6)) : a.src
        if (img.getAttribute('src') !== src) img.src = src
        img.alt = a.alt
        img.dataset.asset = a.src.startsWith('asset:') ? a.src.slice(6) : ''
      }
      apply(node)
      return {
        dom,
        update(n) { if (n.type.name !== 'image') return false; apply(n); return true },
        ignoreMutation: () => true
      }
    }
  }
})

export const Chart = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    const j = (k: string, d: any) => ({ default: d, parseHTML: (el: HTMLElement) => { try { return JSON.parse(el.dataset[k] || '') } catch { return d } }, renderHTML: (a: any) => ({ ['data-' + k]: JSON.stringify(a[k]) }) })
    return {
      kind: { default: 'column' }, title: { default: '' }, legend: { default: true }, ratio: { default: 0.56 },
      width: { default: 100 }, align: { default: 'center' },
      labels: j('labels', []), series: j('series', [])
    }
  },
  parseHTML: () => [{ tag: 'figure.ca-chart' }],
  renderHTML: ({ node }) => ['figure', { class: 'ca-chart', 'data-labels': JSON.stringify(node.attrs.labels), 'data-series': JSON.stringify(node.attrs.series), 'data-kind': node.attrs.kind }, ['img', { src: chartURL(node.attrs as ChartData), alt: node.attrs.title || 'Chart' }]],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure')
      dom.className = 'ca-img ca-chartv'
      const box = document.createElement('div')
      box.className = 'ca-imgb'
      const img = document.createElement('img')
      img.draggable = false
      box.append(img)
      dom.append(box)
      let last = ''
      const apply = (n: typeof node) => {
        const a = n.attrs
        dom.dataset.align = a.align
        box.style.width = a.width + '%'
        box.style.aspectRatio = `1 / ${a.ratio || 0.56}`
        const key = JSON.stringify([a.kind, a.title, a.legend, a.ratio, a.labels, a.series])
        if (key !== last) { last = key; img.src = chartURL(a as ChartData); img.alt = a.title || 'Chart' }
      }
      apply(node)
      return { dom, update(n) { if (n.type.name !== 'chart') return false; apply(n); return true }, ignoreMutation: () => true }
    }
  }
})

export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: idAttr,
      title: { default: 'Contents', parseHTML: el => el.dataset.title || 'Contents', renderHTML: a => ({ 'data-title': a.title }) },
      levels: { default: 3, parseHTML: el => +(el.dataset.levels || 3), renderHTML: a => ({ 'data-levels': a.levels }) }
    }
  },
  parseHTML: () => [{ tag: 'nav.ca-toc' }],
  renderHTML: ({ HTMLAttributes }) => ['nav', mergeAttributes(HTMLAttributes, { class: 'ca-toc' })],
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('nav')
      dom.className = 'ca-toc'
      dom.contentEditable = 'false'
      let last = ''
      const draw = (n: any, decos: readonly any[]) => {
        const spec = decos.find(d => d.spec?.toc)?.spec.toc || { entries: [], breaks: [] }
        const key = JSON.stringify([n.attrs, spec])
        if (key === last) return
        last = key
        if (n.attrs.id) dom.id = n.attrs.id
        const br = new Map<number, number>(spec.breaks.map((b: any) => [b.index, b.h]))
        let html = `<div class="ca-toct k-h1">${esc(n.attrs.title)}</div>`
        spec.entries.forEach((e: any, i: number) => {
          if (br.has(i)) html += `<div class="ca-sp" style="height:${br.get(i)}px"></div>`
          html += `<a class="ca-toce l${e.level}" href="#${e.id}"><span class="ca-toctx">${e.num ? `<span class="ca-tocn">${esc(e.num)}</span>` : ''}${esc(e.text || 'Untitled')}</span><span class="ca-tocl"></span><span class="ca-tocp">${esc(e.page || '')}</span></a>`
        })
        if (!spec.entries.length) html += `<div class="ca-tocempty" data-editor-only>Add headings to build the table of contents.</div>`
        dom.innerHTML = html
      }
      draw(node, decorations)
      return {
        dom,
        update(n, d) { if (n.type.name !== 'toc') return false; draw(n, d); return true },
        ignoreMutation: () => true,
        stopEvent: () => false
      }
    }
  }
})

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: idAttr, text: { default: '' }, kind: { default: 'foot' } }
  },
  parseHTML: () => [{ tag: 'sup.ca-fn', getAttrs: el => ({ id: (el as HTMLElement).dataset.id, text: (el as HTMLElement).dataset.text || '', kind: (el as HTMLElement).dataset.kind || 'foot' }) }],
  renderHTML: ({ node }) => ['sup', { class: 'ca-fn', 'data-id': node.attrs.id, 'data-text': node.attrs.text, 'data-kind': node.attrs.kind }, '*'],
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('sup')
      dom.className = 'ca-fn'
      dom.contentEditable = 'false'
      const a = document.createElement('a')
      dom.append(a)
      const draw = (n: any, d: readonly any[]) => {
        const num = d.find(x => x.spec?.fn)?.spec.fn ?? ''
        a.textContent = String(num)
        a.href = '#fn-' + n.attrs.id
        a.id = 'fnr-' + n.attrs.id
        dom.dataset.id = n.attrs.id
        dom.dataset.kind = n.attrs.kind
        dom.title = n.attrs.text
      }
      draw(node, decorations)
      return { dom, update(n, d) { if (n.type.name !== 'footnote') return false; draw(n, d); return true }, ignoreMutation: () => true }
    }
  }
})

export const Xref = Node.create({
  name: 'xref',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { target: { default: '' }, show: { default: 'text' } }
  },
  parseHTML: () => [{ tag: 'a.ca-xref', getAttrs: el => ({ target: (el as HTMLElement).dataset.target, show: (el as HTMLElement).dataset.show || 'text' }) }],
  renderHTML: ({ node }) => ['a', { class: 'ca-xref', href: '#' + node.attrs.target, 'data-target': node.attrs.target, 'data-show': node.attrs.show }, node.attrs.target],
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('a')
      dom.className = 'ca-xref'
      dom.contentEditable = 'false'
      const draw = (n: any, d: readonly any[]) => {
        const x = d.find(v => v.spec?.xref)?.spec.xref
        dom.textContent = x ? x.text : '…'
        dom.classList.toggle('broken', !!x?.broken)
        dom.setAttribute('href', '#' + n.attrs.target)
        dom.dataset.target = n.attrs.target
      }
      draw(node, decorations)
      return { dom, update(n, d) { if (n.type.name !== 'xref') return false; draw(n, d); return true }, ignoreMutation: () => true }
    }
  }
})

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: idAttr, name: { default: 'Bookmark' } }
  },
  parseHTML: () => [{ tag: 'span.ca-bm', getAttrs: el => ({ id: (el as HTMLElement).id, name: (el as HTMLElement).dataset.name || 'Bookmark' }) }],
  renderHTML: ({ node }) => ['span', { class: 'ca-bm', id: node.attrs.id, 'data-name': node.attrs.name }]
})

export const Hint = Mark.create({
  name: 'hint',
  inclusive: false,
  addProseMirrorPlugins() {
    const type = this.type
    return [new Plugin({
      key: new PluginKey('caHint'),
      props: {
        handleClick(view, pos) {
          const $p = view.state.doc.resolve(pos)
          const at = $p.parent.childAfter($p.parentOffset).node || $p.parent.childBefore($p.parentOffset).node
          if (!at || !type.isInSet(at.marks)) return false
          let from = pos, to = pos
          const start = $p.start()
          $p.parent.forEach((c, off) => {
            const a = start + off, b = a + c.nodeSize
            if (a <= pos && pos <= b && type.isInSet(c.marks)) { from = a; to = b }
          })
          if (to > from) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))); return true }
          return false
        }
      }
    })]
  },
  parseHTML: () => [{ tag: 'span.ca-hint' }],
  renderHTML: () => ['span', { class: 'ca-hint' }, 0]
})

const cellBg = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute('data-bg') || null,
    renderHTML: (a: any) => (a.backgroundColor ? { style: `background-color:${a.backgroundColor}`, 'data-bg': a.backgroundColor } : {})
  }
}
const Cell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBg } } })
const HeadCell = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBg } } })

const ID_TYPES = new Set(['heading', 'toc', 'footnote', 'bookmark'])

export const Ids = Extension.create({
  name: 'caIds',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('caIds'),
      appendTransaction(trs, _o, state) {
        if (!trs.some(t => t.docChanged)) return null
        const seen = new Set<string>()
        let tr: any = null
        state.doc.descendants((n, pos) => {
          const need = ID_TYPES.has(n.type.name) || (n.type.name === 'paragraph' && n.attrs.kind === 'caption')
          if (!need) {
            if (n.type.name === 'paragraph' && n.attrs.id) { tr = tr || state.tr; tr.setNodeAttribute(pos, 'id', null) }
            return
          }
          const id = n.attrs.id
          if (!id || seen.has(id)) {
            const nid = uid(n.type.name[0])
            tr = tr || state.tr
            tr.setNodeAttribute(pos, 'id', nid)
            seen.add(nid)
          } else seen.add(id)
        })
        if (tr) tr.setMeta('addToHistory', false)
        return tr
      }
    })]
  }
})

const num = (k: string, css: (v: number) => string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => { const v = el.getAttribute('data-' + k.toLowerCase()); return v != null && v !== '' ? +v : null },
  renderHTML: (a: any) => (a[k] == null || isNaN(a[k]) ? {} : { ['data-' + k.toLowerCase()]: a[k], style: css(a[k]) })
})
const flag = (k: string) => ({
  default: false,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => el.hasAttribute('data-' + k.toLowerCase()),
  renderHTML: (a: any) => (a[k] ? { ['data-' + k.toLowerCase()]: '' } : {})
})

export const ParaFormat = Extension.create({
  name: 'caParaFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        left: num('left', v => `margin-left:${v}px`),
        right: num('right', v => `margin-right:${v}px`),
        firstLine: num('firstLine', v => `text-indent:${v}px`),
        before: num('before', v => `margin-top:${v}px`),
        after: num('after', v => `margin-bottom:${v}px`),
        lh: num('lh', v => `line-height:${v}`),
        keepNext: flag('keepNext'),
        breakBefore: flag('breakBefore')
      }
    }]
  }
})

export const LayoutExt = Extension.create({
  name: 'caLayout',
  addProseMirrorPlugins() { return [layoutPlugin()] }
})

export function extensions() {
  return [
    StarterKit.configure({
      document: false, paragraph: false, heading: false, code: false, codeBlock: false,
      link: false, trailingNode: false,
      bulletList: { keepMarks: true }, orderedList: { keepMarks: true }
    } as any),
    CADoc, Section, Para, Head, Callout, PageBreak, Img, Chart, Toc, Footnote, Xref, Bookmark, Hint,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['mailto', 'tel'], HTMLAttributes: { target: null, rel: null, class: null } }),
    TextStyle, Color, FontFamily, FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: false, cellMinWidth: 30 }), TableRow, HeadCell, Cell,
    ParaFormat, Ids, LayoutExt
  ]
}

import { Node, Mark, Extension, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import Link from '@tiptap/extension-link'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import TextAlign from '@tiptap/extension-text-align'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { assets } from './registry'
import { uid, esc } from '../util'
import { layoutPlugin, getSettings } from '../layout/plugin'
import { chartURL, type ChartData } from './chart'
import { frameRatio, placeImage } from './imagegeom'

const jsonAttr = (v: string | null): Record<string, any> | null => {
  if (!v) return null
  try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o : null } catch { return null }
}

const idAttr = {
  default: null,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => el.getAttribute('id') || el.getAttribute('data-id'),
  renderHTML: (a: any) => (a.id ? { id: a.id } : {})
}

export const CADoc = Document.extend({
  content: 'section+',
  addAttributes() {
    return { settings: { default: null, rendered: false }, styles: { default: null, rendered: false }, frames: { default: null, rendered: false } }
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
      src: { default: '', parseHTML: (el: HTMLElement) => { const d = el.getAttribute('data-src'); return d && d.startsWith('asset:') ? d : el.getAttribute('src') } },
      w: { default: 800 },
      h: { default: 600 },
      width: { default: 100 },
      align: { default: 'center' },
      alt: { default: '' },
      crop: { default: null },
      fit: { default: null },
      cx: { default: null },
      cy: { default: null },
      zoom: { default: null },
      cropRect: { default: null }
    }
  },
  parseHTML: () => [{
    tag: 'img[src]',
    getAttrs: el => {
      const i = el as HTMLImageElement
      // Copied from CocoaAuthor: every setting travels in data-ca, and the stored image in data-src (src is only a temporary blob link).
      const saved = jsonAttr(i.getAttribute('data-ca'))
      if (saved && typeof saved.src === 'string') return saved
      const ds = i.getAttribute('data-src')
      const src = ds && ds.startsWith('asset:') ? ds : i.getAttribute('src')
      return { src, alt: i.alt || '', w: i.naturalWidth || +(i.getAttribute('width') || 800), h: i.naturalHeight || +(i.getAttribute('height') || 600) }
    }
  }],
  renderHTML: ({ node }) => {
    const a = node.attrs
    return ['img', { src: a.src.startsWith('asset:') ? assets.url(a.src.slice(6)) : a.src, alt: a.alt, 'data-src': a.src, 'data-ca': JSON.stringify(a) }]
  },
  addNodeView() {
    return ({ node: n0, getPos, editor }) => {
      let node = n0
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
        const fr = frameRatio(a as any)
        box.style.aspectRatio = `1 / ${fr}`
        const g = placeImage(a as any, a.w, a.h, 1, fr)
        img.style.left = g.dx * 100 + '%'
        img.style.top = (g.dy / fr) * 100 + '%'
        img.style.width = g.dw * 100 + '%'
        img.style.height = (g.dh / fr) * 100 + '%'
        const src = a.src.startsWith('asset:') ? assets.url(a.src.slice(6)) : a.src
        if (img.getAttribute('src') !== src) img.src = src
        img.alt = a.alt
        img.dataset.asset = a.src.startsWith('asset:') ? a.src.slice(6) : ''
      }
      apply(node)
      // Resize handles: shown while the image is selected; they change its width in the column.
      for (const hd of ['nw', 'ne', 'e', 'se', 'sw', 'w']) {
        const i = document.createElement('i')
        i.className = 'ca-h'
        i.dataset.h = hd
        i.contentEditable = 'false'
        box.append(i)
        i.addEventListener('pointerdown', ev => {
          ev.preventDefault(); ev.stopPropagation()
          const col = dom.getBoundingClientRect().width
          const start = box.getBoundingClientRect().width
          const sx = ev.clientX
          const centred = dom.dataset.align === 'center'
          const sign = hd.includes('w') ? -1 : 1
          let pct = node.attrs.width
          const move = (e: PointerEvent) => {
            const d = (e.clientX - sx) * sign * (centred ? 2 : 1)
            pct = Math.max(10, Math.min(100, Math.round(((start + d) / col) * 100)))
            box.style.width = pct + '%'
          }
          const up = () => {
            document.removeEventListener('pointermove', move)
            document.removeEventListener('pointerup', up)
            const pos = typeof getPos === 'function' ? getPos() : null
            if (pos != null && pct !== node.attrs.width) editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'width', pct))
          }
          document.addEventListener('pointermove', move)
          document.addEventListener('pointerup', up)
        })
      }
      return {
        dom,
        update(n) { if (n.type.name !== 'image') return false; node = n; apply(n); return true },
        ignoreMutation: () => true,
        stopEvent: (e: Event) => (e.target as HTMLElement)?.classList?.contains('ca-h') || false
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
  parseHTML: () => [{ tag: 'figure.ca-chart', priority: 60, getAttrs: el => jsonAttr((el as HTMLElement).getAttribute('data-ca')) || {} }],
  renderHTML: ({ node }) => ['figure', { class: 'ca-chart', 'data-labels': JSON.stringify(node.attrs.labels), 'data-series': JSON.stringify(node.attrs.series), 'data-kind': node.attrs.kind, 'data-ca': JSON.stringify(node.attrs) }, ['img', { src: chartURL(node.attrs as ChartData), alt: node.attrs.title || 'Chart' }]],
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
      appendTransaction(trs, old, state) {
        if (!trs.some(t => t.docChanged)) return null
        const needs = (n: any) => ID_TYPES.has(n.type.name) || (n.type.name === 'paragraph' && n.attrs.kind === 'caption')
        // Where each existing id ends up, so a pasted copy never takes the id (and the links) of the original.
        const owner = new Map<string, number>()
        old.doc.descendants((n, pos) => {
          if (!needs(n) || !n.attrs.id) return
          let p = pos
          for (const t of trs) { const r = t.mapping.mapResult(p, 1); if (r.deleted) return; p = r.pos }
          owner.set(n.attrs.id, p)
        })
        const count = new Map<string, number>()
        state.doc.descendants(n => { if (needs(n) && n.attrs.id) count.set(n.attrs.id, (count.get(n.attrs.id) || 0) + 1) })
        const seen = new Set<string>()
        let tr: any = null
        state.doc.descendants((n, pos) => {
          const need = needs(n)
          if (!need) {
            if (n.type.name === 'paragraph' && n.attrs.id) { tr = tr || state.tr; tr.setNodeAttribute(pos, 'id', null) }
            return
          }
          const id = n.attrs.id
          // A duplicated id stays with the node that had it before; the others get new ones.
          const dupLoser = id && (count.get(id) || 0) > 1 && owner.has(id) && owner.get(id) !== pos && state.doc.nodeAt(owner.get(id)!)?.attrs?.id === id
          if (!id || seen.has(id) || dupLoser) {
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
        breakBefore: flag('breakBefore'),
        // Decorative bar on the left: width in pt (null = none), gap to the text, colour (null = accent).
        barW: {
          default: null,
          parseHTML: (el: HTMLElement) => (el.dataset.bar ? parseFloat(el.dataset.bar) || null : null),
          renderHTML: (a: any) => a.barW ? { 'data-bar': String(a.barW), style: `border-left:${a.barW}px solid ${a.barColor || 'var(--accent)'};padding-left:${a.barGap ?? 12}px` } : {}
        },
        barGap: { default: null, parseHTML: (el: HTMLElement) => (el.dataset.barGap ? +el.dataset.barGap : null), renderHTML: (a: any) => (a.barW && a.barGap != null ? { 'data-bar-gap': String(a.barGap) } : {}) },
        barColor: { default: null, parseHTML: (el: HTMLElement) => el.dataset.barColor || null, renderHTML: (a: any) => (a.barW && a.barColor ? { 'data-bar-color': a.barColor } : {}) },
        pstyle: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-ps') || null,
          renderHTML: (a: any) => (a.pstyle ? { 'data-ps': a.pstyle, class: 'ps-' + String(a.pstyle).replace(/[^\w-]/g, '_') } : {})
        }
      }
    }]
  }
})

const dataAttr = (k: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute('data-' + k) || null,
  renderHTML: (a: any) => (a[k] ? { ['data-' + k]: a[k] } : {})
})

/** Number format and marker pattern for lists (from Word: "a)", "(i)", "1.1."), and the bullet character. */
export const ListFormat = Extension.create({
  name: 'caListFormat',
  addGlobalAttributes() {
    return [
      { types: ['orderedList'], attributes: { fmt: dataAttr('fmt'), pat: dataAttr('pat'), tight: flag('tight') } },
      { types: ['bulletList'], attributes: { char: dataAttr('char'), tight: flag('tight') } }
    ]
  }
})

/** Per-table grid colour (or no grid) and cell padding in pt, so tables from Word keep their look. */
export const TableFormat = Extension.create({
  name: 'caTableFormat',
  addGlobalAttributes() {
    return [{
      types: ['table'],
      attributes: {
        grid: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-grid') || null,
          renderHTML: (a: any) => (a.grid ? { 'data-grid': a.grid, style: `--grid:${a.grid === 'none' ? 'transparent' : a.grid}` } : {})
        },
        pad: {
          default: null,
          parseHTML: (el: HTMLElement) => { const v = el.getAttribute('data-pad'); return v ? v.split(' ').map(Number) : null },
          renderHTML: (a: any) => (Array.isArray(a.pad) && a.pad.length === 4 ? { 'data-pad': a.pad.join(' '), style: `--cp:${a.pad.map((x: number) => x + 'px').join(' ')}` } : {})
        }
      }
    }]
  }
})

/** Manual kerning and tracking: letter spacing on a run of text, in em. */
export const Spacing = Extension.create({
  name: 'caSpacing',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        letterSpacing: {
          default: null,
          parseHTML: (el: HTMLElement) => { const v = el.style.letterSpacing; return v && v.endsWith('em') ? parseFloat(v) : null },
          renderHTML: (a: any) => (a.letterSpacing ? { style: `letter-spacing:${a.letterSpacing}em` } : {})
        }
      }
    }]
  }
})

/** A named character style. */
export const CharStyle = Mark.create({
  name: 'cstyle',
  excludes: 'cstyle',
  addAttributes() {
    return { id: { default: null, parseHTML: el => el.getAttribute('data-cs'), renderHTML: a => ({ 'data-cs': a.id, class: 'cs-' + String(a.id).replace(/[^\w-]/g, '_') }) } }
  },
  parseHTML: () => [{ tag: 'span[data-cs]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0]
})

export const LayoutExt = Extension.create({
  name: 'caLayout',
  addProseMirrorPlugins() { return [layoutPlugin()] }
})

/** Typing " in Russian text gives « or ». */
export const RuQuotes = Extension.create({
  name: 'caRuQuotes',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('caRuQuotes'),
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== '"') return false
          const $f = view.state.doc.resolve(from)
          if (!$f.parent.isTextblock || $f.parent.type.spec.code) return false
          const blk = $f.parent.textBetween(0, $f.parent.content.size, undefined, ' ')
          const at = $f.parentOffset
          const before = blk.slice(0, at), after = blk.slice(at)
          const near = (before.match(/\p{L}(?=\P{L}*$)/u) || after.match(/\p{L}/u))?.[0]
          let ru = near ? /\p{Script=Cyrillic}/u.test(near) : false
          if (!near) { try { ru = getSettings(view.state.doc).lang === 'ru' } catch { ru = false } }
          if (!ru) return false
          const prev = before.slice(-1)
          const q = !prev || /[\s(\[{«„“‘\u2014\u2013-]/.test(prev) ? '«' : '»'
          view.dispatch(view.state.tr.insertText(q, from, to))
          return true
        }
      }
    })]
  }
})

export function extensions() {
  return [
    StarterKit.configure({
      document: false, paragraph: false, heading: false, code: false, codeBlock: false,
      link: false, trailingNode: false,
      bulletList: { keepMarks: true }, orderedList: { keepMarks: true }
    } as any),
    CADoc, Section, Para, Head, Callout, PageBreak, Img, Chart, Toc, Footnote, Xref, Bookmark, Hint, CharStyle,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['mailto', 'tel'], HTMLAttributes: { target: null, rel: null, class: null } }),
    TextStyle, Color, FontFamily, FontSize,
    Highlight.configure({ multicolor: true }), Superscript, Subscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: false, cellMinWidth: 30 }), TableRow, HeadCell, Cell,
    ParaFormat, Spacing, ListFormat, TableFormat, Ids, LayoutExt, RuQuotes
  ]
}

/** The editor used inside text boxes: paragraphs, headings, lists and text formatting, nothing page-level. */
export function boxExtensions() {
  return [
    StarterKit.configure({
      paragraph: false, heading: false, code: false, codeBlock: false, link: false, trailingNode: false, horizontalRule: false, blockquote: false,
      bulletList: { keepMarks: true }, orderedList: { keepMarks: true }
    } as any),
    Para, Head, CharStyle,
    Link.configure({ openOnClick: false, autolink: true, protocols: ['mailto', 'tel'], HTMLAttributes: { target: null, rel: null, class: null } }),
    TextStyle, Color, FontFamily, FontSize,
    Highlight.configure({ multicolor: true }), Superscript, Subscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ParaFormat, Spacing, ListFormat, RuQuotes
  ]
}

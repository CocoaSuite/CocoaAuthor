import type { Editor } from '@tiptap/core'
import { h, ptToUnit, unitToPt, relTime } from '../util'
import { icon } from './icons'
import { FONTS, PAGE_SIZES, STYLE_KEYS, STYLE_NAMES, defaultStyles, type CADocument, type HF, type StyleKey, type DocStatus } from '../model/types'
import { settingsOf, stylesOf, setSettings, setStyles, currentBlockStyle, setBlockStyle, sectionAt, setSectionAttr, removeSectionBreak, selectedNode, findParent, replaceImage, allTargets, docStats, type BlockStyle } from './commands'
import { xrefText } from '../layout/plugin'
import type { DocView } from '../editor/docview'

type Opt = [string, string]

const fr = (label: string, ...c: (Node | string)[]) => h('div', { class: 'fr' }, h('label', {}, label), h('div', { class: 'grow' }, ...c))
const sec = (t: string, extra?: Node) => h('div', { class: 'sec' }, t, extra || '')

function sel(opts: Opt[], v: string, on: (v: string) => void) {
  const s = h('select', { onchange: () => on(s.value) }) as HTMLSelectElement
  for (const [k, l] of opts) s.append(h('option', { value: k }, l))
  s.value = v
  return s
}
function num(v: number, on: (v: number) => void, o: { step?: number; min?: number; max?: number } = {}) {
  const i = h('input', { type: 'number', value: isNaN(v) ? '' : String(v), placeholder: isNaN(v) ? 'Style' : null, step: String(o.step ?? 1), min: o.min != null ? String(o.min) : null, max: o.max != null ? String(o.max) : null }) as HTMLInputElement
  i.addEventListener('change', () => { const n = parseFloat(i.value); if (!isNaN(n)) on(n) })
  return i
}
function txt(v: string, on: (v: string) => void, ph = '') {
  const i = h('input', { type: 'text', value: v, placeholder: ph }) as HTMLInputElement
  i.addEventListener('change', () => on(i.value))
  i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur() })
  return i
}
function area(v: string, on: (v: string) => void) {
  const t = h('textarea', {}) as HTMLTextAreaElement
  t.value = v
  t.addEventListener('change', () => on(t.value))
  return t
}
function seg(opts: [string, string | Node, string?][], v: string, on: (v: string) => void) {
  const w = h('div', { class: 'seg', role: 'radiogroup' })
  for (const [k, l, title] of opts) w.append(h('button', { class: k === v ? 'on' : '', title: title || (typeof l === 'string' ? l : k), role: 'radio', 'aria-checked': String(k === v), onclick: () => on(k) }, l))
  return w
}
function sw(label: string, v: boolean, on: (v: boolean) => void) {
  const i = h('input', { type: 'checkbox', checked: v, onchange: () => on(i.checked) }) as HTMLInputElement
  return h('label', { class: 'chk' }, h('span', { class: 'sw2' }, i, h('i')), label)
}
function color(v: string, on: (v: string) => void, live = false) {
  const i = h('input', { type: 'color', value: v || '#000000' }) as HTMLInputElement
  i.addEventListener(live ? 'input' : 'change', () => on(i.value))
  return i
}

const fontOpts: Opt[] = FONTS.map(f => [f.name, f.name])

export function inspectorPanel(ed: Editor, dv: DocView, doc: CADocument, onMeta: () => void) {
  let tab = 'format'
  let styleKey: StyleKey = 'body'
  const tabs = h('div', { class: 'tabs', role: 'tablist' })
  const body = h('div', { class: 'ib' })
  const el = h('aside', { id: 'insp' }, tabs, body)
  const T: [string, string][] = [['format', 'Format'], ['page', 'Page'], ['styles', 'Styles'], ['doc', 'Document']]

  const drawTabs = () => {
    tabs.innerHTML = ''
    for (const [k, l] of T) tabs.append(h('button', { class: tab === k ? 'on' : '', role: 'tab', onclick: () => { tab = k; drawTabs(); render(true) } }, l))
  }

  const render = (force = false) => {
    if (!force && el.contains(document.activeElement) && document.activeElement !== document.body && (document.activeElement as HTMLElement).tagName !== 'BUTTON') return
    const st = body.scrollTop
    body.innerHTML = ''
    if (tab === 'format') formatTab()
    else if (tab === 'page') pageTab()
    else if (tab === 'styles') stylesTab()
    else docTab()
    body.scrollTop = st
  }

  const formatTab = () => {
    const sn = selectedNode(ed)
    const nt = sn?.node.type.name
    if (nt === 'image') return imageSec(sn!.pos)
    if (nt === 'chart') return chartSec(sn!.pos)
    if (nt === 'footnote') return footnoteSec(sn!.pos)
    if (nt === 'xref') return xrefSec(sn!.pos)
    if (nt === 'bookmark') return bookmarkSec(sn!.pos)
    if (nt === 'toc') return tocSec(sn!.pos)
    if (nt === 'pageBreak') { body.append(sec('Page break'), h('p', { class: 'hint' }, 'Content after a page break always starts on a new page.'), h('button', { onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Remove page break')); return }
    if (nt === 'horizontalRule') { body.append(sec('Divider'), h('button', { onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Remove divider')); return }

    const cur = currentBlockStyle(ed)
    body.append(sec('Paragraph style'))
    const sp = h('div', { class: 'stylepick' })
    const S = stylesOf(ed).text
    const opts: [BlockStyle, StyleKey][] = [['body', 'body'], ['title', 'title'], ['subtitle', 'subtitle'], ['h1', 'h1'], ['h2', 'h2'], ['h3', 'h3'], ['h4', 'h4'], ['caption', 'caption']]
    for (const [k, sk] of opts) sp.append(h('button', { class: cur === k ? 'on' : '', onclick: () => setBlockStyle(ed, k) }, h('span', {}, STYLE_NAMES[sk]), h('span', {}, `${S[sk].font.split(' ')[0]} ${S[sk].size}`)))
    body.append(sp)

    const p = ed.state.selection.$from.parent
    if (p.type.name === 'paragraph' && p.attrs.kind === 'caption') {
      body.append(fr('Numbering', sel([['figure', 'Figure'], ['table', 'Table'], ['', 'None']], p.attrs.label || '', v => ed.chain().focus().updateAttributes('paragraph', { label: v || null }).run())))
    }

    body.append(sec('Alignment'))
    const al = (ed.getAttributes(p.type.name).textAlign as string) || ''
    body.append(seg([['left', icon('alignl'), 'Left'], ['center', icon('alignc'), 'Center'], ['right', icon('alignr'), 'Right'], ['justify', icon('alignj'), 'Justify']], al, v => ed.chain().focus().setTextAlign(v).run()))
    if (p.type.name === 'paragraph' || p.type.name === 'heading') paraSec(p)

    body.append(sec('Text'))
    const ts = ed.getAttributes('textStyle')
    body.append(fr('Font', sel([['', 'From style'], ...fontOpts], ts.fontFamily?.replace(/"/g, '') || '', v => v ? ed.chain().focus().setFontFamily(v).run() : ed.chain().focus().unsetFontFamily().run())))
    body.append(fr('Size', num(parseFloat(ts.fontSize) || NaN, v => v > 0 ? ed.chain().focus().setFontSize(v + 'px').run() : ed.chain().focus().unsetFontSize().run(), { min: 0, max: 200, step: 0.5 }), ))
    const hl = ed.getAttributes('highlight').color
    body.append(fr('Colour', h('div', { class: 'fr' }, color(ts.color || '#1d1d1f', v => ed.chain().focus().setColor(v).run()), h('button', { onclick: () => ed.chain().focus().unsetColor().run() }, 'Reset'))))
    body.append(fr('Highlight', h('div', { class: 'fr' }, color(hl || '#fff3a3', v => ed.chain().focus().setHighlight({ color: v }).run()), h('button', { onclick: () => ed.chain().focus().unsetHighlight().run() }, 'None'))))
    body.append(h('button', { onclick: () => ed.chain().focus().unsetAllMarks().run() }, 'Clear text formatting'))

    if (ed.isActive('link')) {
      const href = ed.getAttributes('link').href || ''
      body.append(sec('Link'))
      body.append(h('div', { class: 'hint', style: { wordBreak: 'break-all' } }, describeHref(href)))
      body.append(h('div', { class: 'fr' },
        h('button', { onclick: () => el.dispatchEvent(new CustomEvent('ca-link')) }, icon('edit'), 'Edit'),
        h('button', { onclick: () => el.dispatchEvent(new CustomEvent('ca-follow', { detail: href })) }, icon('right'), 'Go'),
        h('button', { onclick: () => ed.chain().focus().extendMarkRange('link').unsetLink().run() }, icon('unlink'), 'Remove')))
    }

    const cal = findParent(ed, 'callout')
    if (cal) {
      body.append(sec('Callout'))
      body.append(fr('Tone', sel([['note', 'Note'], ['tip', 'Tip'], ['warning', 'Warning'], ['key', 'Key message']], cal.node.attrs.tone, v => ed.view.dispatch(ed.state.tr.setNodeAttribute(cal.pos, 'tone', v)))))
      body.append(h('button', { onclick: () => ed.chain().focus().lift('callout').run() }, 'Remove callout box'))
    }

    if (ed.isActive('table')) tableSec()

    const s = sectionAt(ed)
    if (s) {
      const st = settingsOf(ed)
      body.append(sec(ed.state.doc.childCount > 1 ? `Section ${s.index + 1} of ${ed.state.doc.childCount}` : 'Section'))
      if (st.layout === 'pages') {
        body.append(fr('Orientation', sel([['', `Document (${st.landscape ? 'landscape' : 'portrait'})`], ['p', 'Portrait'], ['l', 'Landscape']], s.node.attrs.landscape == null ? '' : s.node.attrs.landscape ? 'l' : 'p', v => setSectionAttr(ed, s.pos, 'landscape', v === '' ? null : v === 'l'))))
        const rs = s.node.attrs.restart
        body.append(sw('Restart page numbers', rs != null, v => setSectionAttr(ed, s.pos, 'restart', v ? 1 : null)))
        if (rs != null) body.append(fr('Start at', num(rs, v => setSectionAttr(ed, s.pos, 'restart', Math.max(0, Math.round(v))), { min: 0 })))
      }
      if (s.index > 0) body.append(h('button', { onclick: () => removeSectionBreak(ed, s.index) }, 'Remove section break'))
      else body.append(h('p', { class: 'hint' }, 'Add a section break from the Insert menu to start a new page with its own orientation or numbering.'))
    }
  }

  const paraSec = (p: any) => {
    const u = settingsOf(ed).units
    const a = p.attrs
    const setP = (o: Record<string, any>) => ed.chain().focus().updateAttributes('paragraph', o).updateAttributes('heading', o).run()
    const unum = (v: number | null, on: (pt: number | null) => void) => {
      const i = h('input', { type: 'number', step: u === 'mm' ? '1' : '0.05', placeholder: '0', value: v == null ? '' : String(ptToUnit(v, u)) }) as HTMLInputElement
      i.addEventListener('change', () => on(i.value === '' ? null : unitToPt(parseFloat(i.value), u)))
      return i
    }
    const pnum = (v: number | null, on: (v: number | null) => void, ph: string, step = 1) => {
      const i = h('input', { type: 'number', step: String(step), min: '0', placeholder: ph, value: v == null ? '' : String(v) }) as HTMLInputElement
      i.addEventListener('change', () => on(i.value === '' ? null : Math.max(0, parseFloat(i.value))))
      return i
    }
    const left = a.left != null ? a.left : a.indent ? a.indent * 18 : null
    const fl = a.firstLine
    const flKind = fl == null || fl === 0 ? '' : fl > 0 ? 'first' : 'hang'
    body.append(sec('Paragraph'))
    body.append(h('div', { class: 'g2' },
      h('label', {}, `Left indent (${u})`, unum(left, v => setP({ left: v, indent: 0 }))),
      h('label', {}, `Right indent (${u})`, unum(a.right, v => setP({ right: v })))))
    const flSel = sel([['', 'None'], ['first', 'First line'], ['hang', 'Hanging']], flKind, v => {
      const mag = Math.abs(fl || 0) || unitToPt(u === 'mm' ? 10 : 0.4, u)
      setP({ firstLine: v === '' ? null : v === 'first' ? mag : -mag })
    })
    const flIn = unum(fl == null ? null : Math.abs(fl), v => setP({ firstLine: v == null || v === 0 ? null : flKind === 'hang' ? -Math.abs(v) : Math.abs(v) }))
    if (!flKind) flIn.disabled = true
    body.append(h('div', { class: 'g2' }, h('label', {}, 'Special indent', flSel), h('label', {}, `By (${u})`, flIn)))
    const S = stylesOf(ed).text
    const sk: StyleKey = p.type.name === 'heading' ? (('h' + p.attrs.level) as StyleKey) : (['title', 'subtitle', 'caption'].includes(a.kind) ? a.kind : 'body')
    const st = S[sk]
    body.append(h('div', { class: 'g2' },
      h('label', {}, 'Space before (pt)', pnum(a.before, v => setP({ before: v }), String(st.before))),
      h('label', {}, 'Space after (pt)', pnum(a.after, v => setP({ after: v }), String(st.after)))))
    const lhOpts: Opt[] = [['', `Style (${st.lineHeight})`], ['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', 'Double']]
    if (a.lh != null && !lhOpts.some(o => o[0] === String(a.lh))) lhOpts.push([String(a.lh), String(a.lh)])
    body.append(h('div', { class: 'g2' },
      h('label', {}, 'Line spacing', sel(lhOpts, a.lh == null ? '' : String(a.lh), v => setP({ lh: v === '' ? null : +v }))),
      h('label', {}, 'Exact multiple', pnum(a.lh, v => setP({ lh: v == null ? null : Math.max(0.5, v) }), String(st.lineHeight), 0.05))))
    body.append(sw('Keep with next', !!a.keepNext, v => setP({ keepNext: v })))
    body.append(sw('Page break before', !!a.breakBefore, v => setP({ breakBefore: v })))
    if ([a.left, a.right, a.firstLine, a.before, a.after, a.lh].some(x => x != null) || a.indent || a.keepNext || a.breakBefore)
      body.append(h('button', { onclick: () => setP({ left: null, right: null, firstLine: null, before: null, after: null, lh: null, indent: 0, keepNext: false, breakBefore: false }) }, 'Reset paragraph settings'))
  }

  const tableSec = () => {
    body.append(sec('Table'))
    const b = (label: string, f: () => any) => h('button', { onclick: f }, label)
    body.append(h('div', { class: 'g2' },
      b('Row above', () => ed.chain().focus().addRowBefore().run()), b('Row below', () => ed.chain().focus().addRowAfter().run()),
      b('Column left', () => ed.chain().focus().addColumnBefore().run()), b('Column right', () => ed.chain().focus().addColumnAfter().run()),
      b('Delete row', () => ed.chain().focus().deleteRow().run()), b('Delete column', () => ed.chain().focus().deleteColumn().run()),
      b('Merge cells', () => ed.chain().focus().mergeCells().run()), b('Split cell', () => ed.chain().focus().splitCell().run())))
    body.append(h('div', { class: 'g2' },
      b('Header row', () => ed.chain().focus().toggleHeaderRow().run()),
      b('Add caption', () => {
        const t = findParent(ed, 'table')
        if (t) ed.chain().insertContentAt(t.pos, { type: 'paragraph', attrs: { kind: 'caption', label: 'table' } }).setTextSelection(t.pos + 1).focus().run()
      })))
    body.append(fr('Cell fill', h('div', { class: 'fr' },
      color(ed.getAttributes('tableCell').backgroundColor || '#ffffff', v => ed.chain().focus().setCellAttribute('backgroundColor', v).run()),
      h('button', { onclick: () => ed.chain().focus().setCellAttribute('backgroundColor', null).run() }, 'None'))))
    body.append(h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteTable().run() }, icon('trash'), 'Delete table'))
  }

  const imageSec = (pos: number) => {
    const n = ed.state.doc.nodeAt(pos)!
    const set = (k: string, v: any) => ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, k, v))
    body.append(sec('Image'))
    const r = h('input', { type: 'range', min: '10', max: '100', step: '5', value: String(n.attrs.width) }) as HTMLInputElement
    r.addEventListener('change', () => set('width', +r.value))
    body.append(fr('Width', h('div', { class: 'fr' }, r, h('span', { class: 'mute' }, n.attrs.width + '%'))))
    body.append(fr('Align', seg([['left', icon('alignl'), 'Left'], ['center', icon('alignc'), 'Center'], ['right', icon('alignr'), 'Right']], n.attrs.align, v => set('align', v))))
    body.append(fr('Crop', sel([['', 'Original'], ['1:1', 'Square'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['3:4', 'Portrait 3:4']], n.attrs.crop || '', v => set('crop', v || null))))
    body.append(fr('Alt text', txt(n.attrs.alt, v => set('alt', v), 'Describe the image')))
    body.append(h('div', { class: 'hint' }, `${n.attrs.w} × ${n.attrs.h} px`))
    const next = ed.state.doc.resolve(pos + n.nodeSize).nodeAfter
    const hasCap = next?.type.name === 'paragraph' && next.attrs.kind === 'caption'
    body.append(h('div', { class: 'g2' },
      h('button', { onclick: () => replaceImage(ed, doc, pos) }, 'Replace…'),
      hasCap ? h('button', { onclick: () => ed.chain().setTextSelection(pos + n.nodeSize + 1).focus().run() }, 'Edit caption')
        : h('button', { onclick: () => ed.chain().insertContentAt(pos + n.nodeSize, { type: 'paragraph', attrs: { kind: 'caption', label: 'figure' } }).setTextSelection(pos + n.nodeSize + 1).focus().run() }, 'Add caption')))
    body.append(h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Delete image'))
  }

  const chartSec = (pos: number) => {
    const n = ed.state.doc.nodeAt(pos)!
    const set = (k: string, v: any) => ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, k, v))
    body.append(sec('Chart'))
    body.append(fr('Type', sel([['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie']], n.attrs.kind, v => set('kind', v))))
    body.append(fr('Title', txt(n.attrs.title, v => set('title', v))))
    body.append(sw('Legend', !!n.attrs.legend, v => set('legend', v)))
    const r = h('input', { type: 'range', min: '20', max: '100', step: '5', value: String(n.attrs.width) }) as HTMLInputElement
    r.addEventListener('change', () => set('width', +r.value))
    body.append(fr('Width', h('div', { class: 'fr' }, r, h('span', { class: 'mute' }, n.attrs.width + '%'))))
    body.append(fr('Shape', sel([['0.42', 'Wide'], ['0.56', 'Standard'], ['0.75', 'Tall'], ['0.62', 'Square-ish']], String(n.attrs.ratio), v => set('ratio', +v))))
    body.append(fr('Align', seg([['left', icon('alignl'), 'Left'], ['center', icon('alignc'), 'Center'], ['right', icon('alignr'), 'Right']], n.attrs.align, v => set('align', v))))
    body.append(h('button', { onclick: () => el.dispatchEvent(new CustomEvent('ca-chart', { detail: pos })) }, icon('edit'), 'Edit data…'))
    body.append(h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Delete chart'))
  }

  const footnoteSec = (pos: number) => {
    const n = ed.state.doc.nodeAt(pos)!
    const set = (k: string, v: any) => ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, k, v))
    body.append(sec(n.attrs.kind === 'end' ? 'Endnote' : 'Footnote'))
    const a = area(n.attrs.text, v => set('text', v))
    body.append(a)
    body.append(fr('Type', seg([['foot', 'Footnote'], ['end', 'Endnote']], n.attrs.kind, v => set('kind', v))))
    body.append(h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Delete note'))
    setTimeout(() => a.focus(), 0)
  }

  const xrefSec = (pos: number) => {
    const n = ed.state.doc.nodeAt(pos)!
    const set = (k: string, v: any) => ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, k, v))
    const ts = allTargets(ed)
    const tg = ts.find(t => t.id === n.attrs.target)
    body.append(sec('Cross-reference'))
    body.append(fr('Target', sel([...(tg ? [] : [['', 'Missing target'] as Opt]), ...ts.map(t => [t.id, `${kindName(t.kind)} · ${t.num ? t.num + ' ' : ''}${t.text}`.slice(0, 60)] as Opt)], tg ? tg.id : '', v => v && set('target', v))))
    body.append(fr('Show', sel([['text', 'Text'], ['number', 'Number'], ['page', 'Page number'], ['textpage', 'Text and page']], n.attrs.show, v => set('show', v))))
    body.append(h('div', { class: 'hint' }, 'Reads as: ' + xrefText(tg, n.attrs.show, dv.layout?.idPage[n.attrs.target]).text))
    body.append(h('div', { class: 'fr' },
      h('button', { onclick: () => el.dispatchEvent(new CustomEvent('ca-follow', { detail: '#' + n.attrs.target })) }, icon('right'), 'Go to target'),
      h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Delete')))
  }

  const bookmarkSec = (pos: number) => {
    const n = ed.state.doc.nodeAt(pos)!
    body.append(sec('Bookmark'))
    body.append(fr('Name', txt(n.attrs.name, v => ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, 'name', v || 'Bookmark')))))
    body.append(h('p', { class: 'hint' }, 'Link to this spot from anywhere in the document with Insert link or a cross-reference.'))
    body.append(h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Delete bookmark'))
  }

  const tocSec = (pos: number) => {
    const n = ed.state.doc.nodeAt(pos)!
    const set = (k: string, v: any) => ed.view.dispatch(ed.state.tr.setNodeAttribute(pos, k, v))
    body.append(sec('Table of contents'))
    body.append(fr('Title', txt(n.attrs.title, v => set('title', v))))
    body.append(fr('Levels', seg([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], String(n.attrs.levels), v => set('levels', +v))))
    body.append(h('p', { class: 'hint' }, 'Entries and page numbers update automatically as you edit. Every entry links to its heading in the PDF and Word exports.'))
    body.append(h('button', { class: 'danger', onclick: () => ed.chain().focus().deleteSelection().run() }, icon('trash'), 'Delete table of contents'))
  }

  const hfRow = (v: HF, on: (v: HF) => void) => h('div', { class: 'hfrow' },
    txt(v.left, x => on({ ...v, left: x }), 'Left'), txt(v.center, x => on({ ...v, center: x }), 'Centre'), txt(v.right, x => on({ ...v, right: x }), 'Right'))

  const pageTab = () => {
    const s = settingsOf(ed)
    const u = s.units
    body.append(sec('Layout'))
    body.append(seg([['pages', 'Pages'], ['continuous', 'Single long page']], s.layout, v => setSettings(ed, { layout: v as any })))
    body.append(sec('Paper'))
    body.append(fr('Size', sel([...Object.keys(PAGE_SIZES).map(k => [k, k] as Opt), ['Custom', 'Custom']], s.size, v => {
      if (v === 'Custom') setSettings(ed, { size: 'Custom' })
      else { const [w, hh] = PAGE_SIZES[v]; setSettings(ed, { size: v, width: w, height: hh }) }
    })))
    if (s.size === 'Custom') body.append(h('div', { class: 'g2' },
      h('label', {}, `Width (${u})`, num(ptToUnit(s.width, u), v => setSettings(ed, { width: Math.max(144, unitToPt(v, u)) }), { step: u === 'mm' ? 1 : 0.1 })),
      h('label', {}, `Height (${u})`, num(ptToUnit(s.height, u), v => setSettings(ed, { height: Math.max(144, unitToPt(v, u)) }), { step: u === 'mm' ? 1 : 0.1 }))))
    if (s.layout === 'pages') body.append(fr('Orientation', seg([['p', 'Portrait'], ['l', 'Landscape']], s.landscape ? 'l' : 'p', v => setSettings(ed, { landscape: v === 'l' }))))
    body.append(fr('Units', seg([['mm', 'mm'], ['in', 'in']], u, v => setSettings(ed, { units: v as any }))))
    body.append(fr('Background', color(s.background, v => setSettings(ed, { background: v }))))
    body.append(sec('Margins'))
    const m = s.margin
    const mi = (k: keyof typeof m, l: string) => h('label', {}, l, num(ptToUnit(m[k], u), v => setSettings(ed, { margin: { ...m, [k]: Math.max(0, unitToPt(v, u)) } }), { step: u === 'mm' ? 1 : 0.1, min: 0 }))
    body.append(h('div', { class: 'g4' }, mi('top', 'Top'), mi('bottom', 'Bottom'), mi('left', 'Left'), mi('right', 'Right')))

    body.append(sec('Header and footer'))
    body.append(h('div', { class: 'hint' }, 'Fields: {page} {pages} {title} {subtitle} {author} {section} {date}'))
    body.append(sw('Header', s.headerOn, v => setSettings(ed, { headerOn: v })))
    if (s.headerOn) body.append(hfRow(s.header, v => setSettings(ed, { header: v })))
    body.append(sw('Footer', s.footerOn, v => setSettings(ed, { footerOn: v })))
    if (s.footerOn) body.append(hfRow(s.footer, v => setSettings(ed, { footer: v })))
    if (s.layout === 'pages') {
      body.append(sw('Different first page', s.firstDifferent, v => setSettings(ed, { firstDifferent: v })))
      if (s.firstDifferent) {
        body.append(h('div', { class: 'hint' }, 'First page header'), hfRow(s.firstHeader, v => setSettings(ed, { firstHeader: v })))
        body.append(h('div', { class: 'hint' }, 'First page footer'), hfRow(s.firstFooter, v => setSettings(ed, { firstFooter: v })))
      }
      body.append(sw('Different odd and even pages', s.oddEven, v => setSettings(ed, { oddEven: v })))
      if (s.oddEven) {
        body.append(h('div', { class: 'hint' }, 'Even page header'), hfRow(s.evenHeader, v => setSettings(ed, { evenHeader: v })))
        body.append(h('div', { class: 'hint' }, 'Even page footer'), hfRow(s.evenFooter, v => setSettings(ed, { evenFooter: v })))
      }
      body.append(sec('Page numbers'))
      body.append(fr('Style', sel([['decimal', '1, 2, 3'], ['lower-roman', 'i, ii, iii'], ['upper-roman', 'I, II, III'], ['lower-alpha', 'a, b, c'], ['upper-alpha', 'A, B, C']], s.numberFormat, v => setSettings(ed, { numberFormat: v as any }))))
      body.append(fr('Start at', num(s.numberStart, v => setSettings(ed, { numberStart: Math.max(0, Math.round(v)) }), { min: 0 })))
    }
    body.append(sec('Headings'))
    body.append(sw('Number headings (1, 1.1, 1.1.1)', s.headingNumbers, v => setSettings(ed, { headingNumbers: v })))
  }

  const stylesTab = () => {
    const S = stylesOf(ed)
    body.append(sec('Styles'))
    body.append(h('p', { class: 'hint' }, 'Changing a style updates every paragraph that uses it.'))
    body.append(fr('Style', sel(STYLE_KEYS.map(k => [k, STYLE_NAMES[k]] as Opt), styleKey, v => { styleKey = v as StyleKey; render(true) })))
    const t = S.text[styleKey]
    const set = (k: string, v: any) => setStyles(ed, s => { (s.text[styleKey] as any)[k] = v })
    body.append(fr('Font', sel(fontOpts, t.font, v => set('font', v))))
    body.append(h('div', { class: 'g2' },
      h('label', {}, 'Size (pt)', num(t.size, v => set('size', Math.max(4, v)), { step: 0.5, min: 4 })),
      h('label', {}, 'Weight', sel([['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold']], String(t.weight), v => set('weight', +v)))))
    body.append(h('div', { class: 'g2' },
      h('label', {}, 'Line height', num(t.lineHeight, v => set('lineHeight', Math.max(0.8, v)), { step: 0.05, min: 0.8 })),
      h('label', {}, 'Letter spacing', num(t.tracking, v => set('tracking', v), { step: 0.01 }))))
    body.append(h('div', { class: 'g2' },
      h('label', {}, 'Space before (pt)', num(t.before, v => set('before', Math.max(0, v)), { min: 0 })),
      h('label', {}, 'Space after (pt)', num(t.after, v => set('after', Math.max(0, v)), { min: 0 }))))
    body.append(fr('Colour', color(t.color, v => set('color', v))))
    body.append(fr('Align', seg([['left', icon('alignl'), 'Left'], ['center', icon('alignc'), 'Center'], ['right', icon('alignr'), 'Right'], ['justify', icon('alignj'), 'Justify']], t.align, v => set('align', v))))
    body.append(sw('Italic', t.italic, v => set('italic', v)))
    body.append(sw('All caps', t.caps, v => set('caps', v)))
    body.append(h('button', { onclick: () => setStyles(ed, s => { s.text[styleKey] = defaultStyles().text[styleKey] }) }, 'Reset this style'))
    body.append(sec('Colours'))
    const c = (l: string, k: 'accent' | 'link' | 'grid' | 'tableHead' | 'calloutBg') => fr(l, color(S[k], v => setStyles(ed, s => { s[k] = v })))
    body.append(c('Accent', 'accent'), c('Links', 'link'), c('Table lines', 'grid'), c('Table header', 'tableHead'), c('Callouts', 'calloutBg'))
  }

  const docTab = () => {
    const m = doc.meta
    const set = (k: keyof typeof m, v: any) => { (m as any)[k] = v; onMeta(); dv.refreshFrames() }
    body.append(sec('Details'))
    body.append(fr('Title', txt(m.title, v => set('title', v || 'Untitled document'))))
    body.append(fr('Subtitle', txt(m.subtitle, v => set('subtitle', v))))
    body.append(fr('Author', txt(m.author, v => set('author', v))))
    body.append(fr('Subject', txt(m.subject, v => set('subject', v))))
    body.append(fr('Keywords', txt(m.keywords, v => set('keywords', v), 'Comma separated')))
    body.append(fr('Status', sel([['draft', 'Draft'], ['review', 'In review'], ['final', 'Final']], m.status, v => set('status', v as DocStatus))))
    body.append(h('p', { class: 'hint' }, 'These details are written into exported PDF and Word files.'))
    const st = docStats(ed.state.doc)
    body.append(sec('Statistics'))
    body.append(h('div', { class: 'stat' },
      h('span', {}, 'Pages'), h('span', {}, String(dv.layout?.pages.length || 0)),
      h('span', {}, 'Words'), h('span', {}, st.words.toLocaleString()),
      h('span', {}, 'Characters'), h('span', {}, st.chars.toLocaleString()),
      h('span', {}, 'Images'), h('span', {}, String(st.figs)),
      h('span', {}, 'Tables'), h('span', {}, String(st.tables)),
      h('span', {}, 'Notes'), h('span', {}, String(st.notes)),
      h('span', {}, 'Created'), h('span', {}, new Date(m.created).toLocaleDateString()),
      h('span', {}, 'Modified'), h('span', {}, relTime(m.modified))))
  }

  drawTabs()
  return {
    el,
    render,
    setTab(t: string) { tab = t; drawTabs(); render(true) },
    get tab() { return tab }
  }
}

export function kindName(k: string) {
  return ({ heading: 'Heading', figure: 'Figure', table: 'Table', bookmark: 'Bookmark', footnote: 'Footnote', endnote: 'Endnote', toc: 'Contents', caption: 'Caption' } as any)[k] || k
}

export function describeHref(href: string) {
  if (href.startsWith('#page=')) return 'Page ' + href.slice(6)
  if (href.startsWith('#')) return 'In this document'
  if (href.startsWith('mailto:')) return 'Email ' + href.slice(7)
  if (href.startsWith('tel:')) return 'Call ' + href.slice(4)
  return href
}

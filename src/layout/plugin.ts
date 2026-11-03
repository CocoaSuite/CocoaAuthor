import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { defaultSettings, type PageSettings } from '../model/types'
import { alpha, roman, esc } from '../util'

export type Spacer = { kind: 'w' | 'i' | 'row'; pos: number; h: number }
export type Brk = { index: number; h: number }

export interface LayoutInfo {
  idPage: Record<string, string>
  tocBreaks: Record<string, Brk[]>
  endBreaks: Brk[]
  pages: number
}

export interface Target { id: string; kind: 'heading' | 'figure' | 'table' | 'bookmark' | 'footnote' | 'endnote' | 'toc' | 'caption'; text: string; num: string; level?: number }

interface LState { spacers: Spacer[]; info: LayoutInfo; deco: DecorationSet; targets: Map<string, Target> }

export const layoutKey = new PluginKey<LState>('caLayout')
export const emptyInfo = (): LayoutInfo => ({ idPage: {}, tocBreaks: {}, endBreaks: [], pages: 0 })

const BULLETS = ['•', '◦', '▪']

export function getSettings(doc: PMNode): PageSettings {
  return { ...defaultSettings(), ...(doc.attrs.settings || {}) }
}

export function textOf(n: PMNode) {
  let s = ''
  n.descendants(c => { if (c.isText) s += c.text; else if (c.type.name === 'hardBreak') s += ' ' })
  return s.trim()
}

export function collectTargets(doc: PMNode, s = getSettings(doc)) {
  const t = new Map<string, Target>()
  const hc = [0, 0, 0, 0]
  let fig = 0, tab = 0, fn = 0, en = 0
  doc.descendants(n => {
    const ty = n.type.name
    if (ty === 'heading') {
      const l = n.attrs.level - 1
      hc[l]++
      for (let i = l + 1; i < 4; i++) hc[i] = 0
      const num = s.headingNumbers ? hc.slice(0, l + 1).map(x => x || 1).join('.') : ''
      if (n.attrs.id) t.set(n.attrs.id, { id: n.attrs.id, kind: 'heading', text: textOf(n), num, level: n.attrs.level })
    } else if (ty === 'paragraph' && n.attrs.kind === 'caption') {
      const lb = n.attrs.label
      const num = lb === 'figure' ? 'Figure ' + ++fig : lb === 'table' ? 'Table ' + ++tab : ''
      if (n.attrs.id) t.set(n.attrs.id, { id: n.attrs.id, kind: lb === 'figure' ? 'figure' : lb === 'table' ? 'table' : 'caption', text: textOf(n), num })
    } else if (ty === 'bookmark') {
      t.set(n.attrs.id, { id: n.attrs.id, kind: 'bookmark', text: n.attrs.name, num: '' })
    } else if (ty === 'footnote') {
      const end = n.attrs.kind === 'end'
      const num = end ? roman(++en) : String(++fn)
      t.set(n.attrs.id, { id: n.attrs.id, kind: end ? 'endnote' : 'footnote', text: n.attrs.text, num })
    } else if (ty === 'toc' && n.attrs.id) {
      t.set(n.attrs.id, { id: n.attrs.id, kind: 'toc', text: n.attrs.title, num: '' })
    }
  })
  return t
}

export function xrefText(tg: Target | undefined, show: string, page: string | undefined): { text: string; broken: boolean } {
  if (!tg) return { text: '[missing reference]', broken: true }
  const pg = page || '?'
  const label = tg.kind === 'heading' ? (tg.num ? 'Section ' + tg.num : tg.text)
    : tg.kind === 'footnote' || tg.kind === 'endnote' ? 'note ' + tg.num
    : tg.num || tg.text
  switch (show) {
    case 'number': return { text: label, broken: false }
    case 'page': return { text: pg, broken: false }
    case 'textpage': return { text: `${tg.kind === 'heading' || tg.kind === 'bookmark' || tg.kind === 'toc' ? tg.text : label}, page ${pg}`, broken: false }
    default: return { text: tg.kind === 'footnote' || tg.kind === 'endnote' ? label : (tg.kind === 'figure' || tg.kind === 'table') ? (tg.text ? `${tg.num}: ${tg.text}` : tg.num) : tg.text || label, broken: false }
  }
}

function widget(pos: number, cls: string, text: string, key: string, side = -1, abs = false) {
  return Decoration.widget(pos, () => {
    const s = document.createElement('span')
    s.className = cls
    s.contentEditable = 'false'
    if (abs) s.dataset.abs = ''
    s.textContent = text
    return s
  }, { side, key, ignoreSelection: true })
}

function build(doc: PMNode, spacers: Spacer[], info: LayoutInfo, targets: Map<string, Target>): DecorationSet {
  const s = getSettings(doc)
  const d: Decoration[] = []
  const hc = [0, 0, 0, 0]
  let fig = 0, tab = 0, fn = 0, en = 0
  const endnotes: { id: string; text: string; num: string }[] = []
  const tocs: { pos: number; node: PMNode }[] = []
  const headings: { id: string; text: string; num: string; level: number }[] = []

  const walk = (node: PMNode, start: number, depth: number) => {
    node.forEach((c, off) => {
      const pos = start + off
      const ty = c.type.name
      if (ty === 'bulletList' || ty === 'orderedList') {
        const ordered = ty === 'orderedList'
        let i = (ordered ? (c.attrs.start ?? 1) : 1) - 1
        c.forEach((li, lo) => {
          i++
          const lp = pos + 1 + lo
          const first = li.firstChild
          if (first && first.isTextblock) {
            const lv = depth % 3
            const mk = ordered ? (lv === 0 ? i + '.' : lv === 1 ? alpha(i) + '.' : roman(i) + '.') : BULLETS[lv]
            d.push(widget(lp + 2, 'ca-mk' + (ordered ? ' o' : ''), mk, `mk:${mk}:${depth}`, -1, true))
          }
          walk(li, lp + 1, depth + 1)
        })
        return
      }
      if (ty === 'heading') {
        const l = c.attrs.level - 1
        hc[l]++
        for (let k = l + 1; k < 4; k++) hc[k] = 0
        const num = s.headingNumbers ? hc.slice(0, l + 1).map(x => x || 1).join('.') : ''
        if (num) d.push(widget(pos + 1, 'ca-hn', num, 'hn:' + num))
        headings.push({ id: c.attrs.id, text: textOf(c), num, level: c.attrs.level })
      } else if (ty === 'paragraph' && c.attrs.kind === 'caption' && (c.attrs.label === 'figure' || c.attrs.label === 'table')) {
        const lbl = (c.attrs.label === 'figure' ? 'Figure ' + ++fig : 'Table ' + ++tab) + (c.content.size ? ': ' : '')
        d.push(widget(pos + 1, 'ca-cl', lbl, 'cl:' + lbl))
      } else if (ty === 'toc') {
        tocs.push({ pos, node: c })
      }
      if (c.isTextblock) {
        c.forEach((ic, io) => {
          const ip = pos + 1 + io
          const it = ic.type.name
          if (it === 'footnote') {
            const end = ic.attrs.kind === 'end'
            const num = end ? roman(++en) : String(++fn)
            if (end) endnotes.push({ id: ic.attrs.id, text: ic.attrs.text, num })
            d.push(Decoration.node(ip, ip + ic.nodeSize, {}, { fn: num }))
          } else if (it === 'xref') {
            const tg = targets.get(ic.attrs.target)
            d.push(Decoration.node(ip, ip + ic.nodeSize, {}, { xref: xrefText(tg, ic.attrs.show, info.idPage[ic.attrs.target]) }))
          }
        })
      } else if (!c.isAtom && c.childCount) walk(c, pos + 1, depth)
    })
  }
  walk(doc, 0, 0)

  for (const t of tocs) {
    const lv = t.node.attrs.levels || 3
    const entries = headings.filter(x => x.level <= lv).map(x => ({ ...x, page: info.idPage[x.id] || '' }))
    d.push(Decoration.node(t.pos, t.pos + t.node.nodeSize, {}, { toc: { entries, breaks: info.tocBreaks[t.node.attrs.id] || [] } }))
  }

  if (endnotes.length) {
    const pos = doc.content.size - 1
    const br = new Map(info.endBreaks.map(b => [b.index, b.h]))
    const key = 'en:' + JSON.stringify([endnotes, info.endBreaks])
    d.push(Decoration.widget(pos, () => {
      const w = document.createElement('div')
      w.className = 'ca-endnotes'
      w.contentEditable = 'false'
      let html = br.has(-1) ? `<div class="ca-sp" style="height:${br.get(-1)}px"></div>` : ''
      html += `<div class="ca-ent">Notes</div>`
      endnotes.forEach((e, i) => {
        if (br.has(i)) html += `<div class="ca-sp" style="height:${br.get(i)}px"></div>`
        html += `<div class="ca-en k-footnote" id="fn-${e.id}"><a class="ca-enn" href="#fnr-${e.id}">${e.num}</a><span>${esc(e.text)}</span></div>`
      })
      w.innerHTML = html
      return w
    }, { side: 1, key, ignoreSelection: true }))
  }

  const max = doc.content.size
  for (const sp of spacers) {
    if (sp.pos < 0 || sp.pos > max) continue
    if (sp.kind === 'row') {
      const n = doc.nodeAt(sp.pos)
      if (n?.type.name === 'tableRow') d.push(Decoration.node(sp.pos, sp.pos + n.nodeSize, { class: 'ca-rowbrk', style: `--pgb:${sp.h}px` }))
      continue
    }
    const inline = sp.kind === 'i'
    d.push(Decoration.widget(sp.pos, () => {
      const e = document.createElement(inline ? 'span' : 'div')
      e.className = inline ? 'ca-sp ca-spi' : 'ca-sp'
      e.style.height = sp.h + 'px'
      e.contentEditable = 'false'
      return e
    }, { side: inline ? -1 : -1, key: `sp:${sp.kind}:${sp.h.toFixed(2)}`, ignoreSelection: true, marks: [] }))
  }
  return DecorationSet.create(doc, d)
}

export function layoutPlugin() {
  return new Plugin<LState>({
    key: layoutKey,
    state: {
      init(_c, st) {
        const info = emptyInfo()
        const targets = collectTargets(st.doc)
        return { spacers: [], info, targets, deco: build(st.doc, [], info, targets) }
      },
      apply(tr, prev, _o, ns) {
        const meta = tr.getMeta(layoutKey) as { spacers?: Spacer[]; info?: LayoutInfo } | undefined
        if (!meta && !tr.docChanged) return prev
        let { spacers, info } = prev
        if (meta) {
          if (meta.spacers) spacers = meta.spacers
          if (meta.info) info = meta.info
        } else {
          spacers = spacers.map(s => ({ ...s, pos: tr.mapping.map(s.pos, s.kind === 'i' ? 1 : -1) }))
        }
        const targets = tr.docChanged ? collectTargets(ns.doc) : prev.targets
        return { spacers, info, targets, deco: build(ns.doc, spacers, info, targets) }
      }
    },
    props: {
      decorations(st) { return layoutKey.getState(st)!.deco }
    }
  })
}

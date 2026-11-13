// Joins the left bars of consecutive paragraphs: a small block fills the gap between them.
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

interface Join { pos: number; w: number; h: number; color: string }
export const barKey = new PluginKey<{ joins: Join[]; deco: DecorationSet }>('caBars')

const build = (doc: any, joins: Join[]) => DecorationSet.create(doc, joins.filter(j => j.pos <= doc.content.size).map(j => Decoration.widget(j.pos, () => {
  const s = document.createElement('span')
  s.className = 'ca-barx'
  s.dataset.abs = ''
  s.contentEditable = 'false'
  s.style.cssText = `left:${-j.w}px;width:${j.w}px;height:${j.h}px;background:${j.color}`
  return s
}, { side: 1, key: `bj${j.w}-${Math.round(j.h * 10)}-${j.color}`, ignoreSelection: true, marks: [] })))

export function barPlugin() {
  return new Plugin({
    key: barKey,
    state: {
      init: () => ({ joins: [] as Join[], deco: DecorationSet.empty }),
      apply(tr, v, _o, ns) {
        const m = tr.getMeta(barKey) as Join[] | undefined
        if (m) return { joins: m, deco: build(ns.doc, m) }
        if (!tr.docChanged) return v
        return { joins: v.joins.map(j => ({ ...j, pos: tr.mapping.map(j.pos) })), deco: v.deco.map(tr.mapping, tr.doc) }
      }
    },
    props: { decorations: st => barKey.getState(st)?.deco }
  })
}

/** Measure the gaps between barred paragraphs that follow each other and fill them. Gaps across a page break are left open. */
export function applyBarJoins(view: EditorView, scale: number) {
  const out: Join[] = []
  const same = (a: any, b: any) => a.barW === b.barW && (a.barColor || '') === (b.barColor || '') && (a.left || 0) === (b.left || 0)
  view.state.doc.descendants((n, pos) => {
    if (n.isTextblock) return false
    let prev: { node: any; pos: number } | null = null
    n.forEach((ch, off) => {
      const p = pos + 1 + off
      if (prev && ch.isTextblock && prev.node.isTextblock && ch.attrs.barW && same(prev.node.attrs, ch.attrs)) {
        const a = view.nodeDOM(prev.pos) as HTMLElement | null, b = view.nodeDOM(p) as HTMLElement | null
        if (a?.getBoundingClientRect && b?.getBoundingClientRect) {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
          const gap = (rb.top - ra.bottom) / scale
          const want = parseFloat(getComputedStyle(a).marginBottom) + parseFloat(getComputedStyle(b).marginTop)
          if (gap > 0.2 && gap <= want + 1) out.push({ pos: prev.pos + prev.node.nodeSize - 1, w: ch.attrs.barW, h: gap, color: ch.attrs.barColor || 'var(--accent)' })
        }
      }
      prev = { node: ch, pos: p }
    })
    return true
  }, )
  const cur = barKey.getState(view.state)?.joins || []
  const eq = cur.length === out.length && cur.every((j, i) => j.pos === out[i].pos && j.w === out[i].w && Math.abs(j.h - out[i].h) < 0.3 && j.color === out[i].color)
  if (!eq) view.dispatch(view.state.tr.setMeta(barKey, out).setMeta('addToHistory', false))
}

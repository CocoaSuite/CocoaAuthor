import type { Editor } from '@tiptap/core'
import { h } from '../util'
import { modal, toast } from './dialogs'
import { openFile } from '../storage/store'
import { parseCSV, rowsToChart, chartToRows, rowsToCSV, chartURL, type ChartKind, type ChartData } from '../editor/chart'

const KINDS: [ChartKind, string][] = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie']]

export function csvDialog(ed: Editor, editPos?: number) {
  const editing = editPos != null ? ed.state.doc.nodeAt(editPos) : null
  let mode: 'table' | 'chart' = editing ? 'chart' : 'table'
  let kind: ChartKind = (editing?.attrs.kind as ChartKind) || 'column'
  const ta = h('textarea', { placeholder: 'Paste CSV here, or choose a file.\n\nMonth,Reach,Engagement\nJan,1200,340\nFeb,1650,410', spellcheck: 'false', style: { minHeight: '140px', fontFamily: 'var(--mono)', fontSize: '12px' } }) as HTMLTextAreaElement
  if (editing) ta.value = rowsToCSV(chartToRows(editing.attrs as ChartData))
  const title = h('input', { type: 'text', placeholder: 'Chart title (optional)', value: editing?.attrs.title || '' }) as HTMLInputElement
  const header = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement
  const legend = h('input', { type: 'checkbox', checked: editing ? !!editing.attrs.legend : true }) as HTMLInputElement
  const caption = h('input', { type: 'checkbox', checked: !editing }) as HTMLInputElement
  const preview = h('div', { class: 'csvprev' })
  const opts = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } })
  const modeSeg = h('div', { class: 'seg' })
  const kindSeg = h('div', { class: 'seg' })

  const rows = () => parseCSV(ta.value)
  const chart = (): ChartData => ({ ...rowsToChart(rows(), kind, title.value.trim()), legend: legend.checked })

  const drawPreview = () => {
    preview.innerHTML = ''
    const r = rows()
    if (!r.length) { preview.append(h('div', { class: 'hint' }, 'Nothing to preview yet.')); return }
    if (mode === 'chart') {
      const d = chart()
      if (!d.series.length || d.series.every(s => s.values.every(v => isNaN(v)))) { preview.append(h('div', { class: 'hint' }, 'Charts need labels in the first column and numbers in the other columns.')); return }
      preview.append(h('img', { src: chartURL(d), alt: 'Chart preview', style: { width: '100%', display: 'block', borderRadius: '4px' } }))
    } else {
      const t = h('table', {})
      r.slice(0, 8).forEach((row, i) => t.append(h('tr', {}, ...row.slice(0, 8).map(c => h(i === 0 && header.checked ? 'th' : 'td', {}, c)))))
      preview.append(t)
      if (r.length > 8) preview.append(h('div', { class: 'hint' }, `${r.length} rows × ${r[0].length} columns`))
    }
  }

  const drawOpts = () => {
    modeSeg.innerHTML = ''
    if (!editing) for (const [k, l] of [['table', 'Table'], ['chart', 'Chart']] as const) modeSeg.append(h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; drawOpts(); drawPreview() } }, l))
    kindSeg.innerHTML = ''
    for (const [k, l] of KINDS) kindSeg.append(h('button', { class: kind === k ? 'on' : '', onclick: () => { kind = k; drawOpts(); drawPreview() } }, l))
    opts.innerHTML = ''
    if (mode === 'table') opts.append(h('label', { class: 'chk' }, header, 'First row is a header'))
    else opts.append(kindSeg, title, h('label', { class: 'chk' }, legend, 'Show legend'))
    if (!editing) opts.append(h('label', { class: 'chk' }, caption, 'Add a numbered caption'))
  }

  for (const e of [ta, title]) e.addEventListener('input', drawPreview)
  for (const e of [header, legend]) e.addEventListener('change', drawPreview)

  const pick = async () => {
    const f = await openFile(['.csv', '.tsv', '.txt'])
    if (!f) return
    ta.value = new TextDecoder().decode(f.data).replace(/^﻿/, '')
    if (!title.value && mode === 'chart') title.value = f.name.replace(/\.[^.]+$/, '')
    drawPreview()
  }

  const insert = () => {
    const r = rows()
    if (!r.length) { toast('Add some CSV data first.'); return }
    if (mode === 'chart') {
      const d = chart()
      if (!d.series.length) { toast('Charts need at least one column of numbers.'); return }
      if (editing) { ed.view.dispatch(ed.state.tr.setNodeMarkup(editPos!, undefined, { ...editing.attrs, ...d })); m.close(); return }
      ed.chain().focus().insertContent([{ type: 'chart', attrs: d }, ...(caption.checked ? [{ type: 'paragraph', attrs: { kind: 'caption', label: 'figure' }, content: d.title ? [{ type: 'text', text: d.title }] : [] }] : [])]).run()
    } else {
      const cell = (v: string, head: boolean) => ({ type: head ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: v ? [{ type: 'text', text: v }] : [] }] })
      const table = { type: 'table', content: r.map((row, i) => ({ type: 'tableRow', content: row.map(v => cell(v, i === 0 && header.checked)) })) }
      ed.chain().focus().insertContent([...(caption.checked ? [{ type: 'paragraph', attrs: { kind: 'caption', label: 'table' } }] : []), table]).run()
    }
    m.close()
  }

  drawOpts()
  drawPreview()
  const m = modal(editing ? 'Edit chart' : 'Table or chart from CSV', [
    modeSeg,
    h('div', { class: 'fr', style: { justifyContent: 'space-between' } }, h('span', { class: 'hint' }, editing ? 'Edit the data below.' : 'First column: labels. Other columns: values.'), h('button', { onclick: pick }, 'Choose file…')),
    ta, opts, preview,
    h('div', { class: 'row' }, h('button', { onclick: () => m.close() }, 'Cancel'), h('button', { class: 'pri', onclick: insert }, editing ? 'Update' : 'Insert'))
  ], { wide: true })
}

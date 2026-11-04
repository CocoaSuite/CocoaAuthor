export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie'
export interface ChartData { kind: ChartKind; title: string; labels: string[]; series: { name: string; values: number[] }[]; legend: boolean; ratio: number }

export const PALETTE = ['#1f3a66', '#5b8bd6', '#c9a24a', '#2f7d5b', '#b5651d', '#8a5bb5', '#5b6472', '#d06a7a']
const FONT = 'Inter, Helvetica, Arial, sans-serif'
const W = 1600

const x = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function nice(max: number, min: number) {
  const span = Math.max(1e-9, max - min)
  const step0 = span / 5
  const p = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= step0)!
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step }
}

const fmt = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1e9) return +(v / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return +(v / 1e6).toFixed(1) + 'M'
  if (a >= 1e4) return +(v / 1e3).toFixed(1) + 'k'
  return String(+v.toFixed(2))
}

export function chartSVG(d: ChartData): string {
  const H = Math.round(W * (d.ratio || 0.56))
  const fs = 30
  let out = ''
  let top = 30
  if (d.title) { out += `<text x="${W / 2}" y="${top + 34}" text-anchor="middle" font-size="40" font-weight="600" fill="#1d1d1f">${x(d.title)}</text>`; top += 70 }
  const series = d.series.length ? d.series : [{ name: '', values: [] }]
  const showLegend = d.legend && (d.kind === 'pie' ? d.labels.length > 0 : series.length > 1 || !!series[0].name)
  const legendH = showLegend ? 70 : 0
  const bottom = H - legendH - 20
  const color = (i: number) => PALETTE[i % PALETTE.length]

  if (d.kind === 'pie') {
    const vals = series[0].values.map(v => Math.max(0, v || 0))
    const total = vals.reduce((a, b) => a + b, 0) || 1
    const r = Math.min(W * 0.32, (bottom - top) / 2 - 10)
    const cx = W / 2, cy = top + (bottom - top) / 2
    let a0 = -Math.PI / 2
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2
      if (v > 0) {
        const large = a1 - a0 > Math.PI ? 1 : 0
        const p = (a: number, rr = r) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
        out += v >= total ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>` : `<path d="M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)} Z" fill="${color(i)}" stroke="#fff" stroke-width="4"/>`
        const pct = Math.round((v / total) * 100)
        if (pct >= 4) { const m = (a0 + a1) / 2; const [tx, ty] = p(m, r * 0.68).split(','); out += `<text x="${tx}" y="${+ty + 11}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="#fff">${pct}%</text>` }
      }
      a0 = a1
    })
  } else {
    const all = series.flatMap(s => s.values).filter(v => isFinite(v))
    const n = nice(Math.max(0, ...all, 1), Math.min(0, ...all))
    const horiz = d.kind === 'bar'
    const left = horiz ? 40 + Math.min(360, Math.max(80, ...d.labels.map(l => String(l).length * 16))) : 130
    const right = W - 50
    const plotTop = top + 10, plotBot = bottom - (horiz ? 50 : 60)
    const val = (v: number) => (v - n.lo) / (n.hi - n.lo || 1)
    for (let t = n.lo; t <= n.hi + n.step / 2; t += n.step) {
      if (horiz) {
        const px = left + val(t) * (right - left)
        out += `<line x1="${px}" y1="${plotTop}" x2="${px}" y2="${plotBot}" stroke="#e1e4e9" stroke-width="2"/><text x="${px}" y="${plotBot + 40}" text-anchor="middle" font-size="${fs}" fill="#5b6472">${fmt(t)}</text>`
      } else {
        const py = plotBot - val(t) * (plotBot - plotTop)
        out += `<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="#e1e4e9" stroke-width="2"/><text x="${left - 16}" y="${py + 10}" text-anchor="end" font-size="${fs}" fill="#5b6472">${fmt(t)}</text>`
      }
    }
    const cats = Math.max(1, d.labels.length, ...series.map(s => s.values.length))
    const band = ((horiz ? plotBot - plotTop : right - left)) / cats
    const zero = val(Math.max(n.lo, Math.min(0, n.hi)))
    if (d.kind === 'column' || d.kind === 'bar') {
      const gw = band * 0.72, bw = gw / series.length
      series.forEach((s, si) => s.values.forEach((v, ci) => {
        if (!isFinite(v)) return
        const a = Math.min(zero, val(v)), b = Math.max(zero, val(v))
        if (horiz) {
          const y0 = plotTop + ci * band + (band - gw) / 2 + si * bw
          out += `<rect x="${left + a * (right - left)}" y="${y0}" width="${Math.max(1, (b - a) * (right - left))}" height="${bw - 4}" fill="${color(si)}"/>`
        } else {
          const x0 = left + ci * band + (band - gw) / 2 + si * bw
          out += `<rect x="${x0 + 2}" y="${plotBot - b * (plotBot - plotTop)}" width="${bw - 4}" height="${Math.max(1, (b - a) * (plotBot - plotTop))}" fill="${color(si)}"/>`
        }
      }))
    } else {
      series.forEach((s, si) => {
        const pts = s.values.map((v, ci) => isFinite(v) ? [left + ci * band + band / 2, plotBot - val(v) * (plotBot - plotTop)] : null).filter(Boolean) as number[][]
        if (!pts.length) return
        if (d.kind === 'area') out += `<path d="M${pts[0][0]},${plotBot - zero * (plotBot - plotTop)} ${pts.map(p => 'L' + p.join(',')).join(' ')} L${pts[pts.length - 1][0]},${plotBot - zero * (plotBot - plotTop)} Z" fill="${color(si)}" fill-opacity="0.22"/>`
        out += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${color(si)}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`
        for (const p of pts) out += `<circle cx="${p[0]}" cy="${p[1]}" r="8" fill="${color(si)}"/>`
      })
    }
    if (horiz) {
      out += `<line x1="${left + zero * (right - left)}" y1="${plotTop}" x2="${left + zero * (right - left)}" y2="${plotBot}" stroke="#9aa1ab" stroke-width="2"/>`
      d.labels.forEach((l, i) => { out += `<text x="${left - 16}" y="${plotTop + i * band + band / 2 + 10}" text-anchor="end" font-size="${fs}" fill="#3a3f47">${x(l)}</text>` })
    } else {
      out += `<line x1="${left}" y1="${plotBot - zero * (plotBot - plotTop)}" x2="${right}" y2="${plotBot - zero * (plotBot - plotTop)}" stroke="#9aa1ab" stroke-width="2"/>`
      const every = Math.ceil(d.labels.length / Math.max(1, Math.floor((right - left) / 120)))
      d.labels.forEach((l, i) => { if (i % every === 0) out += `<text x="${left + i * band + band / 2}" y="${plotBot + 44}" text-anchor="middle" font-size="${fs}" fill="#3a3f47">${x(l)}</text>` })
    }
  }

  if (showLegend) {
    const names = d.kind === 'pie' ? d.labels : series.map(s => s.name)
    const widths = names.map(nm => 60 + String(nm).length * 17)
    let lx = Math.max(20, (W - widths.reduce((a, b) => a + b, 0)) / 2)
    const ly = H - legendH / 2 - 6
    names.forEach((nm, i) => {
      out += `<rect x="${lx}" y="${ly - 12}" width="26" height="26" rx="4" fill="${color(i)}"/><text x="${lx + 38}" y="${ly + 10}" font-size="${fs}" fill="#3a3f47">${x(nm)}</text>`
      lx += widths[i]
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="#ffffff"/>${out}</svg>`
}

export const chartURL = (d: ChartData) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(chartSVG(d))

export function parseCSV(text: string): string[][] {
  const first = text.split(/\r?\n/).find(l => l.trim()) || ''
  const counts = [',', ';', '\t'].map(d => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])
  const sep = counts[0][1] > 1 ? counts[0][0] : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"' && cell === '') q = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  const w = Math.max(0, ...rows.map(r => r.length))
  return rows.map(r => [...r.map(v => v.trim()), ...Array(w - r.length).fill('')])
}

export const toNum = (s: string) => {
  const t = String(s).replace(/[\s%$€£¥]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  const v = parseFloat(t.replace(',', '.'))
  return isFinite(v) ? v : NaN
}

export function rowsToChart(rows: string[][], kind: ChartKind, title = ''): ChartData {
  const head = rows[0] || []
  const body = rows.slice(1)
  const headerIsText = head.slice(1).some(v => isNaN(toNum(v)))
  const data = headerIsText ? body : rows
  const names = headerIsText ? head.slice(1) : head.slice(1).map((_, i) => 'Series ' + (i + 1))
  return {
    kind, title, legend: true, ratio: kind === 'pie' ? 0.62 : 0.56,
    labels: data.map(r => r[0]),
    series: names.map((nm, i) => ({ name: nm, values: data.map(r => toNum(r[i + 1])) }))
  }
}

export function chartToRows(d: ChartData): string[][] {
  return [['', ...d.series.map(s => s.name)], ...d.labels.map((l, i) => [l, ...d.series.map(s => (isFinite(s.values[i]) ? String(s.values[i]) : ''))])]
}

export const rowsToCSV = (rows: string[][]) => rows.map(r => r.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n')

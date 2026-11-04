const P: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM21 21l-4.3-4.3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M19 4h-9M14 20H5M15 4L9 20',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 21h16',
  strike: 'M16 6.5C15.3 5 13.8 4 12 4c-2.5 0-4.5 1.6-4.5 3.8c0 1.6 1 2.7 3 3.4M4 12h16M15.5 15c.6.6 1 1.3 1 2.2c0 2.2-2 3.8-4.5 3.8c-2 0-3.7-1-4.4-2.6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  unlink: 'M18.8 13.4l1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 10.6l-1.7 1.7a5 5 0 0 0 7 7l1.7-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3',
  image: 'M4 4h16v16H4zM8.5 10a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20',
  table: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  ol: 'M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  indent: 'M3 8l4 4-4 4M21 12h-10M21 6H11M21 18H11',
  outdent: 'M7 8l-4 4 4 4M21 12h-10M21 6H11M21 18H11',
  alignl: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignc: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignr: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignj: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  quote: 'M7 7h4v5c0 3-1.5 4.5-4 5M14 7h4v5c0 3-1.5 4.5-4 5',
  callout: 'M4 5h16v11H9l-5 4z',
  divider: 'M4 12h16',
  pagebreak: 'M6 3v5h12V3M6 21v-5h12v5M3 12h2M8 12h2M13 12h2M19 12h2',
  section: 'M4 4h7v16H4zM15 4h5v16h-5z',
  footnote: 'M4 18h10M4 13h7M17 4v6M15 6l2-2',
  xref: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  toc: 'M4 6h2M10 6h10M6 12h2M12 12h8M6 18h2M12 18h8',
  eye: 'M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  zin: 'M12 5v14M5 12h14',
  zout: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 12h6M9 16h6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  restore: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  left: 'M19 12H5M12 19l-7-7 7-7',
  right: 'M5 12h14M12 5l7 7-7 7',
  chev: 'M6 9l6 6 6-6',
  sidebar: 'M4 4h16v16H4zM9 4v16',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  type: 'M5 6V4h14v2M12 4v16M9 20h6',
  highlight: 'M9 11l-5 5v4h4l5-5M14 6l4 4M12 8l6-6 4 4-6 6',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5c0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  page: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  listv: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2',
  folder: 'M3 6h6l2 2h10v11H3z',
  template: 'M4 4h16v5H4zM4 13h7v7H4zM15 13h5v7h-5z',
  pdf: 'M14 3H6v18h12V7zM14 3v4h4M8.5 16v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M13 16v-4h1a2 2 0 0 1 0 4zM17.5 12h-1.6v4M15.9 14h1.4',
  word: 'M14 3H6v18h12V7zM14 3v4h4M8 12l1.2 5 1.8-4 1.8 4 1.2-5',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  levelup: 'M15 18l-6-6 6-6',
  leveldown: 'M9 18l6-6-6-6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  caption: 'M4 4h16v10H4zM4 18h10',
  chart: 'M4 20h16M7 16v-5M12 16V6M17 16v-8'
}

export function icon(name: string, title?: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('class', 'i')
  s.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', P[name] || P.file)
  s.append(p)
  if (title) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    t.textContent = title
    s.append(t)
  }
  return s
}

export const ico = (n: string) => icon(n).outerHTML

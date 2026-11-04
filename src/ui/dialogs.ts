import { h } from '../util'

let toastEl: HTMLElement | null = null
let toastT: any
export function toast(msg: string, ms = 2400) {
  if (!toastEl) { toastEl = h('div', { id: 'toast', role: 'status' }); document.body.append(toastEl) }
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toastT)
  toastT = setTimeout(() => toastEl!.classList.remove('show'), ms)
}

export interface ModalCtl { el: HTMLElement; box: HTMLElement; close(v?: any): void; done: Promise<any> }

export function modal(title: string, body: (Node | string)[], opts: { wide?: boolean; onKey?: (e: KeyboardEvent) => void } = {}): ModalCtl {
  let resolve!: (v: any) => void
  const done = new Promise(r => (resolve = r))
  const box = h('div', { class: 'box' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), ...body)
  const el = h('div', { class: 'modal' }, box)
  const close = (v?: any) => { el.remove(); document.removeEventListener('keydown', key, true); resolve(v) }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(undefined) }
    opts.onKey?.(e)
  }
  el.addEventListener('mousedown', e => { if (e.target === el) close(undefined) })
  document.addEventListener('keydown', key, true)
  document.body.append(el)
  setTimeout(() => (box.querySelector('input,select,textarea,button.pri') as HTMLElement | null)?.focus(), 20)
  return { el, box, close, done }
}

export function confirmBox(title: string, text: string, ok = 'Delete', danger = true): Promise<boolean> {
  const m = modal(title, [
    h('div', { class: 'hint' }, text),
    h('div', { class: 'row' },
      h('button', { onclick: () => m.close(false) }, 'Cancel'),
      h('button', { class: danger ? 'pri danger' : 'pri', onclick: () => m.close(true) }, ok))
  ])
  return m.done.then(v => !!v)
}

export function promptBox(title: string, label: string, value = '', ok = 'Save'): Promise<string | null> {
  const inp = h('input', { type: 'text', value }) as HTMLInputElement
  const m = modal(title, [
    h('label', { class: 'f' }, label, inp),
    h('div', { class: 'row' }, h('button', { onclick: () => m.close(null) }, 'Cancel'), h('button', { class: 'pri', onclick: () => m.close(inp.value) }, ok))
  ])
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') m.close(inp.value) })
  setTimeout(() => inp.select(), 30)
  return m.done.then(v => (v == null ? null : String(v)))
}

export type CtxItem = { label: string; icon?: Node; danger?: boolean; disabled?: boolean; run: () => void } | 'sep' | null | false
export function ctxMenu(x: number, y: number, raw: CtxItem[]) {
  document.querySelectorAll('.ctx').forEach(e => e.remove())
  const items = raw.filter(Boolean).filter((it, i, a) => it !== 'sep' || (i > 0 && a[i - 1] !== 'sep' && i < a.length - 1)) as Exclude<CtxItem, null | false>[]
  const m = h('div', { class: 'ctx', role: 'menu' })
  m.addEventListener('contextmenu', e => e.preventDefault())
  for (const it of items) {
    if (it === 'sep') { m.append(h('hr')); continue }
    m.append(h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', disabled: !!it.disabled, onmousedown: (e: Event) => e.preventDefault(), onclick: () => { m.remove(); it.run() } }, it.label))
  }
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', esc) } }
  document.addEventListener('keydown', esc)
  document.body.append(m)
  const r = m.getBoundingClientRect()
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px'
  const off = (e: Event) => { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener('mousedown', off, true) } }
  setTimeout(() => document.addEventListener('mousedown', off, true))
}

export function progressBox(title: string) {
  const bar = h('i')
  const txt = h('div', { class: 'hint' }, 'Preparing…')
  const m = modal(title, [txt, h('div', { class: 'prog' }, bar)])
  return {
    set(p: number, t?: string) { bar.style.width = Math.round(p * 100) + '%'; if (t) txt.textContent = t },
    close() { m.close() }
  }
}

export function menuBar(defs: { label: string; items: () => ({ label: string; icon?: Node; run: () => void; disabled?: boolean } | 'sep' | { header: string })[]; right?: boolean }[]): HTMLElement {
  const bar = h('div', { class: 'menus', role: 'menubar' })
  let open: HTMLElement | null = null
  const closeAll = () => { open?.classList.remove('on'); open = null }
  for (const d of defs) {
    const dd = h('div', { class: 'dd' + (d.right ? ' r' : ''), role: 'menu' })
    const mn = h('div', { class: 'mn' })
    const btn = h('button', { class: 'mt', 'aria-haspopup': 'true' }, d.label)
    const fill = () => {
      dd.innerHTML = ''
      for (const it of d.items()) {
        if (it === 'sep') dd.append(h('hr'))
        else if ('header' in it) dd.append(h('div', { class: 'lbl' }, it.header))
        else dd.append(h('button', { role: 'menuitem', disabled: !!it.disabled, onclick: () => { closeAll(); it.run() } }, it.icon || '', it.label))
      }
    }
    btn.onclick = () => {
      if (open === mn) return closeAll()
      closeAll(); fill(); mn.classList.add('on'); open = mn
    }
    btn.onmouseenter = () => { if (open && open !== mn) { closeAll(); fill(); mn.classList.add('on'); open = mn } }
    mn.append(btn, dd)
    bar.append(mn)
  }
  document.addEventListener('mousedown', e => { if (open && !open.contains(e.target as Node)) closeAll() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll() })
  return bar
}

export function dropdown(anchor: HTMLElement, items: ({ label: string; icon?: Node; run: () => void } | 'sep' | { header: string })[], right = false) {
  const r = anchor.getBoundingClientRect()
  document.querySelectorAll('.ctx').forEach(e => e.remove())
  const m = h('div', { class: 'ctx', role: 'menu' })
  for (const it of items) {
    if (it === 'sep') m.append(h('hr'))
    else if ('header' in it) m.append(h('div', { class: 'lbl', style: 'font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);padding:6px 10px 2px' }, it.header))
    else m.append(h('button', { role: 'menuitem', onclick: () => { m.remove(); it.run() } }, it.icon || '', it.label))
  }
  document.body.append(m)
  const mr = m.getBoundingClientRect()
  m.style.top = Math.min(r.bottom + 4, innerHeight - mr.height - 8) + 'px'
  m.style.left = (right ? Math.max(8, r.right - mr.width) : Math.min(r.left, innerWidth - mr.width - 8)) + 'px'
  const off = (e: Event) => { if (!m.contains(e.target as Node) && e.target !== anchor) { m.remove(); document.removeEventListener('mousedown', off, true) } }
  setTimeout(() => document.addEventListener('mousedown', off, true))
}

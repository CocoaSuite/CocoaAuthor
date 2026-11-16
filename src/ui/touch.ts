/* Touch behaviour shared with CocoaCanvas so both apps move the same way on iPad.
   Ported from CocoaCanvas editor.html: same media queries, thresholds, velocities and easing. */

/** Tablet layout: the Outline and Inspector float over the page and can be swiped away. */
export const TABLET = matchMedia('(min-width:721px) and (max-width:1100px),(min-width:721px) and (pointer:coarse)')
const BC = document.body.classList

/** Toggle a floating panel on tablets. Returns false when not in the tablet layout. */
export function tabletToggle(k: 'l' | 'r', show?: boolean): boolean {
  if (!TABLET.matches) return false
  const cls = k === 'l' ? 'lcol' : 'icol'
  if (show === undefined) BC.toggle(cls)
  else BC.toggle(cls, !show)
  return true
}

let installed = false
export function installTouch() {
  if (installed) return
  installed = true
  panelSwipe()
  swipeDownToClose()
  longPress()
}

/* ---------- tablet: drag a panel toward its edge to hide it, drag in from the page edge to bring it back; the panel follows the finger ---------- */
function panelSwipe() {
  const EDGE = 28
  const $ = (id: string) => document.getElementById(id)
  const P: Record<'l' | 'r', { id: string; cls: string; dir: number }> = { l: { id: 'outline', cls: 'lcol', dir: -1 }, r: { id: 'insp', cls: 'icol', dir: 1 } }
  type S = { k: 'l' | 'r'; m: 'hide' | 'show'; x: number; y: number; id: number; on?: boolean; w?: number; t?: [number, number][]; off?: number; el: HTMLElement }
  let S: S | null = null
  const skip = (t: Element) => t.closest('input,select,textarea,[contenteditable],.lr input,.crop-stage')
  const clr = (el: HTMLElement) => { el.style.transition = el.style.transform = el.style.opacity = el.style.visibility = '' }
  addEventListener('pointerdown', e => {
    S = null
    if (e.pointerType !== 'touch' || !TABLET.matches || !e.isPrimary) return
    const t = e.target as Element
    if (!t?.closest) return
    for (const k of ['l', 'r'] as const) {
      const p = P[k], el = $(p.id)
      if (el && !BC.contains(p.cls) && el.contains(t) && !skip(t)) { S = { k, m: 'hide', x: e.clientX, y: e.clientY, id: e.pointerId, el }; return }
    }
    const mid = $('mid')
    if (!mid || !mid.contains(t) || t.closest('#outline,#insp,.spellp,.findp')) return
    const m = mid.getBoundingClientRect()
    const k = e.clientX - m.left < EDGE ? 'l' : m.right - e.clientX < EDGE ? 'r' : null
    if (!k || !BC.contains(P[k].cls)) return
    const el = $(P[k].id)
    if (!el) return
    S = { k, m: 'show', x: e.clientX, y: e.clientY, id: e.pointerId, el }
    e.stopImmediatePropagation(); e.preventDefault()
  }, true)
  addEventListener('pointermove', e => {
    if (!S || e.pointerId !== S.id) return
    const dx = e.clientX - S.x, dy = e.clientY - S.y, p = P[S.k], el = S.el
    if (!S.on) {
      if (S.m === 'show') e.stopImmediatePropagation()
      if (Math.abs(dy) > Math.max(16, Math.abs(dx))) { if (S.m === 'hide') S = null; return }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      S.on = true; S.w = el.offsetWidth + 16; S.t = []
      el.style.transition = 'none'; el.style.visibility = 'visible'; el.style.opacity = '1'
    }
    e.stopImmediatePropagation()
    S.t!.push([e.timeStamp, e.clientX]); if (S.t!.length > 5) S.t!.shift()
    const w = S.w!, d = p.dir, off = S.m === 'hide' ? Math.max(0, Math.min(w, dx * d)) : Math.max(0, Math.min(w, w + dx * d))
    S.off = off; el.style.transform = `translateX(${off * d}px)`
  }, true)
  addEventListener('pointerup', e => {
    if (!S || e.pointerId !== S.id) return
    const s = S; S = null
    if (s.m === 'show' && !s.on) { e.stopImmediatePropagation(); return }
    if (!s.on) return
    e.stopImmediatePropagation()
    const p = P[s.k], t = s.t!, v = t.length > 1 ? (t[t.length - 1][1] - t[0][1]) / Math.max(1, t[t.length - 1][0] - t[0][0]) * p.dir : 0
    const hide = v > .35 ? true : v < -.35 ? false : s.off! > s.w! * .4
    BC.toggle(p.cls, hide); clr(s.el)
  }, true)
  addEventListener('pointercancel', () => { if (S?.on) clr(S.el); S = null }, true)
  // an edge swipe must not scroll the page underneath, or the browser cancels the pointer
  addEventListener('touchstart', e => { if (S?.m === 'show') e.preventDefault() }, { passive: false, capture: true })
  addEventListener('touchmove', e => { if (S?.on) e.preventDefault() }, { passive: false, capture: true })
}

/* ---------- uniform: on touch screens every menu, popup and window closes with a downward swipe; on tablets popups are kept 48px inside the screen ---------- */
function swipeDownToClose() {
  const SEL = '.modal .box,.ctx,.mn.on .dd,.spellp,.findp'
  const tab = () => matchMedia('(pointer:coarse) and (min-width:721px)').matches
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  const close = (el: HTMLElement) => {
    if (el.classList.contains('ctx')) return el.remove()
    if (el.classList.contains('dd')) return esc()
    if (el.classList.contains('spellp') || el.classList.contains('findp')) {
      const x = el.querySelector<HTMLElement>('[title="Close"],[aria-label="Close"],.close')
      return x ? x.click() : esc()
    }
    if (el.closest('.modal')) return esc()
  }
  // touch events, not pointer events: a scrolling menu or window cancels the pointer but still ends the touch
  let st: { el: HTMLElement; x: number; y: number; t: number } | null = null
  addEventListener('touchstart', e => {
    st = null
    if (e.touches.length !== 1) return
    const t = e.target as HTMLElement, p = e.touches[0]
    const el = t?.closest?.(SEL) as HTMLElement | null
    if (!el || t.closest('input[type=range],canvas,textarea,input,select,.crop-stage')) return
    let sc: HTMLElement | null = t
    while (sc && sc !== el.parentElement) { if (sc.scrollTop > 0) return; sc = sc.parentElement }
    st = { el, x: p.clientX, y: p.clientY, t: Date.now() }
  }, { passive: true, capture: true })
  addEventListener('touchend', e => {
    const s = st; st = null
    if (!s || e.touches.length) return
    const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y
    if (dy > 70 && dy > Math.abs(dx) * 1.5 && Date.now() - s.t < 800) close(s.el)
  }, { capture: true })
  const fit = (el: HTMLElement) => {
    if (!tab() || !el.isConnected) return
    const r = el.getBoundingClientRect(), M = 48
    let x = r.left, y = r.top
    if (r.right > innerWidth - M) x = innerWidth - M - r.width
    if (r.bottom > innerHeight - M) y = innerHeight - M - r.height
    x = Math.max(M, x); y = Math.max(M, y)
    if (Math.abs(x - r.left) > .5 || Math.abs(y - r.top) > .5) { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto' }
  }
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('ctx')) requestAnimationFrame(() => fit(n))
  }).observe(document.body, { childList: true })
}

/* ---------- long-press opens CocoaAuthor's own menu (the one right-click opens on desktop), 500 ms like CocoaCanvas ---------- */
function longPress() {
  const HOLD = 500, SLOP = 10
  let T: any = 0, p0: { x: number; y: number; t: Element } | null = null, fired = false
  const stop = () => { clearTimeout(T); T = 0; p0 = null }
  addEventListener('touchstart', e => {
    stop(); fired = false
    if (e.touches.length !== 1) return
    const t = e.target as Element, p = e.touches[0]
    if (!t?.closest || t.closest('input,textarea,select,button,.ctx,.dd,.modal,#onb,.crop-stage')) return
    p0 = { x: p.clientX, y: p.clientY, t }
    T = setTimeout(() => {
      const s = p0; stop()
      if (!s) return
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: s.x, clientY: s.y, button: 2 })
      s.t.dispatchEvent(ev)
      if (ev.defaultPrevented) { fired = true; (navigator as any).vibrate?.(10) }
    }, HOLD)
  }, { passive: true, capture: true })
  addEventListener('touchmove', e => {
    if (!p0) return
    const p = e.touches[0]
    if (e.touches.length !== 1 || Math.hypot(p.clientX - p0.x, p.clientY - p0.y) > SLOP) stop()
  }, { passive: true, capture: true })
  // the finger lifting after the menu opened must not also tap what is under it
  addEventListener('touchend', e => { stop(); if (fired) { fired = false; if (e.cancelable) e.preventDefault() } }, { passive: false, capture: true })
  addEventListener('touchcancel', () => { stop(); fired = false }, { capture: true })
  // a browser that opens its own context menu on long-press (Android) gets there first; don't open ours twice
  addEventListener('contextmenu', e => { if (e.isTrusted && p0) stop() }, true)
}

/** Two-finger pinch on the page zooms the document (and blocks Safari's page zoom). */
export function pinchZoom(el: HTMLElement, get: () => number, set: (z: number) => void) {
  let d0 = 0, z0 = 1
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e.touches); z0 = get() } }, { passive: true })
  el.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !d0) return
    e.preventDefault()
    set(z0 * dist(e.touches) / d0)
  }, { passive: false })
  el.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0 })
  for (const g of ['gesturestart', 'gesturechange']) el.addEventListener(g, e => e.preventDefault())
}

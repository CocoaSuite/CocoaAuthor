/* First launch: "hello" is written over the blurred app, then a short tutorial for this kind of device, then the blur fades.
   Same sequence, timing, sound and motion as CocoaCanvas; the steps are CocoaAuthor's own. */
import '../styles/onboard.css'
import helloSound from './assets/hello.mp3?inline'
import { store } from '../storage/store'

const KEY = 'ca-onb'
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} }
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches
const coarse = () => matchMedia('(pointer:coarse)').matches

const HELLO = { vb: '0 0 360 180', d: 'M14 132 C 34 112, 64 60, 64 34 C 64 14, 46 14, 41 38 C 36 68, 36 116, 34 148 C 41 114, 56 94, 74 94 C 91 94, 91 114, 89 134 C 88 149, 96 151, 108 144 C 121 137, 141 124, 141 109 C 141 97, 124 97, 118 111 C 111 129, 121 151, 141 149 C 161 147, 176 129, 186 109 C 201 79, 211 44, 206 29 C 201 17, 186 24, 184 54 C 182 89, 184 129, 196 147 C 206 157, 221 144, 231 124 C 246 89, 254 49, 248 29 C 242 17, 228 24, 227 54 C 225 89, 227 129, 239 147 C 249 157, 264 147, 274 131 C 281 111, 296 99, 311 101 C 331 104, 331 144, 308 149 C 288 153, 281 127, 296 109 C 304 101, 318 99, 334 104' }

const A = '#8AA7D9', AF = 'rgba(138,167,217,.16)'
const F = '<circle class="oF" r="9" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-width="2"/>'
const key = (x: number, w: number, k: string, i: number) => `<g class="oKey" style="animation-delay:${i * .45}s"><rect x="${x}" y="40" width="${w}" height="34" rx="7" fill="#262626" stroke="#555" stroke-width="1.5"/><text x="${x + w / 2}" y="63" text-anchor="middle" fill="#ddd" font-size="14" font-weight="600" font-family="system-ui,sans-serif">${k}</text></g>`

const ILL: Record<string, string> = {
  write: `<rect x="70" y="8" width="100" height="104" rx="6" fill="#f2f2f0"/><rect x="82" y="22" width="56" height="8" rx="3" fill="#333"/>${[0, 1, 2, 3].map(i => `<rect x="82" y="${42 + i * 14}" width="${[76, 70, 74, 48][i]}" height="5" rx="2.5" fill="#999"/>`).join('')}<g class="oType"><rect x="82" y="98" width="70" height="5" rx="2.5" fill="${A}"/></g>`,
  swipe: `<rect x="36" y="10" width="168" height="100" rx="12" fill="none" stroke="#555" stroke-width="2"/><g class="oSlide"><rect x="44" y="18" width="46" height="84" rx="8" fill="#2a2a2a" stroke="${A}" stroke-width="2"/>${[0, 1, 2, 3].map(i => `<rect x="51" y="${28 + i * 14}" width="30" height="5" rx="2.5" fill="#777"/>`).join('')}</g><g class="oSw">${F}</g>`,
  pinch: `<rect class="oZoom" x="95" y="35" width="50" height="50" rx="8" fill="${AF}" stroke="${A}" stroke-width="2.5"/><g class="oP1">${F}</g><g class="oP2">${F}</g>`,
  panels: `<rect x="80" y="6" width="80" height="108" rx="14" fill="none" stroke="#555" stroke-width="2"/><rect class="oSheet" x="84" y="60" width="72" height="50" rx="9" fill="#2a2a2a" stroke="${A}" stroke-width="2"/><circle class="oPulse" cx="95" cy="22" r="8" fill="none" stroke="${A}" stroke-width="2.5"/><circle class="oPulse o2" cx="145" cy="22" r="8" fill="none" stroke="${A}" stroke-width="2.5"/>`,
  down: `<g class="oDown"><rect x="70" y="14" width="100" height="74" rx="10" fill="#2a2a2a" stroke="${A}" stroke-width="2"/>${[0, 1, 2].map(i => `<rect x="82" y="${30 + i * 16}" width="${[60, 48, 70][i]}" height="6" rx="3" fill="#888"/>`).join('')}</g><g class="oDf">${F}</g>`,
  share: `<rect x="56" y="22" width="58" height="76" rx="5" fill="#f2f2f0"/><rect x="65" y="34" width="34" height="6" rx="3" fill="#333"/>${[0, 1, 2].map(i => `<rect x="65" y="${50 + i * 11}" width="${[40, 36, 28][i]}" height="4" rx="2" fill="#999"/>`).join('')}<rect x="140" y="40" width="54" height="54" rx="9" fill="none" stroke="#666" stroke-width="2"/><path class="oUp" d="M167 82V54M157 63l10-10 10 10" fill="none" stroke="${A}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  outline: `<rect x="40" y="10" width="160" height="100" rx="10" fill="none" stroke="#555" stroke-width="2"/>${[0, 1, 2, 3].map(i => `<rect x="54" y="${24 + i * 20}" width="${[90, 70, 100, 80][i]}" height="8" rx="4" fill="#666"/>`).join('')}<g class="oRow"><rect x="48" y="40" width="144" height="18" rx="5" fill="${AF}" stroke="${A}" stroke-width="2"/><rect x="54" y="45" width="70" height="8" rx="4" fill="${A}"/></g>`,
  keys: [['B', 34], ['I', 34], ['F', 34], ['H', 34], ['F7', 40]].reduce((a, [k, w], i) => ({ s: a.s + key(a.x, w as number, k as string, i), x: a.x + (w as number) + 6 }), { s: '', x: 26 }).s
}

type Step = [string, string, string]
const S: Record<'phone' | 'tablet' | 'desk', Step[]> = {
  phone: [
    ['write', 'Just start writing', 'Tap the page and type. Pick a style like Heading or Quote in the bar at the top.'],
    ['panels', 'Outline and Inspector', 'The buttons at the top open the Outline of your sections and the Inspector for styles and page setup.'],
    ['pinch', 'Pinch to zoom', 'Use two fingers on the page to zoom in and out.'],
    ['down', 'Swipe down to close', 'Every menu, popup and window closes with a quick swipe down.'],
    ['share', 'Publish anywhere', 'Export makes a PDF or Word file. Choose Save to Files or send it straight from the share sheet.']],
  tablet: [
    ['write', 'Just start writing', 'Tap the page and type. A keyboard works too: Ctrl+B, Ctrl+I, Ctrl+F and the rest.'],
    ['swipe', 'Swipe the side panels', 'Swipe Outline or Inspector toward the edge to hide it. Swipe in from the edge to bring it back.'],
    ['pinch', 'Pinch to zoom', 'Use two fingers on the page to zoom in and out.'],
    ['down', 'Swipe down to close', 'Every menu, popup and window closes with a quick swipe down.'],
    ['share', 'Publish anywhere', 'Export makes a PDF or Word file. Choose Save to Files or send it straight from the share sheet.']],
  desk: [
    ['keys', 'Shortcuts at your fingertips', 'Ctrl+B and Ctrl+I for bold and italic, Ctrl+F to find, Ctrl+H to replace and F7 for spelling.'],
    ['outline', 'Steer with the Outline', 'The Outline on the left jumps to any section. Drag a heading to move the whole section with it.'],
    ['write', 'Styles do the formatting', 'Pick Title, Heading or Quote and the Inspector on the right keeps every page consistent.'],
    ['share', 'Preview, then publish', 'Preview shows exactly what the PDF will contain. Export saves PDF, Word or a CocoaAuthor file.']]
}

const dev = () => matchMedia('(max-width:720px)').matches ? 'phone' : coarse() || navigator.maxTouchPoints > 1 && /iPad|Macintosh/.test(navigator.userAgent) ? 'tablet' : 'desk'
const wait = (ms: number) => new Promise(r => setTimeout(r, RM ? 0 : ms))

let running = false
export function runOnboarding(): Promise<void> {
  if (running) return Promise.resolve()
  running = true
  return new Promise<void>(async done => {
    const kind = dev(), steps = S[kind], w = HELLO
    const tapText = () => coarse() ? 'Tap to continue' : 'Click or press any key'
    const O = document.createElement('div')
    O.id = 'onb'; O.className = 'onb-' + kind
    O.setAttribute('role', 'dialog'); O.setAttribute('aria-modal', 'true'); O.setAttribute('aria-label', 'Welcome to CocoaAuthor')
    O.innerHTML = `<div class="onbH"><svg viewBox="${w.vb}" aria-hidden="true"><path d="${w.d}"/></svg><div class="onbTap">${tapText()}</div></div>
     <div class="onbC" hidden><div class="onbS"><div class="onbIll"><svg viewBox="0 0 240 120"></svg></div><h3></h3><p></p></div><div class="onbD">${steps.map(() => '<i></i>').join('')}</div><div class="onbR"><button class="onbSk">Skip</button><span class="sp"></span><button class="onbBk">Back</button><button class="pri onbNx"></button></div></div>`
    document.body.appendChild(O)
    const H = O.querySelector<HTMLElement>('.onbH')!, P = H.querySelector('path')!, C = O.querySelector<HTMLElement>('.onbC')!, SS = C.querySelector<HTMLElement>('.onbS')!
    let i = -1, phase = -1
    const au = new Audio(helloSound)
    const len = P.getTotalLength()
    P.style.strokeDasharray = String(len); P.style.strokeDashoffset = String(RM ? 0 : len)
    requestAnimationFrame(() => requestAnimationFrame(() => O.classList.add('on')))
    let goRes!: () => void
    const going = new Promise<void>(r => goRes = r)
    const tap = H.querySelector<HTMLElement>('.onbTap')!
    const begin = (snd: number) => {
      if (phase !== -1) return
      phase = 0
      tap.classList.remove('on')
      setTimeout(() => tap.textContent = tapText(), 700)
      if (snd === 1) { try { au.currentTime = 0; au.play()?.catch?.(() => {}) } catch {} }
      P.style.transition = RM ? '' : `stroke-dashoffset 2.9s cubic-bezier(.55,.1,.35,1) ${snd ? '.12s' : '.45s'}`
      P.style.strokeDashoffset = '0'
      goRes()
    }
    setTimeout(() => {
      let pr: Promise<void> | undefined
      try { pr = au.play() } catch {}
      if (pr?.then) {
        let ok = false
        pr.then(() => { if (phase !== -1) { au.pause(); return } ok = true; begin(2) }).catch(() => begin(0))
        setTimeout(() => { if (!ok) begin(0) }, 250)
      } else begin(0)
    }, 450)
    const show = (n: number, dir: number) => {
      const st = steps[n]
      const fill = () => {
        SS.querySelector('svg')!.innerHTML = ILL[st[0]]
        SS.querySelector('h3')!.textContent = st[1]
        SS.querySelector('p')!.textContent = st[2]
        C.querySelectorAll('.onbD i').forEach((d, k) => d.classList.toggle('on', k === n))
        C.querySelector<HTMLElement>('.onbBk')!.style.visibility = n ? 'visible' : 'hidden'
        C.querySelector('.onbNx')!.textContent = n === steps.length - 1 ? 'Start writing' : 'Next'
      }
      if (i < 0 || RM) { fill(); i = n; return }
      SS.style.setProperty('--sx', (dir > 0 ? -18 : 18) + 'px'); SS.classList.add('sw')
      setTimeout(() => { fill(); SS.style.setProperty('--sx', (dir > 0 ? 18 : -18) + 'px'); SS.style.transition = 'none'; void SS.offsetWidth; SS.style.transition = ''; SS.classList.remove('sw') }, 200)
      i = n
    }
    async function toCard() {
      if (phase) return
      phase = 1; H.classList.add('out'); await wait(380); H.remove()
      show(0, 1); C.hidden = false; void C.offsetWidth; C.classList.add('in')
      setTimeout(() => C.querySelector<HTMLElement>('.onbNx')!.focus(), 300)
    }
    async function finish() {
      if (phase === 2) return
      phase = 2; put(KEY, '1')
      C.classList.remove('in'); C.classList.add('out'); await wait(300)
      O.classList.add('clear'); await wait(950)
      O.remove(); removeEventListener('keydown', onKey, true); running = false; done()
    }
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation(); e.preventDefault()
      if (phase === -1) return begin(1)
      if (!phase) return toCard()
      if (phase !== 1) return
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') i < steps.length - 1 ? show(i + 1, 1) : finish()
      else if (e.key === 'ArrowLeft' && i > 0) show(i - 1, -1)
    }
    addEventListener('keydown', onKey, true)
    O.addEventListener('pointerdown', e => e.stopPropagation())
    O.addEventListener('click', e => {
      const t = e.target as Element
      if (phase === -1) return begin(1)
      if (!phase) return toCard()
      if (t.closest('.onbSk')) return finish()
      if (t.closest('.onbNx')) return i < steps.length - 1 ? show(i + 1, 1) : finish()
      if (t.closest('.onbBk') && i > 0) show(i - 1, -1)
    })
    let sx: number | null = null
    C.addEventListener('pointerdown', e => { sx = e.clientX })
    C.addEventListener('pointerup', e => {
      if (sx == null) return
      const dx = e.clientX - sx; sx = null
      if (Math.abs(dx) > 50) { if (dx < 0 && i < steps.length - 1) show(i + 1, 1); else if (dx > 0 && i > 0) show(i - 1, -1) }
    })
    await going; await wait(3700); if (!phase) tap.classList.add('on'); await wait(2600); if (!phase) toCard()
  })
}

/** Runs once on first launch. People who already have documents skip it. */
export async function maybeOnboard() {
  if (get(KEY)) return
  let old = false
  try { old = (await store.list()).length > 0 } catch {}
  if (old) { put(KEY, '1'); return }
  await runOnboarding()
}

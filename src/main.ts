import './styles/app.css'
import './styles/doc.css'
import './styles/pdf.css'
import { injectFonts } from './layout/fonts'
import { route } from './router'
import { renderLibrary, importData, importPicked } from './ui/library'
import { openWorkspace, type WS } from './ui/workspace'
import { native, nativeFiles } from './storage/store'
import { h } from './util'
import { installTouch } from './ui/touch'
import { maybeOnboard } from './ui/onboarding'

injectFonts()
const app = document.getElementById('app')!
let ws: WS | null = null
let busy = Promise.resolve()

const show = () => {
  busy = busy.then(async () => {
    const r = route()
    document.querySelectorAll('.ctx,.modal').forEach(e => e.remove())
    if (ws) { const w = ws; ws = null; await w.dispose() }
    if (r.name === 'doc') ws = await openWorkspace(app, r.id)
    else if (r.name === 'pdf') { const { openPdfViewer } = await import('./pdf/viewer'); ws = await openPdfViewer(app, r.id) }
    else await renderLibrary(app, r.view, r.cat)
  }).catch(e => { console.error(e) })
}
window.addEventListener('hashchange', show)
show()
installTouch()
busy.then(() => maybeOnboard())

// Desktop (Windows/Linux): the window controls sit in the right end of the top bar, as in CocoaShot.
if (native && native.platform !== 'darwin') {
  document.documentElement.classList.add('wco')
  native.onFullScreen?.(on => document.documentElement.classList.toggle('fs', on))
}

native?.onOpenFile(f => importData(f.name, new Uint8Array(f.data), nativeFiles(f.files)))

let dragN = 0
let overlay: HTMLElement | null = null
window.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types.includes('Files') || route().name !== 'library') return
  dragN++
  if (!overlay) { overlay = h('div', { class: 'drop' }, 'Drop a PDF, .cocoaauthor, Word or Markdown file to open it'); document.body.append(overlay) }
})
window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; overlay?.remove(); overlay = null } })
window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() })
window.addEventListener('drop', async e => {
  dragN = 0; overlay?.remove(); overlay = null
  if (route().name !== 'library') return
  const all = Array.from(e.dataTransfer?.files || [])
  if (!all.some(x => /\.(cocoaauthor|docx|md|markdown|zip|pdf)$/i.test(x.name))) return
  e.preventDefault()
  importPicked(await Promise.all(all.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))))
})

if (!native && 'serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}


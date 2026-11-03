import './styles/app.css'
import './styles/doc.css'
import { injectFonts } from './layout/fonts'
import { route } from './router'
import { renderLibrary, importData } from './ui/library'
import { openWorkspace, type WS } from './ui/workspace'
import { native } from './storage/store'
import { h } from './util'

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
    else await renderLibrary(app, r.view, r.cat)
  }).catch(e => { console.error(e) })
}
window.addEventListener('hashchange', show)
show()

native?.onOpenFile(f => importData(f.name, new Uint8Array(f.data)))

let dragN = 0
let overlay: HTMLElement | null = null
window.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types.includes('Files') || route().name === 'doc') return
  dragN++
  if (!overlay) { overlay = h('div', { class: 'drop' }, 'Drop a .cocoaauthor or .docx file to open it'); document.body.append(overlay) }
})
window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; overlay?.remove(); overlay = null } })
window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() })
window.addEventListener('drop', async e => {
  dragN = 0; overlay?.remove(); overlay = null
  if (route().name === 'doc') return
  const f = Array.from(e.dataTransfer?.files || []).find(x => /\.(cocoaauthor|docx)$/i.test(x.name))
  if (!f) return
  e.preventDefault()
  importData(f.name, new Uint8Array(await f.arrayBuffer()))
})

if (!native && 'serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}


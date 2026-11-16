const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const { pathToFileURL } = require('url')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

const DIST = path.join(__dirname, '..', 'dist')
const LIB = () => path.join(app.getPath('userData'), 'Library')
const safe = id => { if (!/^[\w-]{1,64}$/.test(String(id))) throw new Error('Invalid id'); return String(id) }
const docDir = id => path.join(LIB(), safe(id))

let win = null
const pendingFiles = []
const launchFiles = []

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, file)
}

const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

// Markdown refers to its images by relative path; read the ones it uses so the import can embed them.
async function markdownImages(file, text) {
  const dir = path.dirname(file)
  const refs = new Set()
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)) refs.add(m[1])
  for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) refs.add(m[1])
  for (const m of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) refs.add(m[1])
  const out = {}
  let total = 0
  for (const r of refs) {
    if (/^[a-z][\w+.-]*:/i.test(r) && !/^file:/i.test(r)) continue
    let rel = r.split(/[?#]/)[0].replace(/^file:\/\//i, '')
    try { rel = decodeURIComponent(rel) } catch {}
    if (!IMG_EXT.test(rel)) continue
    const abs = path.isAbsolute(rel) ? rel : path.resolve(dir, rel)
    try {
      const st = await fsp.stat(abs)
      if (!st.isFile() || st.size > 50e6 || total + st.size > 400e6) continue
      total += st.size
      out[rel] = ab(await fsp.readFile(abs))
    } catch {}
  }
  return out
}

async function readOpened(file) {
  try {
    const data = await fsp.readFile(file)
    const f = { name: path.basename(file), data: ab(data) }
    if (/\.(md|markdown)$/i.test(file)) f.files = await markdownImages(file, data.toString('utf8'))
    return f
  } catch { return null }
}

const isPdf = f => /\.pdf$/i.test(f)
const external = url => { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url) }

// PDFs open in their own window with Chromium's built-in viewer (zoom, search, thumbnails, rotate, print).
function openPdf(file) {
  const w = new BrowserWindow({
    width: 1100, height: 900, minWidth: 420, minHeight: 320,
    title: path.basename(file),
    backgroundColor: '#525659',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { plugins: true, contextIsolation: true, sandbox: true }
  })
  w.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' } })
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); external(url) } })
  w.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return
    const mod = i.control || i.meta
    if (mod && i.key.toLowerCase() === 'w') { e.preventDefault(); w.close() }
    else if (mod && i.key.toLowerCase() === 'o') { e.preventDefault(); pickAndOpen() }
    else if (i.key === 'F11') { e.preventDefault(); w.setFullScreen(!w.isFullScreen()) }
  })
  w.on('page-title-updated', e => e.preventDefault())
  w.loadURL(pathToFileURL(file).toString())
  w.focus()
}

async function pickAndOpen() {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documents', extensions: ['pdf', 'cocoaauthor', 'docx', 'md', 'markdown', 'zip'] }] })
  if (!r.canceled) for (const f of r.filePaths) deliver(f)
}

async function deliver(file) {
  if (isPdf(file)) { openPdf(file); return }
  if (!win) createWindow()
  const f = await readOpened(file)
  if (!f) return
  if (win && !win.webContents.isLoading()) win.webContents.send('open-file', f)
  else pendingFiles.push(f)
}

function filesFromArgv(argv) {
  return argv.slice(1).filter(a => /\.(cocoaauthor|docx|md|markdown|pdf)$/i.test(a) && fs.existsSync(a))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 760, minHeight: 520,
    title: 'CocoaAuthor',
    backgroundColor: '#121212',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); external(url) }
  })
  win.webContents.on('did-finish-load', () => { while (pendingFiles.length) win.webContents.send('open-file', pendingFiles.shift()) })
  win.loadURL('app://cocoaauthor/index.html')
  win.on('closed', () => { win = null })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    for (const f of filesFromArgv(argv)) deliver(f)
    const files = filesFromArgv(argv)
    if (!files.length && !win) createWindow()
    if (win && !files.some(isPdf)) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  app.on('open-file', (e, file) => { e.preventDefault(); if (app.isReady()) deliver(file); else launchFiles.push(file) })

  app.whenReady().then(() => {
    protocol.handle('app', req => {
      const u = new URL(req.url)
      let p = decodeURIComponent(u.pathname)
      if (p === '/' || !p) p = '/index.html'
      const file = path.normalize(path.join(DIST, p))
      if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    })
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
    } else Menu.setApplicationMenu(null)
    launchFiles.push(...filesFromArgv(process.argv))
    // Launched only to view PDFs: skip the library window.
    if (!launchFiles.length || !launchFiles.every(isPdf)) createWindow()
    for (const f of launchFiles) deliver(f)
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

ipcMain.handle('listDocs', async () => {
  await fsp.mkdir(LIB(), { recursive: true })
  const out = []
  for (const d of await fsp.readdir(LIB())) {
    try { out.push(JSON.parse(await fsp.readFile(path.join(LIB(), d, 'summary.json'), 'utf8'))) } catch {}
  }
  return out
})
ipcMain.handle('loadDoc', async (_e, id) => {
  try { return await fsp.readFile(path.join(docDir(id), 'document.json'), 'utf8') } catch { return null }
})
ipcMain.handle('saveDoc', async (_e, id, json, summary) => {
  await writeAtomic(path.join(docDir(id), 'document.json'), json)
  await writeAtomic(path.join(docDir(id), 'summary.json'), summary)
})
ipcMain.handle('deleteDoc', async (_e, id) => { await fsp.rm(docDir(id), { recursive: true, force: true }) })
ipcMain.handle('putAsset', async (_e, id, aid, data) => { await writeAtomic(path.join(docDir(id), 'assets', safe(aid)), Buffer.from(data)) })
ipcMain.handle('getAsset', async (_e, id, aid) => {
  try { const b = await fsp.readFile(path.join(docDir(id), 'assets', safe(aid))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } catch { return null }
})
ipcMain.handle('pruneAssets', async (_e, id, keep) => {
  const dir = path.join(docDir(id), 'assets')
  let list = []
  try { list = await fsp.readdir(dir) } catch { return }
  for (const f of list) if (!keep.includes(f)) await fsp.rm(path.join(dir, f), { force: true })
})
ipcMain.handle('openFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  if (r.canceled || !r.filePaths[0]) return null
  if (isPdf(r.filePaths[0])) { openPdf(r.filePaths[0]); return { name: path.basename(r.filePaths[0]), viewed: true } }
  return readOpened(r.filePaths[0])
})
// A PDF dropped or exported in the app: write it to a temp file and view it.
ipcMain.handle('viewPdf', async (_e, name, data) => {
  const dir = path.join(os.tmpdir(), 'cocoaauthor-pdf')
  const file = path.join(dir, Date.now() + '-' + String(name).replace(/[^\w .()-]/g, '_').slice(0, 120))
  await writeAtomic(file, Buffer.from(data))
  openPdf(file)
})
ipcMain.handle('viewPdfPath', async (_e, file) => { if (isPdf(file) && fs.existsSync(file)) openPdf(file) })
ipcMain.handle('saveFile', async (_e, name, data, filters) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters })
  if (r.canceled || !r.filePath) return null
  await writeAtomic(r.filePath, Buffer.from(data))
  return r.filePath
})
ipcMain.on('setTitle', (_e, t) => { if (win) win.setTitle(String(t).slice(0, 200)) })

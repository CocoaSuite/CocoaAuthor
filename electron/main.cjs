const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { pathToFileURL } = require('url')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

const DIST = path.join(__dirname, '..', 'dist')
const LIB = () => path.join(app.getPath('userData'), 'Library')
const safe = id => { if (!/^[\w-]{1,64}$/.test(String(id))) throw new Error('Invalid id'); return String(id) }
const docDir = id => path.join(LIB(), safe(id))

let win = null
const pendingFiles = []

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, file)
}

async function readOpened(file) {
  try {
    const data = await fsp.readFile(file)
    return { name: path.basename(file), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }
  } catch { return null }
}

async function deliver(file) {
  const f = await readOpened(file)
  if (!f) return
  if (win && !win.webContents.isLoading()) win.webContents.send('open-file', f)
  else pendingFiles.push(f)
}

function filesFromArgv(argv) {
  return argv.slice(1).filter(a => /\.(cocoaauthor|docx)$/i.test(a) && fs.existsSync(a))
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
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url) }
  })
  win.webContents.on('did-finish-load', () => { while (pendingFiles.length) win.webContents.send('open-file', pendingFiles.shift()) })
  win.loadURL('app://cocoaauthor/index.html')
  win.on('closed', () => { win = null })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    for (const f of filesFromArgv(argv)) deliver(f)
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  app.on('open-file', (e, file) => { e.preventDefault(); deliver(file) })

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
    for (const f of filesFromArgv(process.argv)) deliver(f)
    createWindow()
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
  return readOpened(r.filePaths[0])
})
ipcMain.handle('saveFile', async (_e, name, data, filters) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters })
  if (r.canceled || !r.filePath) return null
  await writeAtomic(r.filePath, Buffer.from(data))
  return r.filePath
})
ipcMain.on('setTitle', (_e, t) => { if (win) win.setTitle(String(t).slice(0, 200)) })

// App icon choice (Amethyst or Midnight) and the desktop shortcut.
// The choice lives in userData so the first window already opens with it.
const { app, BrowserWindow, nativeImage, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const THEMES = ['amethyst', 'midnight']
const DIR = path.join(__dirname, 'appicons')

function setupAppIcon({ name, appId }) {
  // Same ID as the installer's shortcuts, so windows group with a pinned shortcut.
  if (process.platform === 'win32') app.setAppUserModelId(appId)
  const CONF = () => path.join(app.getPath('userData'), 'appicon.json')
  let theme = 'amethyst'
  try { const t = JSON.parse(fs.readFileSync(CONF(), 'utf8')).theme; if (THEMES.includes(t)) theme = t } catch {}

  const png = () => path.join(DIR, theme + '.png')
  const image = () => nativeImage.createFromPath(png())

  // Shortcuts need a real .ico file on disk; the bundled one sits inside the app archive.
  function icoFile() {
    const out = path.join(app.getPath('userData'), 'appicons', theme + '.ico')
    try {
      const data = fs.readFileSync(path.join(DIR, theme + '.ico'))
      let same = false
      try { same = fs.readFileSync(out).equals(data) } catch {}
      if (!same) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data) }
    } catch {}
    return out
  }

  const target = () => process.execPath
  const args = () => (app.isPackaged ? '' : `"${app.getAppPath()}"`)
  const same = (a, b) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

  // The installer's Desktop, Start menu and pinned taskbar shortcuts follow the chosen icon.
  function shortcutPaths() {
    const roam = process.env.APPDATA || app.getPath('appData')
    const list = [
      path.join(app.getPath('desktop'), name + '.lnk'),
      path.join(roam, 'Microsoft', 'Windows', 'Start Menu', 'Programs', name + '.lnk'),
      path.join(roam, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', name + '.lnk')
    ]
    if (process.env.PUBLIC) list.push(path.join(process.env.PUBLIC, 'Desktop', name + '.lnk'))
    if (process.env.ProgramData) list.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', name + '.lnk'))
    return list
  }

  function updateShortcuts() {
    if (process.platform !== 'win32') return
    const icon = icoFile()
    for (const p of shortcutPaths()) {
      try {
        if (!fs.existsSync(p) || !same(shell.readShortcutLink(p).target, target())) continue
        shell.writeShortcutLink(p, 'update', { icon, iconIndex: 0 })
      } catch {} // shortcuts for all users need admin rights; leave those as they are
    }
  }

  function apply() {
    const img = image()
    for (const w of BrowserWindow.getAllWindows()) w.setIcon(img)
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(img)
    updateShortcuts()
  }

  ipcMain.handle('appIcon', () => theme)
  ipcMain.handle('setAppIcon', (_e, t) => {
    if (!THEMES.includes(t)) throw new Error('Unknown icon')
    theme = t
    fs.mkdirSync(path.dirname(CONF()), { recursive: true })
    fs.writeFileSync(CONF(), JSON.stringify({ theme }))
    apply()
    return theme
  })
  ipcMain.handle('createShortcut', () => {
    if (process.platform !== 'win32') throw new Error('Shortcuts can be created on Windows only.')
    const p = path.join(app.getPath('desktop'), name + '.lnk')
    const ok = shell.writeShortcutLink(p, fs.existsSync(p) ? 'replace' : 'create', {
      target: target(), args: args(), cwd: path.dirname(target()), description: name,
      icon: icoFile(), iconIndex: 0, appUserModelId: appId
    })
    if (!ok) throw new Error('The shortcut could not be created.')
    return p
  })

  app.whenReady().then(() => { if (process.platform === 'darwin' && app.dock) app.dock.setIcon(image()) })
  return { windowIcon: png }
}

module.exports = { setupAppIcon }

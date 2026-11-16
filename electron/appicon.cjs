// App icon choice (Amethyst or Midnight) and the desktop shortcut.
// The choice lives in userData so the first window already opens with it.
const { app, BrowserWindow, nativeImage, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

const THEMES = ['amethyst', 'midnight']
const DIR = path.join(__dirname, 'appicons')
const FILE_DIR = path.join(__dirname, 'fileicons')

// fileTypes maps the installer's file class names to icon names, e.g. { 'CocoaShot.png': 'png' }.
function setupAppIcon({ name, appId, fileTypes = {} }) {
  // Same ID as the installer's shortcuts, so windows group with a pinned shortcut.
  if (process.platform === 'win32') app.setAppUserModelId(appId)
  const CONF = () => path.join(app.getPath('userData'), 'appicon.json')
  let theme = 'amethyst'
  let conf = {}
  try { conf = JSON.parse(fs.readFileSync(CONF(), 'utf8')) || {}; if (THEMES.includes(conf.theme)) theme = conf.theme } catch {}
  const saveConf = () => {
    conf.theme = theme
    try { fs.mkdirSync(path.dirname(CONF()), { recursive: true }); fs.writeFileSync(CONF(), JSON.stringify(conf)) } catch {}
  }

  const png = () => path.join(DIR, theme + '.png')
  const image = () => nativeImage.createFromPath(png())

  // Windows needs icons as real files on disk; the bundled ones sit inside the app archive.
  function onDisk(src, out) {
    try {
      const data = fs.readFileSync(src)
      let same = false
      try { same = fs.readFileSync(out).equals(data) } catch {}
      if (!same) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data) }
    } catch {}
    return out
  }
  const icoFile = () => onDisk(path.join(DIR, theme + '.ico'), path.join(app.getPath('userData'), 'appicons', theme + '.ico'))

  // Points the file types this app registered at the chosen theme's file icons, for this
  // Windows user, then tells Explorer to redraw them. File classes the installer did not
  // register are left alone.
  const FILE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$changed = $false
foreach ($pair in ($env:COCOA_FILEICONS -split '\\|')) {
  $i = $pair.IndexOf('=')
  if ($i -lt 1) { continue }
  $id = $pair.Substring(0, $i); $ico = $pair.Substring($i + 1)
  if (-not ((Test-Path -LiteralPath "HKCU:\\Software\\Classes\\$id") -or (Test-Path -LiteralPath "HKLM:\\Software\\Classes\\$id"))) { continue }
  $k = "HKCU:\\Software\\Classes\\$id\\DefaultIcon"
  if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
  Set-Item -LiteralPath $k -Value $ico
  $changed = $true
}
if ($changed) {
  Add-Type -Namespace Cocoa -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, System.IntPtr a, System.IntPtr b);'
  [Cocoa.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}
`
  function updateFileIcons() {
    if (process.platform !== 'win32' || !Object.keys(fileTypes).length) return
    const dir = path.join(app.getPath('userData'), 'fileicons', theme)
    const pairs = Object.entries(fileTypes).map(([id, n]) => id + '=' + onDisk(path.join(FILE_DIR, theme, n + '.ico'), path.join(dir, n + '.ico')))
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FILE_SCRIPT],
      { windowsHide: true, env: { ...process.env, COCOA_FILEICONS: pairs.join('|') } }, () => {})
    conf.fileIconsFor = app.getVersion()
    saveConf()
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
    updateFileIcons()
  }

  ipcMain.handle('appIcon', () => theme)
  ipcMain.handle('setAppIcon', (_e, t) => {
    if (!THEMES.includes(t)) throw new Error('Unknown icon')
    theme = t
    saveConf()
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

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(image())
    // Installing an update registers the default file icons again; put the chosen ones back.
    if (theme !== 'amethyst' && conf.fileIconsFor !== app.getVersion()) setTimeout(updateFileIcons, 3000)
  })
  return { windowIcon: png }
}

module.exports = { setupAppIcon }

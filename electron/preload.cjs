const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cocoaNative', {
  platform: process.platform,
  listDocs: () => ipcRenderer.invoke('listDocs'),
  loadDoc: id => ipcRenderer.invoke('loadDoc', id),
  saveDoc: (id, json, summary) => ipcRenderer.invoke('saveDoc', id, json, summary),
  saveDocSync: (id, json, summary) => ipcRenderer.sendSync('saveDocSync', id, json, summary),
  deleteDoc: id => ipcRenderer.invoke('deleteDoc', id),
  putAsset: (id, aid, data) => ipcRenderer.invoke('putAsset', id, aid, data),
  getAsset: (id, aid) => ipcRenderer.invoke('getAsset', id, aid),
  pruneAssets: (id, keep) => ipcRenderer.invoke('pruneAssets', id, keep),
  openFile: filters => ipcRenderer.invoke('openFile', filters),
  saveFile: (name, data, filters) => ipcRenderer.invoke('saveFile', name, data, filters),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, f) => cb(f)),
  setTitle: t => ipcRenderer.send('setTitle', t),
  onFullScreen: cb => ipcRenderer.on('fullscreen', (_e, on) => cb(!!on)),
  viewPdf: (name, data) => ipcRenderer.invoke('viewPdf', name, data),
  pdfInfo: t => ipcRenderer.invoke('pdfInfo', t),
  savePdf: (t, data, as) => ipcRenderer.invoke('savePdf', t, data, as),
  appIcon: () => ipcRenderer.invoke('appIcon'),
  setAppIcon: t => ipcRenderer.invoke('setAppIcon', t),
  createShortcut: () => ipcRenderer.invoke('createShortcut').catch(e => { throw new Error(String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, '')) })
})

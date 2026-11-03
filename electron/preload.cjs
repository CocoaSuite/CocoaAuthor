const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cocoaNative', {
  platform: process.platform,
  listDocs: () => ipcRenderer.invoke('listDocs'),
  loadDoc: id => ipcRenderer.invoke('loadDoc', id),
  saveDoc: (id, json, summary) => ipcRenderer.invoke('saveDoc', id, json, summary),
  deleteDoc: id => ipcRenderer.invoke('deleteDoc', id),
  putAsset: (id, aid, data) => ipcRenderer.invoke('putAsset', id, aid, data),
  getAsset: (id, aid) => ipcRenderer.invoke('getAsset', id, aid),
  pruneAssets: (id, keep) => ipcRenderer.invoke('pruneAssets', id, keep),
  openFile: filters => ipcRenderer.invoke('openFile', filters),
  saveFile: (name, data, filters) => ipcRenderer.invoke('saveFile', name, data, filters),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, f) => cb(f)),
  setTitle: t => ipcRenderer.send('setTitle', t)
})

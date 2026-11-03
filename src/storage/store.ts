import type { CADocument, DocSummary } from '../model/types'
import { summarize, assetIds, normalize } from '../model/doc'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { uid } from '../util'

export interface Store {
  list(): Promise<DocSummary[]>
  load(id: string): Promise<CADocument | null>
  save(doc: CADocument): Promise<void>
  remove(id: string): Promise<void>
  putAsset(docId: string, assetId: string, blob: Blob): Promise<void>
  getAsset(docId: string, assetId: string): Promise<Blob | null>
  pruneAssets(docId: string, keep: string[]): Promise<void>
}

export interface Native {
  platform: string
  listDocs(): Promise<DocSummary[]>
  loadDoc(id: string): Promise<string | null>
  saveDoc(id: string, json: string, summary: string): Promise<void>
  deleteDoc(id: string): Promise<void>
  putAsset(docId: string, id: string, data: ArrayBuffer): Promise<void>
  getAsset(docId: string, id: string): Promise<ArrayBuffer | null>
  pruneAssets(docId: string, keep: string[]): Promise<void>
  openFile(filters: { name: string; extensions: string[] }[]): Promise<{ name: string; data: ArrayBuffer } | null>
  saveFile(name: string, data: ArrayBuffer, filters: { name: string; extensions: string[] }[]): Promise<string | null>
  onOpenFile(cb: (f: { name: string; data: ArrayBuffer }) => void): void
  setTitle(t: string): void
}

export const native: Native | undefined = (window as any).cocoaNative

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}

class IdbStore implements Store {
  private db: Promise<IDBDatabase>
  constructor() {
    this.db = new Promise((res, rej) => {
      const o = indexedDB.open('cocoaauthor', 1)
      o.onupgradeneeded = () => {
        const db = o.result
        db.createObjectStore('docs')
        db.createObjectStore('summaries')
        db.createObjectStore('assets')
      }
      o.onsuccess = () => res(o.result)
      o.onerror = () => rej(o.error)
    })
    navigator.storage?.persist?.().catch(() => {})
  }
  private async tx(stores: string[], mode: IDBTransactionMode) {
    return (await this.db).transaction(stores, mode)
  }
  async list() {
    const t = await this.tx(['summaries'], 'readonly')
    return (await req(t.objectStore('summaries').getAll())) as DocSummary[]
  }
  async load(id: string) {
    const t = await this.tx(['docs'], 'readonly')
    const d = await req(t.objectStore('docs').get(id))
    return d ? normalize(d) : null
  }
  async save(doc: CADocument) {
    const t = await this.tx(['docs', 'summaries'], 'readwrite')
    t.objectStore('docs').put(doc, doc.meta.id)
    t.objectStore('summaries').put(summarize(doc), doc.meta.id)
    await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error) })
  }
  async remove(id: string) {
    const t = await this.tx(['docs', 'summaries', 'assets'], 'readwrite')
    t.objectStore('docs').delete(id)
    t.objectStore('summaries').delete(id)
    t.objectStore('assets').delete(IDBKeyRange.bound(id + '/', id + '/￿'))
    await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
  }
  async putAsset(docId: string, assetId: string, blob: Blob) {
    const buf = await blob.arrayBuffer()
    const t = await this.tx(['assets'], 'readwrite')
    t.objectStore('assets').put({ type: blob.type, buf }, docId + '/' + assetId)
    await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
  }
  async getAsset(docId: string, assetId: string) {
    const t = await this.tx(['assets'], 'readonly')
    const v = await req(t.objectStore('assets').get(docId + '/' + assetId))
    return v ? new Blob([v.buf], { type: v.type }) : null
  }
  async pruneAssets(docId: string, keep: string[]) {
    const t = await this.tx(['assets'], 'readwrite')
    const st = t.objectStore('assets')
    const keys = (await req(st.getAllKeys(IDBKeyRange.bound(docId + '/', docId + '/￿')))) as string[]
    for (const k of keys) if (!keep.includes(k.slice(docId.length + 1))) st.delete(k)
    await new Promise<void>(res => { t.oncomplete = () => res() })
  }
}

class NativeStore implements Store {
  constructor(private n: Native) {}
  list() { return this.n.listDocs() }
  async load(id: string) {
    const s = await this.n.loadDoc(id)
    return s ? normalize(JSON.parse(s)) : null
  }
  save(doc: CADocument) { return this.n.saveDoc(doc.meta.id, JSON.stringify(doc), JSON.stringify(summarize(doc))) }
  remove(id: string) { return this.n.deleteDoc(id) }
  async putAsset(docId: string, assetId: string, blob: Blob) { await this.n.putAsset(docId, assetId, await blob.arrayBuffer()) }
  async getAsset(docId: string, assetId: string) {
    const b = await this.n.getAsset(docId, assetId)
    return b ? new Blob([b]) : null
  }
  pruneAssets(docId: string, keep: string[]) { return this.n.pruneAssets(docId, keep) }
}

export const store: Store = native ? new NativeStore(native) : new IdbStore()

export const FILE_EXT = 'cocoaauthor'

export async function packDoc(doc: CADocument): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { 'document.json': strToU8(JSON.stringify(doc)) }
  for (const id of assetIds(doc.content)) {
    const b = await store.getAsset(doc.meta.id, id)
    if (b) files['assets/' + id] = new Uint8Array(await b.arrayBuffer())
  }
  files['mimetype'] = strToU8('application/x-cocoaauthor')
  return zipSync(files, { level: 6 })
}

export async function unpackDoc(data: Uint8Array): Promise<CADocument> {
  let files: Record<string, Uint8Array>
  try { files = unzipSync(data) } catch { throw new Error('This file is not a CocoaAuthor document.') }
  if (!files['document.json']) throw new Error('This file is not a CocoaAuthor document.')
  const doc = normalize(JSON.parse(strFromU8(files['document.json'])))
  if (doc.format !== 'cocoaauthor') throw new Error('This file is not a CocoaAuthor document.')
  doc.meta.id = uid('d')
  for (const k in files) {
    if (!k.startsWith('assets/')) continue
    const id = k.slice(7)
    const mime = doc.assets[id]?.mime || 'application/octet-stream'
    await store.putAsset(doc.meta.id, id, new Blob([files[k] as BlobPart], { type: mime }))
  }
  doc.meta.modified = Date.now()
  await store.save(doc)
  return doc
}

const pickerTypes: Record<string, { description: string; accept: Record<string, string[]> }> = {
  pdf: { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } },
  docx: { description: 'Word document', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
  cocoaauthor: { description: 'CocoaAuthor document', accept: { 'application/x-cocoaauthor': ['.cocoaauthor'] } }
}

export async function saveFile(name: string, data: Uint8Array | Blob, ext: string): Promise<boolean> {
  const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data
  if (native) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    return !!(await native.saveFile(name, ab, [{ name: pickerTypes[ext]?.description || ext, extensions: [ext] }]))
  }
  const blob = new Blob([buf as BlobPart], { type: ext === 'cocoaauthor' ? 'application/octet-stream' : Object.keys(pickerTypes[ext]?.accept || { 'application/octet-stream': [] })[0] })
  const w = window as any
  if (w.showSaveFilePicker && window.self === window.top) {
    try {
      const hdl = await w.showSaveFilePicker({ suggestedName: name, types: pickerTypes[ext] ? [pickerTypes[ext]] : undefined })
      const ws = await hdl.createWritable()
      await ws.write(blob)
      await ws.close()
      return true
    } catch (e: any) {
      if (e?.name === 'AbortError') return false
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return true
}

export async function openFile(exts: string[]): Promise<{ name: string; data: Uint8Array } | null> {
  if (native) {
    const r = await native.openFile([{ name: 'Documents', extensions: exts.map(e => e.replace('.', '')) }])
    return r ? { name: r.name, data: new Uint8Array(r.data) } : null
  }
  return new Promise(res => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = exts.join(',')
    i.onchange = async () => {
      const f = i.files?.[0]
      res(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null)
    }
    i.oncancel = () => res(null)
    i.click()
  })
}

export const safeName = (s: string) => (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 120) || 'Untitled'

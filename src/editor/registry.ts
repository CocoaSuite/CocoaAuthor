import type { AssetInfo } from '../model/types'

const urls = new Map<string, string>()
const blobs = new Map<string, Blob>()
let info: Record<string, AssetInfo> = {}

export const assets = {
  set(id: string, blob: Blob) {
    const old = urls.get(id)
    if (old) URL.revokeObjectURL(old)
    blobs.set(id, blob)
    urls.set(id, URL.createObjectURL(blob))
  },
  url(id: string) { return urls.get(id) || '' },
  blob(id: string) { return blobs.get(id) },
  has(id: string) { return blobs.has(id) },
  info(id: string) { return info[id] },
  setInfo(id: string, i: AssetInfo) { info[id] = i },
  allInfo() { return info },
  load(i: Record<string, AssetInfo>) { info = { ...i } },
  clear() {
    urls.forEach(u => URL.revokeObjectURL(u))
    urls.clear(); blobs.clear(); info = {}
  }
}

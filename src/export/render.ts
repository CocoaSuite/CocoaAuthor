import { DocView } from '../editor/docview'
import { assets } from '../editor/registry'
import { store } from '../storage/store'
import { assetIds } from '../model/doc'
import type { CADocument } from '../model/types'

export const metaLite = (doc: CADocument) => () => ({
  title: doc.meta.title, subtitle: doc.meta.subtitle, author: doc.meta.author,
  date: new Date(doc.meta.modified).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
})

export async function ensureAssets(doc: CADocument) {
  for (const id of assetIds(doc.content)) {
    if (assets.has(id)) continue
    const b = await store.getAsset(doc.meta.id, id)
    if (b) assets.set(id, b.type ? b : new Blob([b], { type: doc.assets[id]?.mime || 'image/png' }))
    if (doc.assets[id]) assets.setInfo(id, doc.assets[id])
  }
}

export async function renderForExport(doc: CADocument, host?: HTMLElement): Promise<{ dv: DocView; dispose(): void }> {
  await ensureAssets(doc)
  let own = false
  if (!host) {
    own = true
    host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;contain:layout'
    document.body.append(host)
  }
  const dv = new DocView(host, doc.content, 'export', metaLite(doc))
  await dv.ready()
  return { dv, dispose() { dv.destroy(); if (own) host!.remove() } }
}

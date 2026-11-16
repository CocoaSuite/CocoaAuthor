import { native } from '../storage/store'
import { uid } from '../util'

export interface PdfSource { name: string; data: Uint8Array; path?: string }

// Web: PDFs opened in this tab, by route token. Desktop: the main process keeps them.
const mem = new Map<string, PdfSource>()

export function addPdf(src: PdfSource): string {
  const t = uid('p')
  mem.set(t, src)
  return t
}

export async function getPdf(token: string): Promise<PdfSource | null> {
  if (mem.has(token)) return mem.get(token)!
  if (native?.pdfInfo) {
    const r = await native.pdfInfo(token)
    if (r) { const s = { name: r.name, data: new Uint8Array(r.data), path: r.path || undefined }; mem.set(token, s); return s }
  }
  return null
}

export function forgetPdf(token: string) { mem.delete(token) }

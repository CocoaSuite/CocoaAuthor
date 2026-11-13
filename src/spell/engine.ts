// Spell checking that works the same in the browser and the desktop app: Hunspell dictionaries
// checked by nspell in a worker, with results cached here so the editor can ask synchronously.

export type SpellLang = 'en-US' | 'en-GB' | 'ru'

const USER_KEY = 'ca-userdict'
let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (v: any) => void>()
const cache = new Map<string, boolean>()        // lang|word → correct
const queue = new Map<SpellLang, Set<string>>()
const failed = new Set<SpellLang>()
const listeners = new Set<() => void>()
let flushT: any = null
let user: Set<string> | null = null

function w(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = e => { const f = waiting.get(e.data.id); if (f) { waiting.delete(e.data.id); f(e.data) } }
    worker.postMessage({ id: 0, type: 'init', base: document.baseURI })
  }
  return worker
}

function call(msg: any): Promise<any> {
  const id = ++seq
  return new Promise(res => { waiting.set(id, res); w().postMessage({ ...msg, id }) })
}

export function userWords(): Set<string> {
  if (!user) {
    try { user = new Set(JSON.parse(localStorage.getItem(USER_KEY) || '[]')) } catch { user = new Set() }
  }
  return user
}

function saveUser() {
  try { localStorage.setItem(USER_KEY, JSON.stringify([...userWords()].sort())) } catch {}
  emit()
}

export function addUserWord(word: string) { userWords().add(word.toLowerCase()); saveUser() }
export function setUserWords(words: string[]) { user = new Set(words.map(x => x.trim().toLowerCase()).filter(Boolean)); saveUser() }

export function onSpellChange(f: () => void) { listeners.add(f); return () => listeners.delete(f) }
const emit = () => listeners.forEach(f => f())

const key = (lang: string, word: string) => lang + '|' + word

/** true = correct, false = misspelled, undefined = not known yet (queued). */
export function isCorrect(lang: SpellLang, word: string): boolean | undefined {
  if (userWords().has(word.toLowerCase())) return true
  if (failed.has(lang)) return true
  const v = cache.get(key(lang, word))
  if (v !== undefined) return v
  let q = queue.get(lang)
  if (!q) queue.set(lang, (q = new Set()))
  q.add(word)
  if (!flushT) flushT = setTimeout(flush, 30)
  return undefined
}

async function flush() {
  flushT = null
  const jobs = [...queue.entries()]
  queue.clear()
  await Promise.all(jobs.map(async ([lang, set]) => {
    const words = [...set]
    for (let i = 0; i < words.length; i += 2000) {
      const part = words.slice(i, i + 2000)
      const r = await call({ type: 'check', lang, words: part })
      if (r.error) { failed.add(lang); continue }
      const bad = new Set<string>(r.bad)
      for (const x of part) cache.set(key(lang, x), !bad.has(x))
    }
  }))
  emit()
}

export async function suggest(lang: SpellLang, word: string): Promise<string[]> {
  const r = await Promise.race([call({ type: 'suggest', lang, word }), new Promise(res => setTimeout(() => res({ list: [] }), 4000))]) as any
  const list: string[] = r.list || []
  // Keep the capitalisation the writer used.
  const cap = word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()
  const upper = word.length > 1 && word === word.toUpperCase()
  return [...new Set(list.map(s => (upper ? s.toUpperCase() : cap ? s[0].toUpperCase() + s.slice(1) : s)))]
}

const CYR = /\p{Script=Cyrillic}/u
const LAT = /^[\p{Script=Latin}\p{M}']+$/u

/** Which dictionary a word belongs to, or null when it should not be checked. */
export function langFor(word: string, en: SpellLang): SpellLang | null {
  if (CYR.test(word)) return /^[\p{Script=Cyrillic}\p{M}]+$/u.test(word) ? 'ru' : null
  if (LAT.test(word)) return en
  return null
}

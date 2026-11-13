/// <reference lib="webworker" />
import nspell from 'nspell'

type Msg =
  | { id: number; type: 'check'; lang: string; words: string[] }
  | { id: number; type: 'suggest'; lang: string; word: string }
  | { id: number; type: 'init'; base: string }

let base = ''
const spellers = new Map<string, Promise<ReturnType<typeof nspell>>>()

function load(lang: string) {
  let s = spellers.get(lang)
  if (!s) {
    const get = (ext: string) => fetch(new URL(`dicts/${lang}.${ext}`, base).href).then(r => { if (!r.ok) throw new Error('Dictionary missing'); return r.text() })
    s = Promise.all([get('aff'), get('dic')]).then(([aff, dic]) => nspell(aff, dic))
    spellers.set(lang, s)
  }
  return s
}

// Damerau–Levenshtein, to put the closest suggestions first.
function dist(a: string, b: string) {
  const d: number[][] = []
  for (let i = 0; i <= a.length; i++) d[i] = [i]
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[a.length][b.length]
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data
  try {
    if (m.type === 'init') { base = m.base; return }
    const sp = await load(m.lang)
    if (m.type === 'check') {
      const bad = m.words.filter(w => !sp.correct(w))
      ;(self as any).postMessage({ id: m.id, bad })
    } else {
      const w = m.word
      const lw = w.toLowerCase()
      const out = sp.suggest(w)
      const ranked = out.map((s, i) => ({ s, i, d: dist(lw, s.toLowerCase()), l: Math.abs(s.length - w.length) })).sort((a, b) => a.d - b.d || a.l - b.l || a.i - b.i).map(x => x.s)
      ;(self as any).postMessage({ id: m.id, list: ranked.slice(0, 8) })
    }
  } catch (err: any) {
    ;(self as any).postMessage({ id: (m as any).id, error: String(err?.message || err) })
  }
}

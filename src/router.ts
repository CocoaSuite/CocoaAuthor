export const go = (path: string) => {
  const target = '#' + path
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = target
}

export const route = () => {
  const p = location.hash.replace(/^#/, '') || '/'
  const m = p.match(/^\/doc\/([\w-]+)/)
  if (m) return { name: 'doc' as const, id: m[1] }
  const v = p.match(/^\/(recent|all|templates|archived)(?:\/(.+))?/)
  return { name: 'library' as const, view: (v?.[1] || 'recent') as 'recent' | 'all' | 'templates' | 'archived', cat: v?.[2] ? decodeURIComponent(v[2]) : '' }
}

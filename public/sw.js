const C = 'cocoaauthor-v1'
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'logo.svg', 'icon.svg', 'icon-192.png', 'icon-512.png']
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const r = e.request
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return
  const immutable = /\/(assets|fonts)\//.test(new URL(r.url).pathname)
  if (immutable) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)) } return res })))
    return
  }
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)) } return res })
    .catch(() => caches.match(r).then(m => m || caches.match('index.html'))))
})

/* Offline shell for Skyfall web. Weather APIs are never cached here; the app keeps its own last good copy. */
const CACHE = 'skyfall-shell-v47';
const SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'scene.js', 'core.js', 'intel.js', 'smart.js', 'app.js', 'catalog.js', 'city.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('obs.json')) return;
  // Network first so updates land straight away; the cache only answers when offline.
  // cache:'no-cache' revalidates with the server (ETag) instead of trusting the 10-minute HTTP cache.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

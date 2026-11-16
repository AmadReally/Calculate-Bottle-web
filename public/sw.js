// Service worker: the app shell works offline; data always comes from the network when it can.
// Bump VERSION whenever a file in SHELL changes.
const VERSION = 'kbt-v5';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/icon.svg', '/icon-192.png', '/manifest.webmanifest', '/img/jeti.jpg',
  '/fonts/barlow-semi-condensed-latin-500-normal.woff2', '/fonts/barlow-semi-condensed-latin-600-normal.woff2', '/fonts/barlow-semi-condensed-latin-700-normal.woff2'];
// Public read-only data that may be shown from cache when offline. Never auth, entries or CSV
// (they can hold recorder names and depend on who is signed in).
const CACHEABLE_API = ['/api/config', '/api/umt/summary', '/api/umt/overview', '/api/news'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // let the browser handle it

  if (url.pathname.startsWith('/api/')) {
    if (!CACHEABLE_API.includes(url.pathname)) return;
    // Network first, cached copy only when offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error())));
    return;
  }

  // Page navigations: network first so updates show at once, shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Code (HTML, JS, CSS, manifest): network first, so a new release shows at once. The cached copy is only for offline.
  // Fonts, photos and icons never change under the same name: cache first.
  const immutable = /^\/(fonts|img)\//.test(url.pathname) || /^\/icon[-.]/.test(url.pathname);
  if (immutable) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || Response.error())));
});

// Service worker of the phone-only version (copied into the build by vite.config.ts, which
// fills in the placeholders). It keeps the app's own files, so Tunes opens without a
// connection; songs saved for offline listening are in IndexedDB (web/src/lib/offline.ts).
// Requests to the music sources are not touched.
const BASE = __BASE__;
const CACHE = 'tunes-standalone-' + __VERSION__;
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, ...FILES])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tunes-standalone-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()),
));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  // Pages: the newest version when online, the saved one otherwise (every path is the app).
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(BASE).then((r) => r || Response.error())));
    return;
  }
  // Built files have a content hash in their name: the saved copy is always right.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});

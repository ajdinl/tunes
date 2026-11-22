// Service worker: makes the app installable (Dock / Home Screen) and explains a stopped server.
// Nothing is cached: an old copy of the interface would only look like Tunes without working
// (the music, the library and the settings all come from the server). When the server doesn't
// answer, a page opening Tunes gets a short note instead, which reloads once the server is back.
// Earlier versions kept a cache ('tunes-v1'); it is deleted here.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

const OFFLINE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tunes</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: #000; color: #ece6d6; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  h1 { margin: 0 0 8px; font-size: 26px; }
  p { margin: 0; color: #9a948a; max-width: 30em; }
  code { color: #ffb547; }
</style></head>
<body><main><h1 id="t">Tunes isn't running</h1><p id="p">Start it on your computer (<code>npm start</code>) and this page opens by itself.</p></main>
<script>
  var T = {
    bs: ['Tunes nije pokrenut', 'Pokreni ga na računaru (<code>npm start</code>) i ova stranica će se sama otvoriti.'],
    sr: ['Tunes nije pokrenut', 'Pokreni ga na računaru (<code>npm start</code>) i ova stranica će se sama otvoriti.'],
    hr: ['Tunes nije pokrenut', 'Pokreni ga na računalu (<code>npm start</code>) i ova će se stranica sama otvoriti.'],
    de: ['Tunes läuft nicht', 'Starte es auf deinem Computer (<code>npm start</code>), dann öffnet sich diese Seite von selbst.'],
    tr: ['Tunes çalışmıyor', 'Bilgisayarında başlat (<code>npm start</code>); bu sayfa kendiliğinden açılır.']
  };
  try {
    var l = JSON.parse(localStorage.getItem('tunes.lang') || 'null');
    if (T[l]) { document.documentElement.lang = l; document.getElementById('t').textContent = T[l][0]; document.getElementById('p').innerHTML = T[l][1]; }
  } catch (e) {}
  setInterval(function () {
    fetch('/api/state', { cache: 'no-store' }).then(function (r) { if (r.ok) location.reload(); }).catch(function () {});
  }, 3000);
</script></body></html>`;

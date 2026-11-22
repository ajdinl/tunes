// Tunes: local music server.
// Run: node server.js   (then open http://localhost:4545)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

import { Store, cleanTrack, ICONS, tildify } from './lib/store.js';
import { Library, MIME } from './lib/library.js';
import { audius, archive, radio, jamendo, lyrics, listenbrainz } from './lib/sources.js';
import { proxyAudio } from './lib/proxy.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR allows a separate copy of the data (e.g. for a demo or testing).
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(ROOT, 'node_modules', '@fontsource-variable', 'bricolage-grotesque');
const PORT = Number(process.env.PORT) || 4545;
// Only this computer by default. HOST=0.0.0.0 allows access from phones on the same network.
const HOST = process.env.HOST || '127.0.0.1';

const store = new Store(path.join(DATA, 'db.json'));
for (const f of store.data.settings.folders) fs.mkdirSync(f, { recursive: true });
const library = new Library({ dataDir: DATA, getFolders: () => store.data.settings.folders });

// ------------------------------------------------------------ events (SSE)
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
library.on('changed', (d) => broadcast('library', d));
const icyTitles = new Map();

// ------------------------------------------------------------ helpers
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5e6) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const iconName = () => (ICONS.includes(store.data.settings.icon) ? store.data.settings.icon : ICONS[0]);

// The manifest lists the chosen icon; ?v= makes browsers fetch it again after a change.
function serveManifest(res, startUrl) {
  const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
  const v = iconName();
  m.icons = [
    { src: `/icons/app-192.png?v=${v}`, sizes: '192x192', type: 'image/png' },
    { src: `/icons/app-512.png?v=${v}`, sizes: '512x512', type: 'image/png' },
    { src: `/icons/app.svg?v=${v}`, sizes: 'any', type: 'image/svg+xml' },
  ];
  if (startUrl) { m.start_url = startUrl; m.id = '/'; }
  res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' }).end(JSON.stringify(m));
}

async function serveFile(req, res, file, type, { cache = 'no-cache' } = {}) {
  let stat;
  try { stat = await fsp.stat(file); } catch { res.writeHead(404).end(); return; }
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, 'Last-Modified': stat.mtime.toUTCString() };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

// Protection against DNS rebinding: only local addresses are accepted.
function hostAllowed(req) {
  const h = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':') || h.endsWith('.local') || h.endsWith('.ts.net');
}

const sanitize = (s, max = 80) => String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, max) || 'Unknown';
const DOWNLOAD_HOSTS = /(^|\.)(archive\.org|audius\.co|jamendo\.com)$/;

// ------------------------------------------------------------ routes
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/state$/, (req, res) => json(res, 200, store.publicState()));

route('GET', /^\/api\/library$/, (req, res) => json(res, 200, {
  tracks: library.tracks(), folders: store.data.settings.folders.map(tildify), scanning: Boolean(library.scanning), lastScan: library.lastScan,
}));

route('POST', /^\/api\/library\/rescan$/, async (req, res) => json(res, 200, await library.scan()));

route('GET', /^\/api\/local\/cover\/([a-f0-9]{16})$/, async (req, res, [, h]) => {
  const c = await library.cover(h);
  if (!c) { res.writeHead(404, { 'Cache-Control': 'max-age=300' }).end(); return; }
  serveFile(req, res, c.file, c.type, { cache: 'max-age=86400' });
});

route('GET', /^\/api\/stream\/local\/([a-f0-9]{16})$/, (req, res, [, h]) => {
  const e = library.get(h);
  if (!e) { res.writeHead(404).end(); return; }
  serveFile(req, res, e.path, MIME[e.ext] || 'application/octet-stream');
});

route('GET', /^\/api\/stream\/audius\/([\w]+)$/, (req, res, [, id]) => proxyAudio(req, res, audius.streamUrl(id)));

route('GET', /^\/api\/stream\/url$/, (req, res, m, q) => proxyAudio(req, res, q.get('u') || ''));

route('GET', /^\/api\/stream\/radio$/, (req, res, m, q) => {
  const sid = q.get('sid') || '';
  if (sid) radio.click(sid);
  proxyAudio(req, res, q.get('u') || '', {
    icy: true,
    onTitle: (title) => {
      if (icyTitles.get(sid) === title) return;
      icyTitles.set(sid, title);
      broadcast('icy', { sid, title });
    },
  });
});

// Images with fallback servers (Audius covers), cached in the browser.
route('GET', /^\/api\/img$/, async (req, res, m, q) => {
  let first;
  try { first = new URL(q.get('u') || ''); } catch { res.writeHead(400).end(); return; }
  const candidates = [first.href];
  for (const host of (q.get('m') || '').split(',').filter(Boolean)) {
    try { const h = new URL(host); candidates.push(h.origin + first.pathname + first.search); } catch { /* */ }
  }
  for (const u of candidates) {
    if (!/^https?:$/.test(new URL(u).protocol)) continue;
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Tunes/1.0' }, signal: AbortSignal.timeout(6000) });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'max-age=604800' });
      res.end(buf);
      return;
    } catch { /* try the next one */ }
  }
  res.writeHead(404, { 'Cache-Control': 'max-age=600' }).end();
});

route('GET', /^\/api\/events$/, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clients.delete(res); clearInterval(ping); });
});

// Searches all online sources at once. Each source returns its own result or error.
route('GET', /^\/api\/search$/, async (req, res, m, q) => {
  const term = (q.get('q') || '').trim();
  if (!term) return json(res, 200, {});
  const wanted = (q.get('src') || 'audius,archive,radio,jamendo').split(',');
  // Sets need more results, since long mixes are rarer than regular tracks.
  const many = q.get('type') === 'sets';
  const jobs = {
    audius: () => audius.search(term, many ? 100 : 40),
    artists: () => audius.users(term),
    archive: () => archive.search(term),
    radio: () => radio.search({ q: term, limit: 30 }),
    jamendo: () => jamendo.search(term, store.data.settings.jamendoClientId, many ? 100 : 30),
  };
  const keys = wanted.filter((k) => jobs[k] && (k !== 'jamendo' || store.data.settings.jamendoClientId));
  const results = await Promise.allSettled(keys.map((k) => jobs[k]()));
  const out = {};
  keys.forEach((k, i) => {
    const r = results[i];
    out[k] = r.status === 'fulfilled' ? { items: r.value } : { error: r.reason?.message || 'Error' };
  });
  json(res, 200, out);
});

route('GET', /^\/api\/audius\/trending$/, async (req, res, m, q) =>
  json(res, 200, await audius.trending(q.get('genre') || '', q.get('time') || 'week')));

route('GET', /^\/api\/audius\/user\/(\w+)$/, async (req, res, [, id], q) => json(res, 200, await audius.user(id, q.get('sort') || 'plays')));

route('GET', /^\/api\/archive\/search$/, async (req, res, m, q) => json(res, 200, await archive.search(q.get('q') || 'grateful dead')));

route('GET', /^\/api\/archive\/item\/([\w.\-]+)$/, async (req, res, [, id]) => json(res, 200, await archive.item(id)));

route('GET', /^\/api\/radio\/search$/, async (req, res, m, q) =>
  json(res, 200, await radio.search({ q: q.get('q') || '', tag: q.get('tag') || '', countrycode: q.get('country') || '' })));

route('GET', /^\/api\/radio\/top$/, async (req, res) => json(res, 200, await radio.top()));

route('GET', /^\/api\/radio\/nowplaying$/, (req, res, m, q) => json(res, 200, { title: icyTitles.get(q.get('sid')) || null }));

route('GET', /^\/api\/jamendo\/popular$/, async (req, res, m, q) =>
  json(res, 200, await jamendo.popular(store.data.settings.jamendoClientId, q.get('tag') || '')));

route('GET', /^\/api\/lyrics$/, async (req, res, m, q) => json(res, 200, await lyrics({
  artist: q.get('artist'), title: q.get('title'), album: q.get('album'), duration: Number(q.get('duration')) || 0,
})));

route('POST', /^\/api\/favorites\/toggle$/, async (req, res) => {
  const { track } = await body(req);
  if (!track?.id) return json(res, 400, { error: 'Song is missing' });
  json(res, 200, { favorite: store.toggleFavorite(track) });
});

route('POST', /^\/api\/stations\/toggle$/, async (req, res) => {
  const { track } = await body(req);
  if (!track?.id) return json(res, 400, { error: 'Station is missing' });
  json(res, 200, { saved: store.toggleStation(track) });
});

route('POST', /^\/api\/history$/, async (req, res) => {
  const { track, at } = await body(req);
  if (!track?.id) return json(res, 400, { error: 'Song is missing' });
  const when = Number(at) || Date.now();
  store.addHistory(track, when);
  json(res, 200, { ok: true, playCount: store.data.playCounts[track.id] });
  if (!track.live) {
    listenbrainz.submit(store.data.settings.listenbrainzToken, 'single', track, when)
      .catch((e) => console.warn(e.message));
  }
});

route('DELETE', /^\/api\/history$/, (req, res) => { store.clearHistory(); json(res, 200, { ok: true }); });

route('POST', /^\/api\/nowplaying$/, async (req, res) => {
  const { track } = await body(req);
  json(res, 200, { ok: true });
  if (track && !track.live) {
    listenbrainz.submit(store.data.settings.listenbrainzToken, 'playing_now', track).catch((e) => console.warn(e.message));
  }
});

route('POST', /^\/api\/playlists$/, async (req, res) => {
  const { name, tracks } = await body(req);
  json(res, 200, store.createPlaylist(name, Array.isArray(tracks) ? tracks : []));
});

route('PUT', /^\/api\/playlists\/([\w-]+)$/, async (req, res, [, id]) => {
  const p = store.updatePlaylist(id, await body(req));
  p ? json(res, 200, p) : json(res, 404, { error: "Playlist doesn't exist" });
});

route('DELETE', /^\/api\/playlists\/([\w-]+)$/, (req, res, [, id]) => json(res, 200, { ok: store.deletePlaylist(id) }));

route('GET', /^\/api\/playlists\/([\w-]+)\/m3u$/, (req, res, [, id]) => {
  const p = store.data.playlists.find((x) => x.id === id);
  if (!p) { res.writeHead(404).end(); return; }
  const base = `http://${req.headers.host}`;
  const lines = ['#EXTM3U', `#PLAYLIST:${p.name}`];
  for (const t of p.tracks) {
    lines.push(`#EXTINF:${Math.round(t.duration || -1)},${t.artist || ''} - ${t.title}`);
    const e = t.source === 'local' && library.get(t.id.slice(6));
    lines.push(e ? e.path : base + t.stream);
  }
  res.writeHead(200, {
    'Content-Type': 'audio/x-mpegurl; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.name)}.m3u`,
  });
  res.end(lines.join('\n') + '\n');
});

route('PUT', /^\/api\/settings$/, async (req, res) => {
  const patch = await body(req);
  const oldFolders = JSON.stringify(store.data.settings.folders);
  const oldIcon = store.data.settings.icon;
  store.updateSettings(patch);
  if (store.data.settings.icon !== oldIcon) broadcast('icon', { icon: iconName() });
  const out = { ok: true };
  if (typeof patch.listenbrainzToken === 'string' && patch.listenbrainzToken && patch.listenbrainzToken !== '••••') {
    try {
      const v = await listenbrainz.validate(store.data.settings.listenbrainzToken);
      out.listenbrainz = v;
      if (!v.valid) { store.data.settings.listenbrainzToken = ''; store.save(); }
    } catch (e) { out.listenbrainz = { valid: false, error: e.message }; }
  }
  if (JSON.stringify(store.data.settings.folders) !== oldFolders) {
    for (const f of store.data.settings.folders) { try { fs.mkdirSync(f, { recursive: true }); } catch { /* no permission */ } }
    library.watch();
    library.scan().catch(console.error);
  }
  json(res, 200, { ...out, state: store.publicState() });
});

// Saves a track from a legal source (where the license allows it) to the local library.
route('POST', /^\/api\/download$/, async (req, res) => {
  const { track } = await body(req);
  if (!track?.download) return json(res, 400, { error: "This song isn't licensed for download" });
  let u;
  try { u = new URL(track.download); } catch { return json(res, 400, { error: 'Invalid address' }); }
  if (u.protocol !== 'https:' || !DOWNLOAD_HOSTS.test(u.hostname)) return json(res, 400, { error: 'Unknown source' });
  const folder = store.data.settings.folders[0];
  const artist = sanitize(track.albumArtist || track.artist);
  const album = sanitize(track.album || 'Singles');
  const ext = (track.ext && /^\.\w{2,5}$/.test(track.ext)) ? track.ext : '.mp3';
  const num = track.trackNo ? String(track.trackNo).padStart(2, '0') + ' ' : '';
  const dir = path.join(folder, artist, album);
  const file = path.join(dir, sanitize(num + track.title, 120) + ext);
  if (fs.existsSync(file)) return json(res, 200, { ok: true, file, existed: true });
  const r = await fetch(u, { headers: { 'User-Agent': 'Tunes/1.0' }, signal: AbortSignal.timeout(300000) });
  if (!r.ok || !r.body) return json(res, 502, { error: 'Source returned ' + r.status });
  await fsp.mkdir(dir, { recursive: true });
  const tmp = file + '.part';
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, file);
  json(res, 200, { ok: true, file });
  library.scan().catch(console.error);
});

// Backup of all data (favorites, playlists, history).
route('GET', /^\/api\/export$/, (req, res) => {
  const { settings, ...rest } = store.data;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="tunes-${new Date().toISOString().slice(0, 10)}.json"`,
  });
  res.end(JSON.stringify(rest, null, 2));
});

// ------------------------------------------------------------ listening on a phone
// The phone gets its own port (PORT + 1), reachable on the home network.
// The QR code link carries a secret key; without it nobody else on the network can get in.
const PHONE_PORT = PORT + 1;
let lanServer = null;

const isTailscaleIp = (ip) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127; // 100.64.0.0/10
};

function lanAddresses() {
  const list = Object.entries(os.networkInterfaces())
    .flatMap(([name, ifs]) => (ifs || []).map((i) => ({ ...i, name })))
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.') && !isTailscaleIp(i.address));
  // Wi-Fi (en0) first, then the rest.
  list.sort((a, b) => (a.name === 'en0' ? -1 : 0) - (b.name === 'en0' ? -1 : 0));
  return list.map((i) => i.address);
}

// Tailscale: a private network between your devices that also works away from home.
const TAILSCALE_CLI = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale'];
function tailscaleInfo() {
  return new Promise((resolve) => {
    const tryCli = (i) => {
      if (i >= TAILSCALE_CLI.length) {
        const ip = Object.values(os.networkInterfaces()).flat().find((x) => x && x.family === 'IPv4' && isTailscaleIp(x.address));
        return resolve(ip ? { running: true, host: ip.address, name: null } : { running: false });
      }
      execFile(TAILSCALE_CLI[i], ['status', '--json'], { timeout: 3000 }, (err, out) => {
        if (err) return tryCli(i + 1);
        try {
          const d = JSON.parse(out);
          const dns = (d.Self?.DNSName || '').replace(/\.$/, '');
          const ip = (d.Self?.TailscaleIPs || []).find((x) => x.includes('.'));
          resolve({ running: d.BackendState === 'Running', host: dns || ip || null, name: d.Self?.HostName || null });
        } catch { tryCli(i + 1); }
      });
    };
    tryCli(0);
  });
}

async function phoneState() {
  const ph = store.data.settings.phone || {};
  const on = Boolean(ph.enabled && lanServer);
  const link = (host) => `http://${host}:${PHONE_PORT}/?k=${ph.token}`;
  const ts = await tailscaleInfo();
  const qr = (u) => (u ? QRCode.toString(u, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } }) : null);
  const wifiUrl = on ? lanAddresses().map(link)[0] || null : null;
  const tsUrl = on && ts.running && ts.host ? link(ts.host) : null;
  return {
    enabled: on,
    port: PHONE_PORT,
    wifi: { url: wifiUrl, qr: await qr(wifiUrl) },
    tailscale: { running: Boolean(ts.running), url: tsUrl, qr: await qr(tsUrl) },
  };
}

function startPhone() {
  return new Promise((resolve, reject) => {
    if (lanServer) return resolve();
    const srv = http.createServer((req, res) => {
      const token = store.data.settings.phone?.token;
      const url = new URL(req.url, 'http://x');
      const cookie = /(?:^|;\s*)sl_k=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
      if (token && url.searchParams.get('k') === token) {
        url.searchParams.delete('k');
        res.writeHead(302, {
          'Set-Cookie': `sl_k=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`,
          Location: url.pathname + (url.search || ''),
        }).end();
        return;
      }
      if (!token || cookie !== token) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<meta name="viewport" content="width=device-width"><body style="font:17px system-ui;background:#000;color:#eee;padding:24px">Scan the QR code in Tunes on your computer (the “Listen on phone” button).</body>');
        return;
      }
      // Manifest for "Add to Home Screen": the icon opens the link with the key, because
      // a home screen app (iPhone) does not share cookies with Safari.
      if (url.pathname === '/manifest.webmanifest') return serveManifest(res, `/?k=${token}`);
      handle(req, res, { lan: true });
    });
    srv.once('error', reject);
    srv.listen(PHONE_PORT, '0.0.0.0', () => { lanServer = srv; resolve(); });
  });
}

function stopPhone() {
  if (lanServer) { lanServer.close(); lanServer.closeAllConnections?.(); lanServer = null; }
}

route('GET', /^\/api\/phone$/, async (req, res) => json(res, 200, await phoneState()));

// Links the phone can open (only available to a device that already has the key).
route('GET', /^\/api\/phone\/links$/, async (req, res) => {
  const st = await phoneState();
  json(res, 200, { wifi: st.wifi.url, tailscale: st.tailscale.url, tailscaleRunning: st.tailscale.running });
});

route('POST', /^\/api\/phone$/, async (req, res) => {
  const { enabled } = await body(req);
  const s = store.data.settings;
  if (enabled) {
    s.phone = { enabled: true, token: s.phone?.token || crypto.randomBytes(12).toString('base64url') };
    try { await startPhone(); }
    catch (e) { s.phone.enabled = false; store.save(); return json(res, 500, { error: `Cannot open port ${PHONE_PORT}: ${e.code || e.message}` }); }
  } else {
    // New key on disable, so the old link on the phone stops working.
    s.phone = { enabled: false, token: crypto.randomBytes(12).toString('base64url') };
    stopPhone();
  }
  store.save();
  json(res, 200, await phoneState());
});

// ------------------------------------------------------------ continue listening on another device
// The playing device reports what is playing and at what position. Another device can
// take over: it continues from the same second and the first one pauses.
let session = null;
// Like Spotify, music plays on one device at a time: the device that last started playback
// owns it. Any other device that is still playing gets told to pause.
let owner = null; // { deviceId, device, at }

route('GET', /^\/api\/session$/, (req, res) => json(res, 200, { session }));

route('POST', /^\/api\/session$/, async (req, res) => {
  const b = await body(req);
  if (!b.deviceId || !b.track?.id) return json(res, 400, { error: 'Song is missing' });
  const deviceId = String(b.deviceId).slice(0, 64);
  if (b.playing && owner && owner.deviceId !== deviceId) {
    // Missed the takeover event (sleeping tab, dropped connection): pause now.
    return json(res, 200, { ok: true, yield: owner.device });
  }
  if (b.playing && !owner) owner = { deviceId, device: String(b.device || '').slice(0, 40), at: Date.now() };
  const changed = !session || session.deviceId !== deviceId || session.track.id !== b.track.id || session.playing !== Boolean(b.playing);
  session = {
    deviceId,
    device: String(b.device || '').slice(0, 40),
    track: cleanTrack(b.track),
    time: Number(b.time) || 0,
    playing: Boolean(b.playing),
    index: Number(b.index) || 0,
    queue: Array.isArray(b.queue) ? b.queue.slice(0, 500).map(cleanTrack) : [cleanTrack(b.track)],
    context: b.context && typeof b.context === 'object' ? { label: String(b.context.label || '').slice(0, 200), href: String(b.context.href || '').slice(0, 300) } : null,
    at: Date.now(),
    lastBroadcast: changed ? 0 : session.lastBroadcast,
  };
  json(res, 200, { ok: true });
  // Other devices are only notified when something important changes (or every 15 s).
  if (changed || !session.lastBroadcast || Date.now() - session.lastBroadcast > 15000) {
    session.lastBroadcast = Date.now();
    const { queue, lastBroadcast, ...summary } = session;
    broadcast('session', summary);
  }
});

// Called by a device when it starts playing: every other device pauses.
route('POST', /^\/api\/session\/takeover$/, async (req, res) => {
  const { deviceId, device } = await body(req);
  if (!deviceId) return json(res, 400, { error: 'Device is missing' });
  owner = { deviceId: String(deviceId).slice(0, 64), device: String(device || '').slice(0, 40), at: Date.now() };
  broadcast('takeover', { deviceId: owner.deviceId, device: owner.device });
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------ server
async function handle(req, res, { lan = false } = {}) {
  if (!hostAllowed(req)) { res.writeHead(403).end('Host not allowed'); return; }
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  try {
    if (lan && p === '/api/phone') return json(res, 403, { error: 'Phone access is turned on from the computer' });
    if (p.startsWith('/api/')) {
      // Changes are only accepted as JSON, which other sites cannot send without permission (CORS).
      if (!['GET', 'HEAD'].includes(req.method) && !(req.headers['content-type'] || '').startsWith('application/json')) {
        return json(res, 415, { error: 'Expected JSON' });
      }
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      for (const r of routes) {
        const m = r.method === method && r.pattern.exec(p);
        if (m) return await r.handler(req, res, m, url.searchParams);
      }
      return json(res, 404, { error: 'Unknown route' });
    }

    if (p.startsWith('/fonts/')) {
      const f = safeJoin(FONTS, p.slice(7));
      return f ? serveFile(req, res, f, STATIC_TYPES[path.extname(f)] || 'application/octet-stream', { cache: 'max-age=31536000' }) : res.writeHead(404).end();
    }

    if (p === '/manifest.webmanifest') return serveManifest(res);
    // Stable icon addresses that point to the chosen variant (old /icons/icon* links included).
    const ic = /^\/icons\/(?:app|icon)(-192|-512)?\.(svg|png)$/.exec(p);
    if (ic) {
      const file = path.join(PUBLIC, 'icons', iconName(), `icon${ic[2] === 'png' ? ic[1] || '-512' : ''}.${ic[2]}`);
      return serveFile(req, res, file, STATIC_TYPES['.' + ic[2]]);
    }

    let f = safeJoin(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
    if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
    return serveFile(req, res, f, STATIC_TYPES[path.extname(f)] || 'application/octet-stream');
  } catch (e) {
    console.error(req.method, p, '-', e.message);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message });
    else res.destroy();
  }
}

const server = http.createServer((req, res) => handle(req, res));

server.listen(PORT, HOST, () => {
  const local = `http://localhost:${PORT}`;
  console.log(`\n  Tunes is running at ${local}`);
  if (HOST === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
    for (const i of ips) console.log(`  From a phone: http://${i.address}:${PORT}`);
  }
  console.log(`  Library:      ${store.data.settings.folders.join(', ')}\n`);
  if (store.data.settings.phone?.enabled) {
    startPhone().then(() => console.log(`  Phone access: on (port ${PHONE_PORT})\n`))
      .catch((e) => console.warn('Phone access: cannot open port', PHONE_PORT, e.code));
  }
  library.scan().catch(console.error).finally(() => library.watch());
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { store.flush(); process.exit(0); });
}

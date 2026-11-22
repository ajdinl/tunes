// HTTP API of the server: same routes and same JSON must survive the TypeScript rewrite.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, client, ROOT } from '../support/server.js';
import { listen } from '../support/sse.js';
import { LIBRARY, SIDECAR } from '../support/fixtures.js';
import { LRCLIB_SONG, ARCHIVE_DOC } from '../support/fake-net.js';

let srv;
let api;
let tracks;
const byTitle = (t) => tracks.find((x) => x.title === t);
// fetch() does not let us set Host, so this one uses http.get.
const statusWithHost = (host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path: '/api/state', headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

beforeAll(async () => {
  srv = await startServer({ port: 4710, name: 'tunes-api' });
  api = client(srv.url);
  tracks = (await api.get('/api/library')).body.tracks;
});
afterAll(() => srv?.stop());

describe('static files and safety', () => {
  it('serves the app and falls back to index.html for unknown paths', async () => {
    const home = await api.get('/');
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toMatch(/text\/html/);
    expect(home.body).toContain('<html');
    expect((await api.get('/some/deep/link')).body).toBe(home.body);
    expect((await api.get('/album/a%7Cb')).body).toBe(home.body);
    // Built files from web/dist: content-hashed names, cached for good.
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(home.body)[1];
    const js = await api.get(script);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(js.headers.get('cache-control')).toBe('max-age=31536000, immutable');
    expect(home.headers.get('cache-control')).toBe('no-cache');
    expect((await api.get('/sw.js')).headers.get('content-type')).toMatch(/javascript/);
  });

  it('does not serve files outside public/ or the font folder', async () => {
    const r = await fetch(srv.url + '/fonts/..%2f..%2f..%2fpackage.json');
    expect(r.status).toBe(404);
    const p = await api.get('/..%2fpackage.json');
    expect(p.body).not.toContain('"dependencies"');
  });

  it('accepts only local host names (DNS rebinding protection)', async () => {
    for (const host of ['localhost:4710', '192.168.1.20:4710', 'macbook.local', 'mac.tail1234.ts.net', '[::1]:4710']) {
      expect(await statusWithHost(host), host).toBe(200);
    }
    expect(await statusWithHost('evil.example.com')).toBe(403);
    expect(await statusWithHost('localhost.evil.example.com')).toBe(403);
  });

  it('accepts changes only as JSON', async () => {
    expect((await api.raw('DELETE', '/api/history')).status).toBe(415);
    expect((await api.post('/api/favorites/toggle', 'track=1', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await api.post('/api/favorites/toggle', '{oops')).status).toBe(400);
  });

  it('answers unknown API routes with JSON 404', async () => {
    const r = await api.get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'Unknown route' });
  });
});

describe('state and library', () => {
  it('returns public state without secrets', async () => {
    const { body } = await api.get('/api/state');
    expect(body.settings).toMatchObject({ icon: 'bars', listenbrainzToken: '', hasListenbrainz: false, phoneOn: false });
    expect(body.settings.phone).toBeUndefined();
    expect(body.settings.folders).toEqual([srv.music]);
    for (const k of ['favorites', 'playlists', 'history', 'playCounts', 'lastPlayed', 'radioStations']) expect(body).toHaveProperty(k);
  });

  it('lists the library', async () => {
    const { body } = await api.get('/api/library');
    expect(body.tracks).toHaveLength(LIBRARY.length);
    expect(body.scanning).toBe(false);
    expect(body.lastScan).toBeGreaterThan(0);
  });

  it('streams local files with Range support', async () => {
    const t = byTitle('Morning Light');
    const full = await fetch(srv.url + t.stream, { method: 'HEAD' });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/wav');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const size = Number(full.headers.get('content-length'));
    const part = await fetch(srv.url + t.stream, { headers: { Range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 10-19/${size}`);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    const tail = await fetch(srv.url + t.stream, { headers: { Range: 'bytes=-4' } });
    expect(tail.headers.get('content-range')).toBe(`bytes ${size - 4}-${size - 1}/${size}`);
    expect((await fetch(srv.url + t.stream, { headers: { Range: `bytes=${size + 5}-` } })).status).toBe(416);
    expect((await fetch(srv.url + '/api/stream/local/0000000000000000')).status).toBe(404);
  });

  it('answers 404 for a missing cover', async () => {
    expect((await fetch(srv.url + byTitle('Northbound').cover)).status).toBe(404);
  });
});

describe('favorites, stations, history', () => {
  it('toggles a favorite', async () => {
    const t = byTitle('Slow River');
    expect((await api.post('/api/favorites/toggle', { track: t })).body).toEqual({ favorite: true });
    expect(Object.keys((await api.get('/api/state')).body.favorites)).toContain(t.id);
    expect((await api.post('/api/favorites/toggle', { track: t })).body).toEqual({ favorite: false });
    expect((await api.post('/api/favorites/toggle', {})).status).toBe(400);
  });

  it('toggles a saved station', async () => {
    const st = { id: 'radio:abc', title: 'Coastline FM', live: true, stream: '/api/stream/radio?u=x' };
    expect((await api.post('/api/stations/toggle', { track: st })).body).toEqual({ saved: true });
    expect((await api.post('/api/stations/toggle', { track: st })).body).toEqual({ saved: false });
  });

  it('counts a play once; a repeat within the song length is not counted', async () => {
    const t = byTitle('Paper Boats');
    const at = Date.now();
    expect((await api.post('/api/history', { track: t, at })).body).toEqual({ ok: true, counted: true, playCount: 1 });
    expect((await api.post('/api/history', { track: t, at: at + 5000 })).body).toEqual({ ok: true, counted: false, playCount: 1 });
    expect((await api.post('/api/history', { track: t, at: at + t.duration * 1000 })).body.counted).toBe(true);
    const st = (await api.get('/api/state')).body;
    expect(st.playCounts[t.id]).toBe(2);
    expect(st.history.filter((h) => h.track.id === t.id)).toHaveLength(2);
    expect((await api.del('/api/history', {})).body).toEqual({ ok: true });
    expect((await api.get('/api/state')).body.history).toEqual([]);
  });

  it('accepts now-playing reports', async () => {
    expect((await api.post('/api/nowplaying', { track: byTitle('Low Tide') })).body).toEqual({ ok: true });
  });
});

describe('playlists', () => {
  it('creates, renames, adds, exports as M3U and deletes', async () => {
    const a = byTitle('Morning Light');
    const b = byTitle('Low Tide');
    const p = (await api.post('/api/playlists', { name: 'Drive', tracks: [a] })).body;
    expect(p).toMatchObject({ name: 'Drive', tracks: [{ id: a.id }] });
    const up = (await api.put('/api/playlists/' + p.id, { name: 'Night drive', add: [b] })).body;
    expect(up.name).toBe('Night drive');
    expect(up.tracks.map((t) => t.id)).toEqual([a.id, b.id]);
    const m3u = await fetch(srv.url + `/api/playlists/${p.id}/m3u`);
    expect(m3u.headers.get('content-type')).toMatch(/audio\/x-mpegurl/);
    const text = await m3u.text();
    expect(text.startsWith('#EXTM3U\n#PLAYLIST:Night drive\n')).toBe(true);
    expect(text).toContain('#EXTINF:200,Nadia Vale - Morning Light');
    expect(text).toContain(path.join(srv.music, LIBRARY[0].file));
    expect((await api.put('/api/playlists/missing', { name: 'x' })).status).toBe(404);
    expect((await api.del('/api/playlists/' + p.id, {})).body).toEqual({ ok: true });
    expect((await fetch(srv.url + `/api/playlists/${p.id}/m3u`)).status).toBe(404);
  });
});

describe('lyrics', () => {
  it('reads a .lrc sidecar next to a local song first', async () => {
    const t = byTitle('Morning Light');
    const q = new URLSearchParams({ id: t.id, artist: t.artist, title: t.title, duration: t.duration });
    expect((await api.get('/api/lyrics?' + q)).body).toEqual({ found: true, synced: SIDECAR.text, plain: null, instrumental: false, source: 'file' });
  });

  it('finds an exact LRCLIB match', async () => {
    const t = byTitle('Slow River');
    const q = new URLSearchParams({ id: t.id, artist: t.artist, title: t.title, duration: t.duration });
    const r = (await api.get('/api/lyrics?' + q)).body;
    expect(r).toMatchObject({ found: true, synced: LRCLIB_SONG.syncedLyrics, source: 'lrclib' });
  });

  it('gives nothing for a wrong artist or a missing duration', async () => {
    const wrong = new URLSearchParams({ artist: 'Wrong Band', title: 'Slow River', duration: 190 });
    expect((await api.get('/api/lyrics?' + wrong)).body).toEqual({ found: false });
    const noLen = new URLSearchParams({ artist: 'Nadia Vale', title: 'Slow River' });
    expect((await api.get('/api/lyrics?' + noLen)).body).toEqual({ found: false });
  });
});

describe('online sources (through the fake internet)', () => {
  it('searches every source at once; Jamendo only with a client id', async () => {
    const { body } = await api.get('/api/search?q=river&src=audius,artists,archive,radio,jamendo');
    expect(Object.keys(body).sort()).toEqual(['archive', 'artists', 'audius', 'radio']);
    expect(body.audius.items[0].title).toBe('Harbor Lights');
    expect(body.artists.items[0].name).toBe('Kaito');
    expect(body.archive.items[0].identifier).toBe(ARCHIVE_DOC.identifier);
    expect(body.radio.items[0].title).toBe('Coastline FM');
    expect((await api.get('/api/search?q=')).body).toEqual({});
  });

  it('serves Audius trending and artist pages, Archive items and radio lists', async () => {
    expect((await api.get('/api/audius/trending')).body[0].id).toBe('audius:D7KyD');
    expect((await api.get('/api/audius/user/MWpwWPo')).body.artist.handle).toBe('kaito');
    expect((await api.get('/api/archive/item/' + ARCHIVE_DOC.identifier)).body.tracks).toHaveLength(2);
    expect((await api.get('/api/radio/top')).body).toHaveLength(1);
    expect((await api.get('/api/radio/search?q=coast')).body).toHaveLength(1);
    expect((await api.get('/api/radio/nowplaying?sid=x')).body).toEqual({ title: null });
    expect((await api.get('/api/jamendo/popular')).body).toEqual([]);
  });

  it('reports a failing source as a JSON error with its status', async () => {
    const r = await api.get('/api/audius/user/missing');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/returned 404/);
  });

  it('resolves SoundCloud links and rejects others', async () => {
    const t = (await api.get('/api/soundcloud/resolve?u=' + encodeURIComponent('Hear this: https://soundcloud.com/nadia-vale/slow-river?si=1'))).body.track;
    expect(t).toMatchObject({ source: 'soundcloud', kind: 'track', title: 'Slow River', link: 'https://soundcloud.com/nadia-vale/slow-river' });
    expect((await api.get('/api/soundcloud/resolve?u=' + encodeURIComponent('https://soundcloud.com/nadia-vale/sets/blue-hours'))).body.track.kind).toBe('set');
    expect((await api.get('/api/soundcloud/resolve?u=' + encodeURIComponent('https://soundcloud.com/nadia-vale'))).body.track.kind).toBe('artist');
    const stream = await api.get('/api/soundcloud/resolve?u=' + encodeURIComponent('https://soundcloud.com/stream'));
    expect(stream.status).toBe(400);
    expect(stream.body.error).toBe('Paste a link to a SoundCloud track, set or artist');
    const other = await api.get('/api/soundcloud/resolve?u=' + encodeURIComponent('https://example.com/song'));
    expect(other.status).toBe(400);
    expect(other.body.error).toBe('Not a SoundCloud link');
  });

  it('downloads only licensed songs from known hosts', async () => {
    expect((await api.post('/api/download', { track: { id: 'x', title: 'x' } })).body.error).toBe("This song isn't licensed for download");
    expect((await api.post('/api/download', { track: { id: 'x', title: 'x', download: 'https://evil.example/a.mp3' } })).body.error).toBe('Unknown source');
    expect((await api.post('/api/download', { track: { id: 'x', title: 'x', download: 'http://archive.org/a.mp3' } })).body.error).toBe('Unknown source');
    // Saved before Tunes knew about follower-only downloads: a clear answer instead of "403".
    const r = await api.post('/api/download', { track: { id: 'audius:F0LLw', title: 'Tide Tables', download: 'https://api.audius.co/v1/tracks/F0LLw/download?app_name=Tunes' } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('The artist allows downloading this song only to their followers on the source website');
  });

  it('validates a ListenBrainz token when it is saved', async () => {
    const bad = (await api.put('/api/settings', { listenbrainzToken: 'bad' })).body;
    expect(bad.listenbrainz).toEqual({ valid: false, user: null });
    expect(bad.state.settings.hasListenbrainz).toBe(false);
    const good = (await api.put('/api/settings', { listenbrainzToken: 'good-token' })).body;
    expect(good.listenbrainz).toEqual({ valid: true, user: 'tester' });
    expect(good.state.settings.listenbrainzToken).toBe('••••');
    await api.put('/api/settings', { listenbrainzToken: '' });
  });
});

describe('app icon', () => {
  it('changes the manifest and icon files, and tells every device over SSE', async () => {
    const sse = listen(srv.url);
    await sse.ready;
    const before = await api.get('/manifest.webmanifest');
    expect(before.body.icons[0].src).toBe('/icons/app-192.png?v=bars'); // Spectrum by default
    const r = await api.put('/api/settings', { icon: 'vinyl' });
    expect(r.body.state.settings.icon).toBe('vinyl');
    expect((await sse.next('icon')).data).toEqual({ icon: 'vinyl' });
    const m = (await api.get('/manifest.webmanifest')).body;
    expect(m.icons.map((i) => i.src)).toEqual(['/icons/app-192.png?v=vinyl', '/icons/app-512.png?v=vinyl', '/icons/app.svg?v=vinyl']);
    const png = Buffer.from(await (await fetch(srv.url + '/icons/app-512.png')).arrayBuffer());
    expect(png.equals(fs.readFileSync(path.join(ROOT, 'public/icons/vinyl/icon-512.png')))).toBe(true);
    const old = Buffer.from(await (await fetch(srv.url + '/icons/icon-192.png')).arrayBuffer());
    expect(old.equals(fs.readFileSync(path.join(ROOT, 'public/icons/vinyl/icon-192.png')))).toBe(true);
    const svg = await fetch(srv.url + '/icons/app.svg');
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    await api.put('/api/settings', { icon: 'nope' });
    expect((await api.get('/api/state')).body.settings.icon).toBe('vinyl');
    await api.put('/api/settings', { icon: 'bars' });
    sse.close();
  });
});

describe('appearance choices (theme, language, player style, buttons)', () => {
  it('are kept for every browser, merged key by key, checked, and sent to every device', async () => {
    const sse = listen(srv.url);
    await sse.ready;
    expect((await api.get('/api/state')).body.settings.prefs).toEqual({});
    await api.put('/api/settings', { prefs: { theme: 'light', lang: 'bs' } });
    expect((await sse.next('prefs')).data).toEqual({ theme: 'light', lang: 'bs' });
    // Unknown keys and values are dropped; the rest is merged.
    const r = await api.put('/api/settings', { prefs: { dialStyle: 'minimal', theme: 'pink', deckCtrls: 'beside', evil: 'x' } });
    expect(r.body.state.settings.prefs).toEqual({ theme: 'light', lang: 'bs', dialStyle: 'minimal', deckCtrls: 'beside' });
    expect((await sse.next('prefs', (d) => d.dialStyle === 'minimal')).data).toEqual({ theme: 'light', lang: 'bs', dialStyle: 'minimal', deckCtrls: 'beside' });
    await api.put('/api/settings', { prefs: null });
    expect((await api.get('/api/state')).body.settings.prefs).toEqual({});
    sse.close();
  });
});

describe('one player at a time (session and takeover)', () => {
  const track = { id: 'local:aaaaaaaaaaaaaaaa', title: 'Morning Light', duration: 200 };

  it('shares the session with other devices', async () => {
    const sse = listen(srv.url);
    await sse.ready;
    expect((await api.post('/api/session', { deviceId: 'A', device: 'computer', track, time: 42, playing: false, queue: [track], index: 0 })).body).toEqual({ ok: true });
    const ev = await sse.next('session', (d) => d.deviceId === 'A');
    expect(ev.data).toMatchObject({ deviceId: 'A', device: 'computer', time: 42, playing: false, track: { id: track.id } });
    expect(ev.data.queue).toBeUndefined();
    const { session } = (await api.get('/api/session')).body;
    expect(session).toMatchObject({ deviceId: 'A', time: 42, index: 0 });
    expect(session.queue).toHaveLength(1);
    expect((await api.post('/api/session', { deviceId: 'A' })).status).toBe(400);
    sse.close();
  });

  it('takeover pauses everyone else; a device that missed the event yields on its next report', async () => {
    const sse = listen(srv.url);
    await sse.ready;
    expect((await api.post('/api/session/takeover', { deviceId: 'B', device: 'mobile' })).body).toEqual({ ok: true });
    expect((await sse.next('takeover', (d) => d.deviceId === 'B')).data).toEqual({ deviceId: 'B', device: 'mobile' });
    // A was asleep and still thinks it is playing.
    expect((await api.post('/api/session', { deviceId: 'A', device: 'computer', track, time: 50, playing: true })).body).toEqual({ ok: true, yield: 'mobile' });
    // B itself keeps reporting normally.
    expect((await api.post('/api/session', { deviceId: 'B', device: 'mobile', track, time: 51, playing: true })).body).toEqual({ ok: true });
    expect((await api.post('/api/session/takeover', {})).status).toBe(400);
    sse.close();
  });
});

describe('export', () => {
  it('exports data without settings', async () => {
    const r = await fetch(srv.url + '/api/export');
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="tunes-\d{4}-\d{2}-\d{2}\.json"/);
    const d = await r.json();
    expect(d.settings).toBeUndefined();
    expect(d).toHaveProperty('favorites');
  });
});

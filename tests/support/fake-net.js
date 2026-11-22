// A fake internet for tests. It replaces global fetch() with canned answers from the
// services Tunes talks to (Audius, Internet Archive, Radio Browser, LRCLIB, SoundCloud
// oEmbed, ListenBrainz, Jamendo). Requests to localhost go through untouched; anything
// else fails like a machine without a network, so no test depends on the real internet.
//
// In-process (unit tests):  import { installFakeNet } from './fake-net.js'; installFakeNet();
// In a server process:      node --import ./tests/support/fake-net-preload.js server.ts

const realFetch = globalThis.fetch;

export const AUDIUS_TRACK = {
  id: 'D7KyD',
  title: 'Harbor Lights',
  duration: 245,
  genre: 'Electronic',
  release_date: '2023-04-01',
  permalink: '/kaito/harbor-lights',
  is_streamable: true,
  is_downloadable: true,
  artwork: { '480x480': 'https://creatornode.example/content/abc/480x480.jpg', mirrors: ['https://mirror1.example', 'https://mirror2.example'] },
  user: { id: 'MWpwWPo', name: 'Kaito', handle: 'kaito' },
};
export const AUDIUS_GATED = { ...AUDIUS_TRACK, id: 'G4t3d', title: 'Members Only', is_stream_gated: true };
// Streams for everyone, downloads only for the artist's followers on Audius.
export const AUDIUS_FOLLOWERS_DL = { ...AUDIUS_TRACK, id: 'F0LLw', title: 'Tide Tables', is_download_gated: true, download_conditions: { follow_user_id: 1 } };
export const AUDIUS_USER = {
  id: 'MWpwWPo', name: 'Kaito', handle: 'kaito', follower_count: 1200, track_count: 2, bio: 'Ambient from the coast',
  profile_picture: { '150x150': 'https://creatornode.example/content/u/150x150.jpg' },
};

// hearthis.at: one mix the DJ lets you download, one you may only stream.
const hearthisMix = (id, title, downloadable) => ({
  id, title, duration: '3605', genre: 'Afro House', release_date: '2026-11-01 20:00:00', private: '0',
  permalink_url: `https://hearthis.at/dj-amara/${id}/`, artwork_url: `https://img.hearthis.example/${id}.jpg`,
  stream_url: `https://hearthis.app/dj-amara/${id}/listen/`, downloadable: downloadable ? '1' : '0',
  download_url: downloadable ? `https://hearthis.app/dj-amara/${id}/download/` : '', user: { username: 'DJ Amara' },
});
export const HEARTHIS_FREE = hearthisMix('sunset-set', 'Sunset Afro Set', true);
export const HEARTHIS_STREAM = hearthisMix('club-night', 'Club Night Mix', false);

export const ARCHIVE_DOC = { identifier: 'fen1999-06-12.sbd', title: 'The Fen Lights Live at the Mill', creator: 'The Fen Lights', year: '1999' };
export const ARCHIVE_META = {
  metadata: { identifier: 'fen1999-06-12.sbd', title: 'The Fen Lights Live at the Mill', creator: 'The Fen Lights', date: '1999-06-12', description: '<p>Soundboard <b>recording</b>.</p>', licenseurl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/' },
  files: [
    { name: 'fen01.flac', format: 'Flac', length: '200.5' },
    { name: 'fen02 Intro.mp3', format: 'VBR MP3', title: 'Intro', track: '2', length: '1:05' },
    { name: 'fen01 Opening Song.mp3', format: 'VBR MP3', track: '1', length: '04:10' },
    { name: 'fen.png', format: 'PNG' },
  ],
};

export const RADIO_STATION = {
  stationuuid: '9617a958-0601-11e8-ae97-52543be04c81', name: '  Coastline FM ', url: 'http://stream.example/coast',
  url_resolved: 'http://stream.example/coast.mp3', homepage: 'https://coast.example', favicon: '',
  tags: 'jazz, lounge,chill', country: 'Bosnia and Herzegovina', codec: 'MP3', bitrate: 128,
};

// LRCLIB knows one song. /api/get answers for the title whatever the artist, like a
// fuzzy server would, so the tests prove that Tunes itself rejects wrong matches.
export const LRCLIB_SONG = {
  id: 1, trackName: 'Slow River', artistName: 'Nadia Vale', albumName: 'Blue Hours', duration: 190,
  instrumental: false, plainLyrics: 'Down by the slow river', syncedLyrics: '[00:02.00]Down by the slow river',
};

export const OEMBED = {
  '/nadia-vale/slow-river': { title: 'Slow River by Nadia Vale', author_name: 'Nadia Vale', thumbnail_url: 'https://i1.sndcdn.example/slow.jpg' },
  '/nadia-vale/sets/blue-hours': { title: 'Blue Hours by Nadia Vale', author_name: 'Nadia Vale', thumbnail_url: 'https://i1.sndcdn.example/blue.jpg' },
  '/nadia-vale': { title: 'Nadia Vale', author_name: 'Nadia Vale', thumbnail_url: null },
};
// Short share links redirect to the real page.
export const SC_SHORT = { '/aBcD1': 'https://soundcloud.com/nadia-vale/slow-river?si=123&utm_source=clipboard' };

export const requests = []; // every external URL asked for, for assertions
// The smallest valid PNG (1×1).
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const offline = (url) => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND ' + url.hostname) }));

// The canned answer for a URL, or null when the fake internet has none. Also used by the
// end-to-end tests of the phone-only version, where the browser asks the sources itself.
export function answer(url, init) {
  const q = url.searchParams;
  const host = url.hostname;
  const p = url.pathname;

  if (host === 'api.audius.co') {
    if (p === '/v1/tracks/search') return json({ data: [AUDIUS_TRACK, AUDIUS_GATED, AUDIUS_FOLLOWERS_DL] });
    if (p === '/v1/tracks/trending') return json({ data: [AUDIUS_TRACK, AUDIUS_GATED] });
    if (p === '/v1/users/search') return json({ data: [AUDIUS_USER, { ...AUDIUS_USER, id: 'empty', track_count: 0 }] });
    let m;
    if ((m = /^\/v1\/users\/(\w+)\/tracks$/.exec(p))) return json({ data: [AUDIUS_TRACK] });
    if ((m = /^\/v1\/tracks\/(\w+)\/download$/.exec(p))) return m[1] === AUDIUS_FOLLOWERS_DL.id ? json({ error: 'Forbidden' }, 403) : json({}, 404);
    if ((m = /^\/v1\/users\/(\w+)$/.exec(p))) return m[1] === AUDIUS_USER.id ? json({ data: AUDIUS_USER }) : json({}, 404);
  }

  // Covers: a real bitmap, and an SVG (which may carry a script, so Tunes must not serve it).
  if (host === 'img.example') {
    if (p === '/cover.png') return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (p === '/evil.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
  }

  if (host === 'api-v2.hearthis.at' && (p === '/search/' || p === '/feed/')) return json([HEARTHIS_FREE, HEARTHIS_STREAM, { ...HEARTHIS_FREE, id: 'secret', private: '1' }]);

  if (host === 'archive.org') {
    if (p.startsWith('/download/')) return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    if (p === '/advancedsearch.php') return json({ response: { docs: [ARCHIVE_DOC] } });
    if (p === '/metadata/' + ARCHIVE_DOC.identifier) return json(ARCHIVE_META);
    if (p.startsWith('/metadata/')) return json({});
  }

  if (host.endsWith('.api.radio-browser.info')) {
    if (p === '/json/stations/search' || p.startsWith('/json/stations/topclick/')) return json([RADIO_STATION, { ...RADIO_STATION, stationuuid: 'broken', url: '', url_resolved: '' }]);
    if (p.startsWith('/json/url/')) return json({ ok: true });
  }

  if (host === 'lrclib.net') {
    const hit = (q.get('track_name') || '').toLowerCase() === LRCLIB_SONG.trackName.toLowerCase();
    if (p === '/api/get') return hit ? json(LRCLIB_SONG) : json({ code: 404, name: 'TrackNotFound' }, 404);
    if (p === '/api/search') return json(hit ? [LRCLIB_SONG] : []);
  }

  if (host === 'soundcloud.com' && p === '/oembed') {
    const target = new URL(q.get('url'));
    const o = OEMBED[target.pathname];
    return o ? json(o) : json({ error: 'Not found' }, 404);
  }
  if (host === 'on.soundcloud.com') {
    const to = SC_SHORT[p];
    return to ? new Response(null, { status: 302, headers: { Location: to } }) : new Response('Not found', { status: 404 });
  }

  if (host === 'api.listenbrainz.org') {
    if (p === '/1/validate-token') {
      const ok = (init?.headers?.Authorization || '') === 'Token good-token';
      return json(ok ? { valid: true, user_name: 'tester' } : { valid: false });
    }
    if (p === '/1/submit-listens') return json({ status: 'ok' });
  }

  if (host === 'api.jamendo.com' && p === '/v3.0/tracks/') {
    if (q.get('client_id') !== 'good-client') return json({ headers: { status: 'failed', error_message: 'Your credential is not authorized.' }, results: [] });
    return json({ headers: { status: 'success' }, results: [{ id: '1886', name: 'Open Road', artist_name: 'Cielo', album_name: 'Maps', duration: 201, releasedate: '2020-02-02', album_image: 'https://img.jamendo.example/a.jpg', audio: 'https://prod-1.storage.jamendo.example/?trackid=1886', shareurl: 'https://www.jamendo.com/track/1886', audiodownload_allowed: true, audiodownload: 'https://prod-1.storage.jamendo.example/download/1886', musicinfo: { tags: { genres: ['pop'] } } }] });
  }

  return null;
}

export function fakeFetch(input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) return realFetch(input, init);
  requests.push(url.href);
  const res = answer(url, init);
  return res ? Promise.resolve(res) : offline(url);
}

export function installFakeNet() {
  globalThis.fetch = fakeFetch;
  return () => { globalThis.fetch = realFetch; };
}

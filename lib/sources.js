// Free and legal online sources. All results are converted to the same
// track shape as local files, so the player treats them the same way.
const UA = 'Tunes/1.0 (personal music player)';
const APP = 'Tunes';

async function getJSON(url, { timeout = 12000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const err = new Error(`${new URL(url).host} je vratio ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const enc = encodeURIComponent;
const proxied = (u) => '/api/stream/url?u=' + enc(u);

// ---------------------------------------------------------------- Audius
// Independent artists who publish their own music for free listening.
const AUDIUS = 'https://api.audius.co/v1';

// Audius covers live on several servers; if one is down, the server tries the mirrors.
function audiusArt(a) {
  const u = a?.['480x480'] || a?.['150x150'];
  if (!u) return null;
  const m = (a.mirrors || []).slice(0, 3).join(',');
  return '/api/img?u=' + enc(u) + (m ? '&m=' + enc(m) : '');
}

function audiusUser(u) {
  return {
    id: u.id,
    name: u.name || u.handle,
    handle: u.handle,
    followers: u.follower_count || 0,
    trackCount: u.track_count || 0,
    bio: u.bio || '',
    cover: audiusArt(u.profile_picture),
    link: 'https://audius.co/' + u.handle,
  };
}

function audiusTrack(t) {
  if (!t || t.is_streamable === false || t.is_stream_gated || t.is_delete) return null;
  return {
    id: 'audius:' + t.id,
    source: 'audius',
    title: t.title,
    artist: t.user?.name || t.user?.handle || 'Audius',
    album: t.album_backlink?.playlist_name || null,
    genre: t.genre || null,
    duration: t.duration || 0,
    year: t.release_date ? new Date(t.release_date).getFullYear() : null,
    cover: audiusArt(t.artwork),
    stream: '/api/stream/audius/' + t.id,
    link: t.permalink ? 'https://audius.co' + t.permalink : null,
    artistRef: t.user?.id ? 'audius:' + t.user.id : null,
    download: t.is_downloadable ? `${AUDIUS}/tracks/${t.id}/download?app_name=${APP}` : null,
  };
}

export const audius = {
  async search(q, limit = 30) {
    const d = await getJSON(`${AUDIUS}/tracks/search?query=${enc(q)}&limit=${limit}&app_name=${APP}`);
    return (d.data || []).map(audiusTrack).filter(Boolean);
  },
  async trending(genre = '', time = 'week') {
    const g = genre ? `&genre=${enc(genre)}` : '';
    const d = await getJSON(`${AUDIUS}/tracks/trending?time=${time}${g}&limit=40&app_name=${APP}`);
    return (d.data || []).map(audiusTrack).filter(Boolean);
  },
  async users(q, limit = 12) {
    const d = await getJSON(`${AUDIUS}/users/search?query=${enc(q)}&limit=${limit}&app_name=${APP}`);
    return (d.data || []).filter((u) => u.track_count > 0).map(audiusUser);
  },
  async user(id, sort = 'plays') {
    const [u, t] = await Promise.all([
      getJSON(`${AUDIUS}/users/${enc(id)}?app_name=${APP}`),
      getJSON(`${AUDIUS}/users/${enc(id)}/tracks?limit=100&sort=${sort === 'date' ? 'date' : 'plays'}&app_name=${APP}`),
    ]);
    return { artist: audiusUser(u.data), tracks: (t.data || []).map(audiusTrack).filter(Boolean) };
  },
  streamUrl(id) {
    return `${AUDIUS}/tracks/${enc(id)}/stream?app_name=${APP}`;
  },
};

// ---------------------------------------------------------------- Internet Archive
// Concert recordings (Live Music Archive), netlabel releases, public domain.
const IA_COLLECTIONS = '(collection:etree OR collection:netlabels OR collection:opensource_audio OR collection:audio_music OR collection:georgeblood OR collection:78rpm)';

function parseLength(v) {
  if (!v) return 0;
  if (String(v).includes(':')) return String(v).split(':').reduce((a, b) => a * 60 + Number(b), 0);
  return Math.round(Number(v)) || 0;
}

export const archive = {
  async search(q, rows = 30) {
    const query = `(${q}) AND (mediatype:audio OR mediatype:etree) AND ${IA_COLLECTIONS}`;
    const fl = ['identifier', 'title', 'creator', 'date', 'year'].map((f) => `fl[]=${f}`).join('&');
    const d = await getJSON(`https://archive.org/advancedsearch.php?q=${enc(query)}&${fl}&sort[]=downloads+desc&rows=${rows}&output=json`);
    return (d.response?.docs || []).map((x) => ({
      id: 'ia:' + x.identifier,
      identifier: x.identifier,
      source: 'archive',
      title: Array.isArray(x.title) ? x.title[0] : x.title || x.identifier,
      artist: (Array.isArray(x.creator) ? x.creator[0] : x.creator) || 'Internet Archive',
      year: x.year || (x.date ? String(x.date).slice(0, 4) : null),
      cover: `https://archive.org/services/img/${x.identifier}`,
    }));
  },

  async item(identifier) {
    if (!/^[\w.\-]+$/.test(identifier)) throw new Error('Invalid identifier');
    const d = await getJSON(`https://archive.org/metadata/${identifier}`, { timeout: 20000 });
    const m = d.metadata || {};
    const files = d.files || [];
    // The best format the browser is sure to play.
    const order = ['VBR MP3', 'MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac'];
    const fmt = order.find((f) => files.some((x) => x.format === f));
    if (!fmt) return { album: albumInfo(identifier, m), tracks: [] };
    const album = albumInfo(identifier, m);
    const tracks = files
      .filter((f) => f.format === fmt)
      .map((f, i) => {
        const url = `https://archive.org/download/${identifier}/${f.name.split('/').map(enc).join('/')}`;
        return {
          id: `ia:${identifier}/${f.name}`,
          source: 'archive',
          title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '),
          artist: f.creator || f.artist || album.artist,
          album: album.title,
          albumArtist: album.artist,
          year: album.year,
          trackNo: parseInt(f.track, 10) || i + 1,
          duration: parseLength(f.length),
          cover: album.cover,
          stream: proxied(url),
          link: `https://archive.org/details/${identifier}`,
          download: url,
          ext: '.' + f.name.split('.').pop().toLowerCase(),
        };
      })
      .sort((a, b) => a.trackNo - b.trackNo);
    return { album: { ...album, license: m.licenseurl || null }, tracks };
  },
};

function albumInfo(identifier, m) {
  const pick = (v) => (Array.isArray(v) ? v[0] : v);
  return {
    id: 'ia:' + identifier,
    identifier,
    title: pick(m.title) || identifier,
    artist: pick(m.creator) || 'Internet Archive',
    year: m.year || (m.date ? String(pick(m.date)).slice(0, 4) : null),
    description: String(pick(m.description) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
    cover: `https://archive.org/services/img/${identifier}`,
    link: `https://archive.org/details/${identifier}`,
  };
}

// ---------------------------------------------------------------- Radio Browser
// An open database of over 40,000 internet radio stations.
const RADIO_HOSTS = ['de1.api.radio-browser.info', 'fi1.api.radio-browser.info', 'de2.api.radio-browser.info', 'nl1.api.radio-browser.info'];

async function radioGet(pathAndQuery) {
  let lastErr;
  for (const host of RADIO_HOSTS) {
    try { return await getJSON(`https://${host}${pathAndQuery}`, { timeout: 8000 }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function radioTrack(s) {
  const url = s.url_resolved || s.url;
  if (!url) return null;
  const tags = (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    id: 'radio:' + s.stationuuid,
    source: 'radio',
    title: s.name.trim(),
    artist: [s.country, tags.slice(0, 2).join(', ')].filter(Boolean).join(' / ') || 'Internet radio',
    album: s.codec ? `${s.codec}${s.bitrate ? ' ' + s.bitrate + ' kbps' : ''}` : null,
    genre: tags[0] || null,
    cover: s.favicon || null,
    stream: `/api/stream/radio?sid=${enc(s.stationuuid)}&u=${enc(url)}`,
    link: s.homepage || null,
    live: true,
  };
}

export const radio = {
  async search({ q = '', tag = '', countrycode = '', limit = 60 } = {}) {
    const p = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit) });
    if (q) p.set('name', q);
    if (tag) p.set('tag', tag);
    if (countrycode) p.set('countrycode', countrycode);
    const d = await radioGet('/json/stations/search?' + p);
    return d.map(radioTrack).filter(Boolean);
  },
  async top(limit = 60) {
    const d = await radioGet(`/json/stations/topclick/${limit}?hidebroken=true`);
    return d.map(radioTrack).filter(Boolean);
  },
  // Tells the database the station was played (this drives its popularity ranking).
  click(uuid) {
    radioGet('/json/url/' + enc(uuid)).catch(() => {});
  },
};

// ---------------------------------------------------------------- Jamendo
// Creative Commons music. Requires a free client_id from devportal.jamendo.com.
function jamendoTrack(t) {
  return {
    id: 'jamendo:' + t.id,
    source: 'jamendo',
    title: t.name,
    artist: t.artist_name,
    album: t.album_name || null,
    duration: t.duration || 0,
    year: t.releasedate ? String(t.releasedate).slice(0, 4) : null,
    genre: t.musicinfo?.tags?.genres?.[0] || null,
    cover: t.album_image || t.image || null,
    stream: proxied(t.audio),
    link: t.shareurl || null,
    download: t.audiodownload_allowed ? t.audiodownload : null,
    ext: '.mp3',
  };
}

export const jamendo = {
  async search(q, clientId, limit = 30) {
    if (!clientId) return [];
    const d = await getJSON(`https://api.jamendo.com/v3.0/tracks/?client_id=${enc(clientId)}&format=json&limit=${limit}&search=${enc(q)}&audioformat=mp32&include=musicinfo`);
    if (d.headers?.status === 'failed') throw new Error('Jamendo: ' + d.headers.error_message);
    return (d.results || []).map(jamendoTrack);
  },
  async popular(clientId, tag = '') {
    if (!clientId) return [];
    const t = tag ? `&tags=${enc(tag)}` : '';
    const d = await getJSON(`https://api.jamendo.com/v3.0/tracks/?client_id=${enc(clientId)}&format=json&limit=40&order=popularity_week&audioformat=mp32&include=musicinfo${t}`);
    if (d.headers?.status === 'failed') throw new Error('Jamendo: ' + d.headers.error_message);
    return (d.results || []).map(jamendoTrack);
  },
};

// ---------------------------------------------------------------- LRCLIB
// An open lyrics database, often time-synced.
const lyricsCache = new Map();

export async function lyrics({ artist, title, album, duration }) {
  const key = [artist, title].join('|').toLowerCase();
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const clean = (s) => String(s || '').replace(/\s*[([][^)\]]*(remaster|live|version|mix|edit)[^)\]]*[)\]]/gi, '').trim();
  let hit = null;
  try {
    const p = new URLSearchParams({ artist_name: clean(artist), track_name: clean(title) });
    if (album) p.set('album_name', album);
    if (duration) p.set('duration', String(Math.round(duration)));
    hit = await getJSON('https://lrclib.net/api/get?' + p, { timeout: 8000 });
  } catch (e) {
    if (e.status !== 404 && e.status !== 400) throw e;
  }
  if (!hit) {
    const p = new URLSearchParams({ track_name: clean(title), artist_name: clean(artist) });
    const list = await getJSON('https://lrclib.net/api/search?' + p, { timeout: 8000 });
    if (Array.isArray(list) && list.length) {
      list.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics))
        || Math.abs((a.duration || 0) - (duration || 0)) - Math.abs((b.duration || 0) - (duration || 0)));
      hit = list[0];
    }
  }
  const out = hit
    ? { found: true, synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null, instrumental: Boolean(hit.instrumental) }
    : { found: false };
  lyricsCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- ListenBrainz
// Open listening history and recommendations (MetaBrainz Foundation).
export const listenbrainz = {
  async validate(token) {
    const d = await getJSON('https://api.listenbrainz.org/1/validate-token', { headers: { Authorization: 'Token ' + token } });
    return { valid: Boolean(d.valid), user: d.user_name || null };
  },
  async submit(token, type, track, listenedAt) {
    if (!token || !track?.artist || !track?.title) return;
    const info = {
      media_player: 'Tunes',
      submission_client: 'Tunes',
      submission_client_version: '1.0',
    };
    if (track.duration) info.duration_ms = Math.round(track.duration * 1000);
    if (track.link) info.origin_url = track.link;
    if (track.source && track.source !== 'local') info.music_service_name = { audius: 'Audius', archive: 'Internet Archive', jamendo: 'Jamendo', radio: 'Internet radio' }[track.source];
    const listen = { track_metadata: { artist_name: track.artist, track_name: track.title, additional_info: info } };
    if (track.album) listen.track_metadata.release_name = track.album;
    if (type === 'single') listen.listened_at = Math.floor((listenedAt || Date.now()) / 1000);
    const res = await fetch('https://api.listenbrainz.org/1/submit-listens', {
      method: 'POST',
      headers: { Authorization: 'Token ' + token, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ listen_type: type, payload: [listen] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('ListenBrainz: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  },
};

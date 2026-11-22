// Free and legal online sources. All results are converted to the same
// track shape as local files, so the player treats them the same way.
// Runs on the server and, in the phone-only version, in the browser (every API here
// allows cross-origin requests), so it uses only fetch and Web Crypto.
import { httpError } from './types.ts';
import type { HttpError, Track } from './types.ts';

const UA = 'Tunes/1.0 (personal music player)';
const APP = 'Tunes';
// Browsers send their own User-Agent; setting one would only add a CORS preflight.
const UA_HEADER: Record<string, string> = 'document' in globalThis ? {} : { 'User-Agent': UA };

async function sha1(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getJSON<T = any>(url: string, { timeout = 12000, headers = {} }: { timeout?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, { headers: { ...UA_HEADER, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw httpError(`${new URL(url).host} returned ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;
const proxied = (u: string): string => '/api/stream/url?u=' + enc(u);
const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

// ---------------------------------------------------------------- Audius
// Independent artists who publish their own music for free listening.
const AUDIUS = 'https://api.audius.co/v1';

interface AudiusArtwork { '150x150'?: string; '480x480'?: string; mirrors?: string[] }
interface AudiusUserRaw {
  id: string; name?: string; handle: string; follower_count?: number; track_count?: number; bio?: string;
  profile_picture?: AudiusArtwork | null;
}
interface AudiusTrackRaw {
  id: string; title: string; duration?: number; genre?: string; release_date?: string; permalink?: string;
  is_streamable?: boolean; is_stream_gated?: boolean; is_delete?: boolean; is_downloadable?: boolean;
  artwork?: AudiusArtwork | null; user?: { id?: string; name?: string; handle?: string };
  album_backlink?: { playlist_name?: string } | null;
}

export interface AudiusArtist {
  id: string; name: string; handle: string; followers: number; trackCount: number; bio: string; cover: string | null; link: string;
}

// Audius covers live on several servers; if one is down, the server tries the mirrors.
function audiusArt(a: AudiusArtwork | null | undefined): string | null {
  const u = a?.['480x480'] || a?.['150x150'];
  if (!u) return null;
  const m = (a?.mirrors || []).slice(0, 3).join(',');
  return '/api/img?u=' + enc(u) + (m ? '&m=' + enc(m) : '');
}

function audiusUser(u: AudiusUserRaw): AudiusArtist {
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

function audiusTrack(t: AudiusTrackRaw | null | undefined): Track | null {
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

const tracksOf = (list: AudiusTrackRaw[] | undefined): Track[] => (list || []).map(audiusTrack).filter((t): t is Track => t !== null);

export const audius = {
  async search(q: string, limit = 30): Promise<Track[]> {
    const d = await getJSON<{ data?: AudiusTrackRaw[] }>(`${AUDIUS}/tracks/search?query=${enc(q)}&limit=${limit}&app_name=${APP}`);
    return tracksOf(d.data);
  },
  async trending(genre = '', time = 'week'): Promise<Track[]> {
    const g = genre ? `&genre=${enc(genre)}` : '';
    const d = await getJSON<{ data?: AudiusTrackRaw[] }>(`${AUDIUS}/tracks/trending?time=${time}${g}&limit=40&app_name=${APP}`);
    return tracksOf(d.data);
  },
  async users(q: string, limit = 12): Promise<AudiusArtist[]> {
    const d = await getJSON<{ data?: AudiusUserRaw[] }>(`${AUDIUS}/users/search?query=${enc(q)}&limit=${limit}&app_name=${APP}`);
    return (d.data || []).filter((u) => (u.track_count || 0) > 0).map(audiusUser);
  },
  async user(id: string, sort = 'plays'): Promise<{ artist: AudiusArtist; tracks: Track[] }> {
    const [u, t] = await Promise.all([
      getJSON<{ data: AudiusUserRaw }>(`${AUDIUS}/users/${enc(id)}?app_name=${APP}`),
      getJSON<{ data?: AudiusTrackRaw[] }>(`${AUDIUS}/users/${enc(id)}/tracks?limit=100&sort=${sort === 'date' ? 'date' : 'plays'}&app_name=${APP}`),
    ]);
    return { artist: audiusUser(u.data), tracks: tracksOf(t.data) };
  },
  streamUrl(id: string): string {
    return `${AUDIUS}/tracks/${enc(id)}/stream?app_name=${APP}`;
  },
};

// ---------------------------------------------------------------- Internet Archive
// Concert recordings (Live Music Archive), netlabel releases, public domain.
const IA_COLLECTIONS = '(collection:etree OR collection:netlabels OR collection:opensource_audio OR collection:audio_music OR collection:georgeblood OR collection:78rpm)';

type MaybeList = string | string[] | undefined;
interface ArchiveDoc { identifier: string; title?: MaybeList; creator?: MaybeList; date?: string; year?: string }
interface ArchiveFile { name: string; format?: string; title?: string; creator?: string; artist?: string; track?: string; length?: string }
interface ArchiveMeta { title?: MaybeList; creator?: MaybeList; date?: MaybeList; year?: string; description?: MaybeList; licenseurl?: string }

export interface ArchiveAlbum {
  id: string; identifier: string; title: string; artist: string; year: string | null; description: string; cover: string; link: string;
  license?: string | null;
}
export interface ArchiveResult {
  id: string; identifier: string; source: 'archive'; title: string; artist: string; year: string | null; cover: string;
}

export function parseLength(v: unknown): number {
  if (!v) return 0;
  if (String(v).includes(':')) return String(v).split(':').reduce((a, b) => a * 60 + Number(b), 0);
  return Math.round(Number(v)) || 0;
}

export const archive = {
  async search(q: string, rows = 30): Promise<ArchiveResult[]> {
    const query = `(${q}) AND (mediatype:audio OR mediatype:etree) AND ${IA_COLLECTIONS}`;
    const fl = ['identifier', 'title', 'creator', 'date', 'year'].map((f) => `fl[]=${f}`).join('&');
    const d = await getJSON<{ response?: { docs?: ArchiveDoc[] } }>(`https://archive.org/advancedsearch.php?q=${enc(query)}&${fl}&sort[]=downloads+desc&rows=${rows}&output=json`);
    return (d.response?.docs || []).map((x) => ({
      id: 'ia:' + x.identifier,
      identifier: x.identifier,
      source: 'archive' as const,
      title: first(x.title) || x.identifier,
      artist: first(x.creator) || 'Internet Archive',
      year: x.year || (x.date ? String(x.date).slice(0, 4) : null),
      cover: `https://archive.org/services/img/${x.identifier}`,
    }));
  },

  async item(identifier: string): Promise<{ album: ArchiveAlbum; tracks: Track[] }> {
    if (!/^[\w.\-]+$/.test(identifier)) throw new Error('Invalid identifier');
    const d = await getJSON<{ metadata?: ArchiveMeta; files?: ArchiveFile[] }>(`https://archive.org/metadata/${identifier}`, { timeout: 20000 });
    const m = d.metadata || {};
    const files = d.files || [];
    // The best format the browser is sure to play.
    const order = ['VBR MP3', 'MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac'];
    const fmt = order.find((f) => files.some((x) => x.format === f));
    if (!fmt) return { album: albumInfo(identifier, m), tracks: [] };
    const album = albumInfo(identifier, m);
    const tracks = files
      .filter((f) => f.format === fmt)
      .map((f, i): Track & { trackNo: number } => {
        const url = `https://archive.org/download/${identifier}/${f.name.split('/').map(enc).join('/')}`;
        return {
          id: `ia:${identifier}/${f.name}`,
          source: 'archive',
          title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '),
          artist: f.creator || f.artist || album.artist,
          album: album.title,
          albumArtist: album.artist,
          year: album.year,
          trackNo: parseInt(f.track || '', 10) || i + 1,
          duration: parseLength(f.length),
          cover: album.cover,
          stream: proxied(url),
          link: `https://archive.org/details/${identifier}`,
          download: url,
          ext: '.' + (f.name.split('.').pop() || '').toLowerCase(),
        };
      })
      .sort((a, b) => a.trackNo - b.trackNo);
    return { album: { ...album, license: m.licenseurl || null }, tracks };
  },
};

function albumInfo(identifier: string, m: ArchiveMeta): ArchiveAlbum {
  return {
    id: 'ia:' + identifier,
    identifier,
    title: first(m.title) || identifier,
    artist: first(m.creator) || 'Internet Archive',
    year: m.year || (m.date ? String(first(m.date)).slice(0, 4) : null),
    description: String(first(m.description) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
    cover: `https://archive.org/services/img/${identifier}`,
    link: `https://archive.org/details/${identifier}`,
  };
}

// ---------------------------------------------------------------- Radio Browser
// An open database of over 40,000 internet radio stations.
const RADIO_HOSTS = ['de1.api.radio-browser.info', 'fi1.api.radio-browser.info', 'de2.api.radio-browser.info', 'nl1.api.radio-browser.info'];

interface Station {
  stationuuid: string; name: string; url?: string; url_resolved?: string; homepage?: string; favicon?: string;
  tags?: string; country?: string; codec?: string; bitrate?: number;
}

async function radioGet<T>(pathAndQuery: string): Promise<T> {
  let lastErr: unknown;
  for (const host of RADIO_HOSTS) {
    try { return await getJSON<T>(`https://${host}${pathAndQuery}`, { timeout: 8000 }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function radioTrack(s: Station): Track | null {
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

const stationsOf = (list: Station[]): Track[] => list.map(radioTrack).filter((t): t is Track => t !== null);

export const radio = {
  async search({ q = '', tag = '', countrycode = '', limit = 60 }: { q?: string; tag?: string; countrycode?: string; limit?: number } = {}): Promise<Track[]> {
    const p = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit) });
    if (q) p.set('name', q);
    if (tag) p.set('tag', tag);
    if (countrycode) p.set('countrycode', countrycode);
    return stationsOf(await radioGet<Station[]>('/json/stations/search?' + p));
  },
  async top(limit = 60): Promise<Track[]> {
    return stationsOf(await radioGet<Station[]>(`/json/stations/topclick/${limit}?hidebroken=true`));
  },
  // Tells the database the station was played (this drives its popularity ranking).
  click(uuid: string): void {
    radioGet('/json/url/' + enc(uuid)).catch(() => {});
  },
};

// ---------------------------------------------------------------- Jamendo
// Creative Commons music. Requires a free client_id from devportal.jamendo.com.
interface JamendoTrackRaw {
  id: string; name: string; artist_name: string; album_name?: string; duration?: number; releasedate?: string;
  album_image?: string; image?: string; audio: string; shareurl?: string; audiodownload_allowed?: boolean; audiodownload?: string;
  musicinfo?: { tags?: { genres?: string[] } };
}
interface JamendoReply { headers?: { status?: string; error_message?: string }; results?: JamendoTrackRaw[] }

function jamendoTrack(t: JamendoTrackRaw): Track {
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

function jamendoTracks(d: JamendoReply): Track[] {
  if (d.headers?.status === 'failed') throw new Error('Jamendo: ' + d.headers.error_message);
  return (d.results || []).map(jamendoTrack);
}

export const jamendo = {
  async search(q: string, clientId: string, limit = 30): Promise<Track[]> {
    if (!clientId) return [];
    return jamendoTracks(await getJSON<JamendoReply>(`https://api.jamendo.com/v3.0/tracks/?client_id=${enc(clientId)}&format=json&limit=${limit}&search=${enc(q)}&audioformat=mp32&include=musicinfo`));
  },
  async popular(clientId: string, tag = ''): Promise<Track[]> {
    if (!clientId) return [];
    const t = tag ? `&tags=${enc(tag)}` : '';
    return jamendoTracks(await getJSON<JamendoReply>(`https://api.jamendo.com/v3.0/tracks/?client_id=${enc(clientId)}&format=json&limit=40&order=popularity_week&audioformat=mp32&include=musicinfo${t}`));
  },
};

// ---------------------------------------------------------------- SoundCloud
// SoundCloud's API needs a paid key, so pasted links play through the official embedded
// player (Widget API) in the browser. The server only checks the link and reads the title
// and artwork through oEmbed.
const SC_HOSTS = /^(www\.|m\.)?soundcloud\.com$/;
const SC_SHORT = /^(on\.soundcloud\.com|snd\.sc)$/;

export const soundcloud = {
  // A SoundCloud address from free text (a pasted share message may contain more words).
  find(text: unknown): string | null {
    const m = /https?:\/\/(?:www\.|m\.|on\.)?(?:soundcloud\.com|snd\.sc)\/[^\s"'<>]+/i.exec(String(text || ''));
    return m ? m[0] : null;
  },

  async canonical(raw: string): Promise<string> {
    let u: URL;
    try { u = new URL(raw); } catch { throw httpError('Invalid address', 400); }
    // Short links from the app share button redirect to the real page.
    const short = SC_SHORT.test(u.hostname);
    for (let hops = 0; SC_SHORT.test(u.hostname) && hops < 4; hops++) {
      const r = await fetch(u, { redirect: 'manual', headers: UA_HEADER, signal: AbortSignal.timeout(8000) });
      const loc = r.headers.get('location');
      if (!loc) break;
      u = new URL(loc, u);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw httpError('Invalid address', 400);
    if (!SC_HOSTS.test(u.hostname)) {
      throw httpError(short ? "This SoundCloud link doesn't exist or is private" : 'Not a SoundCloud link', short ? 404 : 400);
    }
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length || ['discover', 'stream', 'search', 'feed', 'you', 'upload', 'charts'].includes(parts[0])) {
      throw httpError('Paste a link to a SoundCloud track, set or artist', 400);
    }
    // Private links keep their secret token (s-xxxx); share and tracking parameters are dropped.
    return 'https://soundcloud.com/' + parts.map(decodeURIComponent).map(enc).join('/');
  },

  async resolve(raw: string): Promise<Track> {
    const url = await this.canonical(raw);
    let o: { title?: string; author_name?: string; thumbnail_url?: string | null };
    try {
      o = await getJSON('https://soundcloud.com/oembed?format=json&url=' + enc(url));
    } catch (e) {
      const status = (e as HttpError).status;
      throw httpError(status === 404 || status === 403 ? "This SoundCloud link doesn't exist or is private" : 'SoundCloud is not responding', 404);
    }
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const kind = parts[1] === 'sets' ? 'set' : parts.length === 1 ? 'artist' : 'track';
    const artist = o.author_name || '';
    // oEmbed titles look like "Song by Artist".
    let title = String(o.title || '').trim();
    if (artist && title.endsWith(' by ' + artist)) title = title.slice(0, -(' by ' + artist).length);
    const cover = o.thumbnail_url || null;
    return {
      id: 'soundcloud:' + (await sha1(url)).slice(0, 16),
      source: 'soundcloud',
      title: title || url,
      artist,
      album: kind === 'set' ? title : undefined,
      cover,
      link: url,
      stream: url, // played by the SoundCloud widget, never downloaded
      kind,
    };
  },
};

// ---------------------------------------------------------------- LRCLIB
// Lyrics from LRCLIB (open database). Wrong lyrics are worse than none, so a result is
// only used when artist, title and length all match the song.
export interface LyricsResult {
  found: boolean;
  synced?: string | null;
  plain?: string | null;
  instrumental?: boolean;
  source?: string;
}
interface LrclibHit { trackName?: string; artistName?: string; duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean }

const lyricsCache = new Map<string, LyricsResult>();

export const lyricKey = (s: unknown): string => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*[([][^)\]]*[)\]]/g, ' ')            // (Remastered 2011), [Live]
  .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/, '') // feat. Someone
  .replace(/\s+-\s+(remaster|live|radio edit|single version).*$/, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export const mainArtist = (s: unknown): string => lyricKey(String(s || '').split(/\s*(?:,|&|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bvs\.?)\s*/i)[0]);

export function sameSong(hit: LrclibHit | null | undefined, { artist, title, duration }: { artist?: string | null; title?: string | null; duration?: number }): boolean {
  if (!hit || lyricKey(hit.trackName) !== lyricKey(title) || !lyricKey(title)) return false;
  const a = lyricKey(artist), b = lyricKey(hit.artistName);
  if (!a || !(a === b || mainArtist(artist) === mainArtist(hit.artistName))) return false;
  // LRCLIB itself treats +-2 s as the same recording; allow 3 s.
  if (duration && hit.duration && Math.abs(hit.duration - duration) > 3) return false;
  if (!duration) return false; // without the length we can't be sure it is the same recording
  return true;
}

export async function lyrics({ artist, title, album, duration = 0 }: { artist?: string | null; title?: string | null; album?: string | null; duration?: number }): Promise<LyricsResult> {
  if (!title || !artist) return { found: false };
  if (duration > 20 * 60) return { found: false }; // sets and mixes
  const key = [artist, title, Math.round(duration || 0)].join('|').toLowerCase();
  const cached = lyricsCache.get(key);
  if (cached) return cached;
  const clean = (s: string) => String(s || '').replace(/\s*[([][^)\]]*(remaster|live|version|mix|edit)[^)\]]*[)\]]/gi, '').trim();
  let hit: LrclibHit | null = null;
  try {
    const p = new URLSearchParams({ artist_name: clean(artist), track_name: clean(title) });
    if (album) p.set('album_name', album);
    if (duration) p.set('duration', String(Math.round(duration)));
    hit = await getJSON<LrclibHit>('https://lrclib.net/api/get?' + p, { timeout: 8000 });
    if (!sameSong(hit, { artist, title, duration })) hit = null;
  } catch (e) {
    const status = (e as HttpError).status;
    if (status !== 404 && status !== 400) throw e;
  }
  if (!hit) {
    const p = new URLSearchParams({ track_name: clean(title), artist_name: clean(artist) });
    const list = await getJSON<unknown>('https://lrclib.net/api/search?' + p, { timeout: 8000 });
    const matches = (Array.isArray(list) ? list as LrclibHit[] : []).filter((x) => sameSong(x, { artist, title, duration }));
    matches.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics))
      || Math.abs((a.duration || 0) - duration) - Math.abs((b.duration || 0) - duration));
    hit = matches[0] || null;
  }
  const out: LyricsResult = hit && (hit.syncedLyrics || hit.plainLyrics || hit.instrumental)
    ? { found: true, synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null, instrumental: Boolean(hit.instrumental), source: 'lrclib' }
    : { found: false };
  lyricsCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- ListenBrainz
// Open listening history and recommendations (MetaBrainz Foundation).
export const listenbrainz = {
  async validate(token: string): Promise<{ valid: boolean; user: string | null }> {
    const d = await getJSON<{ valid?: boolean; user_name?: string }>('https://api.listenbrainz.org/1/validate-token', { headers: { Authorization: 'Token ' + token } });
    return { valid: Boolean(d.valid), user: d.user_name || null };
  },
  async submit(token: string, type: 'single' | 'playing_now', track: Partial<Track> | null | undefined, listenedAt?: number): Promise<void> {
    if (!token || !track?.artist || !track?.title) return;
    const info: Record<string, unknown> = {
      media_player: 'Tunes',
      submission_client: 'Tunes',
      submission_client_version: '1.0',
    };
    if (track.duration) info.duration_ms = Math.round(track.duration * 1000);
    if (track.link) info.origin_url = track.link;
    if (track.source && track.source !== 'local') {
      info.music_service_name = ({ audius: 'Audius', archive: 'Internet Archive', jamendo: 'Jamendo', radio: 'Internet radio' } as Record<string, string>)[track.source];
    }
    const meta: Record<string, unknown> = { artist_name: track.artist, track_name: track.title, additional_info: info };
    if (track.album) meta.release_name = track.album;
    const listen: Record<string, unknown> = { track_metadata: meta };
    if (type === 'single') listen.listened_at = Math.floor((listenedAt || Date.now()) / 1000);
    const res = await fetch('https://api.listenbrainz.org/1/submit-listens', {
      method: 'POST',
      headers: { Authorization: 'Token ' + token, 'Content-Type': 'application/json', ...UA_HEADER },
      body: JSON.stringify({ listen_type: type, payload: [listen] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('ListenBrainz: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  },
};

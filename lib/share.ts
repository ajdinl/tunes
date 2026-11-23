// Sharing a song or a playlist by link. Everything travels in the link itself (after the #, so it
// never reaches a server) and opens in the phone-only version, which works for anyone without
// the sender's computer. A link is data from a stranger: only known sources come through, with
// addresses shaped the way Tunes makes them for that source.
import { cleanTrack } from './data.ts';
import type { Track } from './types.ts';

// Where shared links open (the phone-only build on GitHub Pages).
export const PUBLIC_APP = 'https://ajdinl.github.io/tunes/';

// Files on the computer can't be reached by anyone else; a Jamendo address carries the
// user's own client id.
const SHAREABLE = ['audius', 'archive', 'hearthis', 'radio', 'soundcloud'];
const FIELDS = ['source', 'id', 'title', 'artist', 'album', 'duration', 'cover', 'stream', 'link', 'live', 'kind', 'year', 'artistRef'] as const;

export const canShare = (t: Track | null | undefined): t is Track => Boolean(t && SHAREABLE.includes(String(t.source)) && t.stream && t.id);

// ---------------------------------------------------------------- encoding
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const base64UrlToBytes = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const toBase64Url = (s: string): string => bytesToBase64Url(new TextEncoder().encode(s));
const fromBase64Url = (s: string): string => new TextDecoder().decode(base64UrlToBytes(s));

const pick = (t: Track): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (t[k] !== undefined && t[k] !== null && t[k] !== '') out[k] = t[k];
  return out;
};

export function shareLink(t: Track, base = PUBLIC_APP): string | null {
  return canShare(t) ? base + 'shared#' + toBase64Url(JSON.stringify(pick(t))) : null;
}

// ---------------------------------------------------------------- playlists
// A playlist link is compressed (the same addresses repeat in every song), so a few hundred
// songs still fit in a chat message. 'p1.' tells it apart from a song link.
const PLAYLIST_TAG = 'p1.';
const MAX_TRACKS = 500;
const MAX_JSON = 2_000_000; // a small link must not unpack into something huge

export interface SharedPlaylist { name: string; tracks: Track[] }

export const isPlaylistHash = (hash: string): boolean => hash.replace(/^#/, '').startsWith(PLAYLIST_TAG);

async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(through).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The songs of a playlist that others can play (files on the computer and Jamendo are left out).
export const shareable = (tracks: Track[]): Track[] => tracks.filter((t) => canShare(t)).slice(0, MAX_TRACKS);

export async function playlistLink(name: string, tracks: Track[], base = PUBLIC_APP): Promise<string | null> {
  const list = shareable(tracks);
  if (!list.length) return null;
  const json = new TextEncoder().encode(JSON.stringify({ name, tracks: list.map(pick) }));
  return base + 'shared#' + PLAYLIST_TAG + bytesToBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

// The playlist from the part after the #, or null for a broken or foreign link. Songs that
// don't pass the same checks as a shared song are dropped; the rest still play.
export async function readSharedPlaylist(hash: string): Promise<SharedPlaylist | null> {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith(PLAYLIST_TAG)) return null;
  let raw: { name?: unknown; tracks?: unknown };
  try {
    const bytes = await pipe(base64UrlToBytes(h.slice(PLAYLIST_TAG.length)), new DecompressionStream('deflate-raw'), MAX_JSON);
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return null;
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const r of raw.tracks.slice(0, MAX_TRACKS)) {
    const t = checkTrack(r);
    if (t && !seen.has(t.id)) { seen.add(t.id); tracks.push(t); }
  }
  if (!tracks.length) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
  return { name, tracks };
}

// ---------------------------------------------------------------- checking a received link
const url = (u: unknown): URL | null => {
  if (typeof u !== 'string' || u.length > 2000) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x : null; } catch { return null; }
};
const host = (u: URL | null, ...names: string[]): boolean => Boolean(u && names.some((n) => u.hostname === n || u.hostname.endsWith('.' + n)));
// The source address inside one of Tunes' own proxy paths ('/api/stream/url?u=…').
const inner = (path: string, prefix: string): URL | null =>
  path.startsWith(prefix) ? url(new URLSearchParams(path.slice(path.indexOf('?'))).get('u')) : null;

const STREAM_OK: Record<string, (s: string) => boolean> = {
  audius: (s) => /^\/api\/stream\/audius\/\w{1,40}$/.test(s),
  archive: (s) => { const u = inner(s, '/api/stream/url?'); return u?.protocol === 'https:' && u.hostname === 'archive.org' && u.pathname.startsWith('/download/'); },
  hearthis: (s) => host(inner(s, '/api/stream/url?'), 'hearthis.at'),
  radio: (s) => Boolean(inner(s, '/api/stream/radio?')),
  soundcloud: (s) => host(url(s), 'soundcloud.com'),
};

const coverOk = (c: unknown): boolean => {
  if (typeof c !== 'string') return false;
  if (c.startsWith('/api/img?')) return url(new URLSearchParams(c.slice(8)).get('u'))?.protocol === 'https:';
  return url(c)?.protocol === 'https:';
};

// The song from the part after the #, or null for a broken or foreign link.
export function readShared(hash: string): Track | null {
  try { return checkTrack(JSON.parse(fromBase64Url(hash.replace(/^#/, '')))); } catch { return null; }
}

function checkTrack(value: unknown): Track | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const source = String(raw.source || '');
  const stream = typeof raw.stream === 'string' ? raw.stream : '';
  if (!SHAREABLE.includes(source) || !STREAM_OK[source](stream)) return null;
  if (typeof raw.id !== 'string' || !raw.id.startsWith((source === 'archive' ? 'ia' : source) + ':') || raw.id.length > 300) return null;
  const t = cleanTrack(Object.fromEntries(FIELDS.filter((k) => k in raw).map((k) => [k, raw[k]]))); // nothing else, e.g. no download address
  for (const k of ['title', 'artist', 'album'] as const) if (typeof t[k] === 'string') t[k] = (t[k] as string).slice(0, 300);
  if (t.cover && !coverOk(t.cover)) delete t.cover;
  if (t.link && !url(t.link)) delete t.link;
  if (typeof t.duration !== 'number' || !Number.isFinite(t.duration)) delete t.duration;
  if (t.kind && !['track', 'set'].includes(t.kind)) delete t.kind;
  if (typeof t.artistRef === 'string' && !/^audius:\w{1,40}$/.test(t.artistRef)) delete t.artistRef;
  return t;
}

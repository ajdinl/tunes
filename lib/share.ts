// Sharing a song by link. The song travels in the link itself (after the #, so it never reaches
// a server) and opens in the phone-only version, which works for anyone without the sender's
// computer. A link is data from a stranger: only known sources come through, with addresses
// shaped the way Tunes makes them for that source.
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
const toBase64Url = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function shareLink(t: Track, base = PUBLIC_APP): string | null {
  if (!canShare(t)) return null;
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (t[k] !== undefined && t[k] !== null && t[k] !== '') out[k] = t[k];
  return base + 'shared#' + toBase64Url(JSON.stringify(out));
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
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(fromBase64Url(hash.replace(/^#/, ''))); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
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

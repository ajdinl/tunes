// Song and cover addresses are stored the way the Tunes server serves them (/api/stream/…,
// /api/img?u=…), so favorites and playlists look the same in both versions. Without a server
// (the phone-only version) they are turned back into the sources' own addresses.
import { STANDALONE } from './env.ts';

const AUDIUS_STREAM = (id: string) => `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=Tunes`;

// A page on https may not play http streams; many stations answer on https too.
const secure = (u: string | null): string => (u || '').replace(/^http:\/\//i, 'https://');

export function media(u: string | null | undefined): string {
  if (!u) return '';
  if (!STANDALONE || !u.startsWith('/api/')) return u;
  const url = new URL(u, 'https://tunes.invalid');
  const q = url.searchParams;
  switch (url.pathname) {
    case '/api/img': return q.get('u') || '';
    case '/api/stream/url':
    case '/api/stream/radio': return secure(q.get('u'));
  }
  const audius = /^\/api\/stream\/audius\/(\w+)$/.exec(url.pathname);
  if (audius) return AUDIUS_STREAM(audius[1]);
  return ''; // files on the computer: not reachable without the server
}

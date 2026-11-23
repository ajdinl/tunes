// Lyrics: the song's own (.lrc next to the file, embedded tags) or LRCLIB, via the server.
import { api } from './store.ts';
import type { Track } from './store.ts';

export interface LrcLine { t: number; text: string }
export interface SongLyrics { synced: LrcLine[] | null; plain: string | null; instrumental: boolean }

const cache = new Map<string, SongLyrics | null>();

function parseLrc(text: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of text.split('\n')) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of times) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

// null: no lyrics. Throws when the server or LRCLIB doesn't answer.
export async function getLyrics(t: Track | null): Promise<SongLyrics | null> {
  if (!t || t.live) return null;
  if (cache.has(t.id)) return cache.get(t.id)!;
  const p = new URLSearchParams({ id: t.id, artist: t.artist || '', title: t.title, album: t.album || '', duration: String(t.duration || '') });
  const r = await api<{ found: boolean; synced?: string | null; plain?: string | null; instrumental?: boolean }>('/api/lyrics?' + p);
  const out = r.found ? { synced: r.synced ? parseLrc(r.synced) : null, plain: r.plain || null, instrumental: Boolean(r.instrumental) } : null;
  cache.set(t.id, out);
  return out;
}

// Formatting and small helpers shared by the screens.
import { tr, plural, locale } from './i18n.ts';
import type { Track } from '../../../lib/types.ts';

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '–:––';
  s = Math.floor(s);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(total: number): string {
  const m = Math.round(total / 60);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  return `${hh} h ${m % 60} min`;
}

export const songs = (n: number): string => plural(n, 'song', 'songs');

export function totalMeta(tracks: Track[]): string {
  const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return dur ? `${songs(tracks.length)}, ${fmtDuration(dur)}` : songs(tracks.length);
}

export function relDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  if (diff === 0) return tr('Today');
  if (diff === 1) return tr('Yesterday');
  if (diff < 7) return d.toLocaleDateString(locale(), { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// Set or mix: long recordings (20+ min) or titles like "DJ set", "mixtape", "Boiler Room".
const SET_WORDS = /\b(dj|live|full|mix|guest)[\s-]?set\b|\bset\s?#?\d|\bmixtape\b|\bmegamix\b|\bboiler room\b|\bessential mix\b|\bb2b\b|\bpodcast\b|\bepisode\b|\bradio show\b|\bcontinuous mix\b/i;
const TRACK_MIX = /\b(original|extended|radio|club|dub|vip|instrumental|edit|re|remix)[\s-]?mix\b/i;
export function isSet(x: Pick<Track, 'live' | 'duration' | 'title'> | null | undefined): boolean {
  if (!x || x.live) return false;
  const d = x.duration || 0;
  if (d >= 20 * 60) return true;
  if (SET_WORDS.test(x.title || '')) return d === 0 || d >= 6 * 60;
  return /\bmix\b/i.test(x.title || '') && !TRACK_MIX.test(x.title || '') && d >= 10 * 60;
}

export type Kind = 'all' | 'songs' | 'sets';
export const byKind = (kind: string) => (x: Track): boolean => (kind === 'songs' ? !isSet(x) : kind === 'sets' ? isSet(x) : true);

export const SOURCES: Record<string, { name: string; short: string }> = {
  local: { name: 'On this computer', short: 'Local' },
  audius: { name: 'Audius', short: 'Audius' },
  archive: { name: 'Internet Archive', short: 'Archive' },
  radio: { name: 'Radio', short: 'Radio' },
  jamendo: { name: 'Jamendo', short: 'Jamendo' },
  soundcloud: { name: 'SoundCloud', short: 'SoundCloud' },
};

export function norm(s: unknown): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'dj').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function shuffleArray<T>(a: T[]): T[] {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');

// A link from a music source's data, if it is a plain web address (never javascript: etc.).
export const safeHttp = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

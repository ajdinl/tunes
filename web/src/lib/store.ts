// App state in the browser: library, favorites, playlists, history.
// The server is the source of truth; this keeps a copy and announces changes via events.
import { useSyncExternalStore } from 'react';

import { norm, shuffleArray } from './format.ts';
import { tr } from './i18n.ts';
import { STANDALONE, asset } from './env.ts';
import type { Playlist, PublicSettings, PublicState, Track, HistoryEntry } from '../../../lib/types.ts';

export type { Track, Playlist };
export interface Context { label: string; href: string }

// Points the favicon, the home screen icon and the logo at the chosen app icon variant.
// ?v= forces browsers to drop the cached image after a change. The phone-only version has no
// server to pick the variant, so it points at the variant's own files.
export function applyIcon(name: string | undefined): void {
  if (!name) return;
  const v = '?v=' + encodeURIComponent(name);
  const svg = STANDALONE ? asset(`icons/${name}/icon.svg`) : '/icons/app.svg' + v;
  document.querySelector('link[rel=icon]')?.setAttribute('href', svg);
  document.querySelector('link[rel=apple-touch-icon]')?.setAttribute('href', STANDALONE ? asset(`icons/${name}/icon-512.png`) : '/icons/app-512.png' + v);
  // The phone-only version has a manifest per icon; the one linked when Tunes is added counts.
  if (STANDALONE) document.querySelector('link[rel=manifest]')?.setAttribute('href', asset(`manifest-${name}.webmanifest`));
  document.documentElement.style.setProperty('--app-icon', `url("${svg}")`);
}

// The phone-only version answers /api requests in the browser (web/src/standalone/backend.ts).
type Backend = (method: string, path: string, body?: unknown) => Promise<unknown>;
let localBackend: Backend | null = null;
export function setLocalBackend(b: Backend): void { localBackend = b; }

// JSON request to the server. Error messages from the server are English and get translated here.
export async function api<T = any>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  if (localBackend) {
    try { return await localBackend(method, path, body) as T; }
    catch (e) { throw new Error(tr((e as Error).message || 'Error')); }
  }
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? tr(data.error) : tr('Error {n}', { n: res.status }));
  return data as T;
}

export interface Artist { key: string; name: string; tracks: Track[]; albums: Set<string>; cover: string | null }
export interface Album { key: string; title: string; artist: string; artistKey: string; year?: number | string | null; tracks: Track[]; cover?: string | null; source?: string }
interface Index { artists: Artist[]; albums: Album[]; albumMap: Map<string, Album>; artistMap: Map<string, Artist> }

export type Settings = Partial<PublicSettings>;
export type StoreEvent = 'library' | 'favorites' | 'playlists' | 'history' | 'stations' | 'settings';

class Store extends EventTarget {
  library: Track[] = [];
  favorites: Record<string, { track: Track; at: number }> = {};
  playlists: Playlist[] = [];
  history: HistoryEntry[] = [];
  playCounts: Record<string, number> = {};
  lastPlayed: Record<string, number> = {};
  stations: Record<string, Track> = {};
  settings: Settings = {};
  folders: string[] = [];
  private _collection: Track[] | null = null;
  private _index: Index | null = null;

  emit(type: StoreEvent, detail?: unknown): void {
    versions[type] = (versions[type] || 0) + 1;
    this.dispatchEvent(new CustomEvent(type, { detail }));
    for (const l of listeners) l();
  }

  async load(): Promise<void> {
    const [state, lib] = await Promise.all([api<PublicState>('/api/state'), api('/api/library')]);
    this.applyState(state);
    this.applyLibrary(lib);
  }

  applyState(s: Partial<PublicState>): void {
    this.favorites = s.favorites || {};
    this.playlists = s.playlists || [];
    this.history = s.history || [];
    this.playCounts = s.playCounts || {};
    this.lastPlayed = s.lastPlayed || {};
    this.stations = s.radioStations || {};
    this.settings = s.settings || {};
    this._collection = null;
    this._index = null;
    applyIcon(this.settings.icon);
  }

  applyLibrary(lib: { tracks?: Track[]; folders?: string[] }): void {
    this.library = lib.tracks || [];
    this.folders = lib.folders || [];
    this._collection = null;
    this._index = null;
    this.emit('library');
  }

  async reloadLibrary(): Promise<void> {
    this.applyLibrary(await api('/api/library'));
  }

  // Collection = local files + favorite tracks from the internet.
  // Artists, albums and smart playlists are built from it.
  get collection(): Track[] {
    if (!this._collection) {
      const map = new Map(this.library.map((t) => [t.id, t]));
      for (const f of Object.values(this.favorites)) if (!map.has(f.track.id) && !f.track.live) map.set(f.track.id, f.track);
      this._collection = [...map.values()];
    }
    return this._collection;
  }

  get index(): Index {
    if (!this._index) {
      const artists = new Map<string, Artist>();
      const albums = new Map<string, Album>();
      for (const t of this.collection) {
        const an = t.albumArtist || t.artist || tr('Unknown artist');
        const ak = norm(an);
        if (!artists.has(ak)) artists.set(ak, { key: ak, name: an, tracks: [], albums: new Set(), cover: null });
        const a = artists.get(ak)!;
        a.tracks.push(t);
        // A track also shows up under artists who are not the album artist.
        if (t.artist && norm(t.artist) !== ak) {
          const k2 = norm(t.artist);
          if (!artists.has(k2)) artists.set(k2, { key: k2, name: t.artist, tracks: [], albums: new Set(), cover: null });
          artists.get(k2)!.tracks.push(t);
        }
        if (t.album) {
          const bk = ak + '|' + norm(t.album);
          if (!albums.has(bk)) albums.set(bk, { key: bk, title: t.album, artist: an, artistKey: ak, year: t.year, tracks: [], cover: t.cover, source: t.source });
          const b = albums.get(bk)!;
          b.tracks.push(t);
          if (!b.year && t.year) b.year = t.year;
          a.albums.add(bk);
          if (!a.cover && t.cover) a.cover = t.cover;
        } else if (!a.cover && t.cover) a.cover = t.cover;
      }
      for (const b of albums.values()) {
        b.tracks.sort((x, y) => (x.discNo || 1) - (y.discNo || 1) || (x.trackNo || 999) - (y.trackNo || 999) || x.title.localeCompare(y.title));
      }
      this._index = {
        artists: [...artists.values()].sort((x, y) => x.name.localeCompare(y.name, 'sr')),
        albums: [...albums.values()].sort((x, y) => x.artist.localeCompare(y.artist, 'sr') || Number(x.year || 0) - Number(y.year || 0)),
        albumMap: albums,
        artistMap: artists,
      };
    }
    return this._index;
  }

  isFav(id: string): boolean { return Boolean(this.favorites[id]); }

  async toggleFav(track: Track): Promise<boolean> {
    const { favorite } = await api<{ favorite: boolean }>('/api/favorites/toggle', { method: 'POST', body: { track } });
    this.favorites = { ...this.favorites };
    if (favorite) this.favorites[track.id] = { track, at: Date.now() };
    else delete this.favorites[track.id];
    this._collection = null; this._index = null;
    this.emit('favorites', { id: track.id, favorite });
    return favorite;
  }

  isStation(id: string): boolean { return Boolean(this.stations[id]); }

  async toggleStation(track: Track): Promise<boolean> {
    const { saved } = await api<{ saved: boolean }>('/api/stations/toggle', { method: 'POST', body: { track } });
    this.stations = { ...this.stations };
    if (saved) this.stations[track.id] = track; else delete this.stations[track.id];
    this.emit('stations');
    return saved;
  }

  // A song, set or station started playing: into the history.
  async logPlay(track: Track, at: number = Date.now()): Promise<void> {
    const r = await api<{ counted?: boolean; playCount: number }>('/api/history', { method: 'POST', body: { track, at } });
    if (r.counted === false) return; // already counted moments ago (reload, other device)
    this.history = [...this.history, { track, at }];
    this.playCounts = { ...this.playCounts, [track.id]: r.playCount };
    this.lastPlayed = { ...this.lastPlayed, [track.id]: at };
    this.emit('history');
  }

  // Half of it (or 4 minutes) was heard: ListenBrainz gets the listen, if it is connected.
  async scrobble(track: Track, at: number): Promise<void> {
    if (!this.settings.hasListenbrainz || track.live) return;
    await api('/api/scrobble', { method: 'POST', body: { track, at } });
  }

  async clearHistory(): Promise<void> {
    await api('/api/history', { method: 'DELETE', body: {} });
    this.history = [];
    this.playCounts = {};
    this.lastPlayed = {};
    this.emit('history');
  }

  async createPlaylist(name: string, tracks: Track[] = []): Promise<Playlist> {
    const p = await api<Playlist>('/api/playlists', { method: 'POST', body: { name, tracks } });
    this.playlists = [...this.playlists, p];
    this.emit('playlists');
    return p;
  }

  async updatePlaylist(id: string, patch: { name?: string; tracks?: Track[]; add?: Track[] }): Promise<Playlist> {
    const p = await api<Playlist>('/api/playlists/' + id, { method: 'PUT', body: patch });
    this.playlists = this.playlists.map((x) => (x.id === id ? p : x));
    this.emit('playlists');
    return p;
  }

  async deletePlaylist(id: string): Promise<void> {
    await api('/api/playlists/' + id, { method: 'DELETE', body: {} });
    this.playlists = this.playlists.filter((x) => x.id !== id);
    this.emit('playlists');
  }

  // Called when another device picks a different app icon.
  setIcon(name: string): void {
    if (!name || name === this.settings.icon) return;
    this.settings = { ...this.settings, icon: name };
    applyIcon(name);
    this.emit('settings');
  }

  setPhoneOn(on: boolean): void {
    if (this.settings.phoneOn === on) return;
    this.settings = { ...this.settings, phoneOn: on };
    this.emit('settings');
  }

  async saveSettings(patch: Record<string, unknown>): Promise<{ ok: boolean; listenbrainz?: { valid: boolean; user?: string | null; error?: string }; state: PublicState }> {
    const r = await api('/api/settings', { method: 'PUT', body: patch });
    this.applyState(r.state);
    this.emit('settings');
    this.emit('favorites');
    return r;
  }

  // ------------------------------------------------------------ local search
  searchLocal(q: string): { tracks: Track[]; artists: Artist[]; albums: Album[] } {
    const terms = norm(q).split(' ').filter(Boolean);
    if (!terms.length) return { tracks: [], artists: [], albums: [] };
    const match = (s: string) => terms.every((t) => s.includes(t));
    const tracks = this.collection.filter((t) => match(norm(`${t.title} ${t.artist} ${t.album || ''} ${t.genre || ''}`)));
    const artists = this.index.artists.filter((a) => match(norm(a.name)));
    const albums = this.index.albums.filter((b) => match(norm(`${b.title} ${b.artist}`)));
    return { tracks, artists, albums };
  }

  // ------------------------------------------------------------ smart playlists
  smart(key: string): Track[] {
    const now = Date.now();
    const day = 864e5;
    const historyTracks = new Map<string, Track>();
    for (const h of this.history) historyTracks.set(h.track.id, h.track);
    const known = new Map<string, Track>([...historyTracks, ...this.collection.map((t) => [t.id, t] as [string, Track])]);
    const favs = Object.values(this.favorites).map((f) => known.get(f.track.id) || f.track).filter((t) => !t.live);
    switch (key) {
      case 'mix': {
        // Random, but favorites and frequently played tracks are more likely.
        const pool = this.collection.map((t) => ({
          t, w: Math.random() ** (1 / (1 + (this.isFav(t.id) ? 3 : 0) + Math.min(this.playCounts[t.id] || 0, 10) * 0.3)),
        }));
        return pool.sort((a, b) => b.w - a.w).slice(0, 60).map((x) => x.t);
      }
      case 'most-played':
        return [...known.values()].filter((t) => (this.playCounts[t.id] || 0) > 0 && !t.live)
          .sort((a, b) => (this.playCounts[b.id] || 0) - (this.playCounts[a.id] || 0)).slice(0, 50);
      case 'forgotten':
        return shuffleArray(favs.filter((t) => !this.lastPlayed[t.id] || now - this.lastPlayed[t.id] > 30 * day)).slice(0, 50);
      case 'recent':
        return this.library.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 50);
      case 'unplayed':
        return shuffleArray(this.library.filter((t) => !this.playCounts[t.id])).slice(0, 100);
      case 'online':
        return favs.filter((t) => t.source !== 'local');
      default:
        return [];
    }
  }
}

export const SMART = [
  { key: 'mix', name: 'My mix', desc: 'Random picks from your collection, favorites more often' },
  { key: 'most-played', name: 'Most played', desc: 'Songs you play the most' },
  { key: 'forgotten', name: 'Forgotten favorites', desc: 'Favorites not played in over a month' },
  { key: 'recent', name: 'Recently added', desc: 'Latest songs added to this computer' },
  { key: 'unplayed', name: 'Never played', desc: 'Songs on this computer you haven\'t played yet' },
  { key: 'online', name: 'Discovered online', desc: 'Favorites from Audius, Archive and Jamendo' },
];

const versions: Partial<Record<StoreEvent, number>> = {};
const listeners = new Set<() => void>();

export const store = new Store();

// Re-renders the component when any of the given kinds of data change.
export function useStore(...types: StoreEvent[]): Store {
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => types.map((t) => versions[t] || 0).join(','),
  );
  return store;
}

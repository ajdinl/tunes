// Persistent user data (favorites, playlists, history, settings) in a single
// JSON file. Writes are atomic (tmp + rename) and debounced so the disk is not
// written on every click.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import type { Data, Playlist, Prefs, PublicState, Track } from './types.ts';

const HISTORY_LIMIT = 5000;

const defaults = (): Data => ({
  version: 1,
  settings: {
    folders: [path.join(os.homedir(), 'Music', 'Tunes')],
    listenbrainzToken: '',
    jamendoClientId: '',
    eq: { enabled: false, preset: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    volume: 0.8,
    phone: { enabled: false, token: '' },
    icon: 'dial',
    prefs: {},
  },
  favorites: {},      // id -> { track, at }
  playlists: [],      // { id, name, created, updated, tracks: [track] }
  history: [],        // { track, at }  (newest last)
  playCounts: {},     // id -> count
  lastPlayed: {},     // id -> timestamp
  radioStations: {},  // id -> track (saved stations)
});

// Shows folders inside the home folder as ~/…, so the user name isn't on screen (or in
// screenshots). updateSettings() expands ~ again when folders are saved.
export function tildify(f: string): string {
  const home = os.homedir();
  return f === home ? '~' : f.startsWith(home + path.sep) ? '~' + f.slice(home.length) : f;
}

// App icon variants (folders in public/icons). The choice is stored here, so every device shows the same icon.
export const ICONS = ['dial', 'night', 'vinyl', 'bars'];

// Allowed values of the synced appearance choices (Settings → Language and Appearance).
export const PREF_VALUES: Record<keyof Prefs, readonly string[]> = {
  theme: ['black', 'indigo', 'light'],
  lang: ['en', 'bs', 'sr', 'hr', 'de', 'tr', 'es', 'fr', 'pt', 'sl', 'mk', 'sq'],
  dialStyle: ['dial', 'calm', 'minimal', 'color', 'mirror'],
  dialStylePhone: ['minimal', 'calm'], // phones have no spectrum
  deckCtrls: ['above', 'beside', 'hover'],
};

export interface SettingsPatch {
  folders?: unknown;
  listenbrainzToken?: unknown;
  jamendoClientId?: unknown;
  eq?: { enabled?: unknown; preset?: unknown; gains?: unknown[] } | null;
  volume?: unknown;
  icon?: unknown;
  prefs?: Record<string, unknown> | null;
}

export interface PlaylistPatch {
  name?: unknown;
  tracks?: unknown;
  add?: unknown;
}

export class Store {
  file: string;
  timer: NodeJS.Timeout | undefined;
  data: Data;

  constructor(file: string) {
    this.file = file;
    this.timer = undefined;
    this.data = defaults();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Data>;
      const d = defaults();
      this.data = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Cannot read', file, '-', (e as Error).message);
    }
  }

  save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // State for the client: no secret tokens, only whether they exist.
  publicState(): PublicState {
    const { settings, ...rest } = this.data;
    return {
      ...rest,
      history: this.data.history.slice(-1000),
      settings: {
        ...settings,
        folders: settings.folders.map(tildify),
        listenbrainzToken: settings.listenbrainzToken ? '••••' : '',
        hasListenbrainz: Boolean(settings.listenbrainzToken),
        hasJamendo: Boolean(settings.jamendoClientId),
        jamendoClientId: settings.jamendoClientId ? '••••' : '',
        phone: undefined,
        phoneOn: Boolean(settings.phone?.enabled),
      },
    };
  }

  toggleFavorite(track: Partial<Track>): boolean {
    const fav = this.data.favorites;
    const id = String(track.id);
    if (fav[id]) delete fav[id];
    else fav[id] = { track: cleanTrack(track), at: Date.now() };
    this.save();
    return Boolean(fav[id]);
  }

  // Returns false when the play is not counted: the same song was already counted less than
  // its own length ago (a page reload or continuing on another device, not a second listen).
  addHistory(track: Partial<Track>, at: number = Date.now()): boolean {
    const t = cleanTrack(track);
    const last = this.data.lastPlayed[t.id];
    const gap = (t.live ? 30 * 60 : Math.max(Number(t.duration) || 0, 60)) * 1000;
    if (last && at - last >= 0 && at - last < gap) return false;
    this.data.history.push({ track: t, at });
    if (this.data.history.length > HISTORY_LIMIT) {
      this.data.history.splice(0, this.data.history.length - HISTORY_LIMIT);
    }
    this.data.playCounts[t.id] = (this.data.playCounts[t.id] || 0) + 1;
    this.data.lastPlayed[t.id] = at;
    this.save();
    return true;
  }

  clearHistory(): void {
    this.data.history = [];
    this.data.playCounts = {};
    this.data.lastPlayed = {};
    this.save();
  }

  createPlaylist(name: unknown, tracks: Partial<Track>[] = []): Playlist {
    const p: Playlist = {
      id: crypto.randomUUID(),
      name: String(name || 'New playlist').slice(0, 120),
      created: Date.now(),
      updated: Date.now(),
      tracks: tracks.map(cleanTrack),
    };
    this.data.playlists.push(p);
    this.save();
    return p;
  }

  updatePlaylist(id: string, patch: PlaylistPatch): Playlist | null {
    const p = this.data.playlists.find((x) => x.id === id);
    if (!p) return null;
    if (typeof patch.name === 'string') p.name = patch.name.slice(0, 120);
    if (Array.isArray(patch.tracks)) p.tracks = patch.tracks.map(cleanTrack);
    if (Array.isArray(patch.add)) p.tracks.push(...patch.add.map(cleanTrack));
    p.updated = Date.now();
    this.save();
    return p;
  }

  deletePlaylist(id: string): boolean {
    const before = this.data.playlists.length;
    this.data.playlists = this.data.playlists.filter((x) => x.id !== id);
    this.save();
    return this.data.playlists.length !== before;
  }

  toggleStation(track: Partial<Track>): boolean {
    const s = this.data.radioStations;
    const id = String(track.id);
    if (s[id]) delete s[id];
    else s[id] = cleanTrack(track);
    this.save();
    return Boolean(s[id]);
  }

  updateSettings(patch: SettingsPatch): void {
    const s = this.data.settings;
    if (Array.isArray(patch.folders)) {
      s.folders = patch.folders.map((f) => String(f).trim()).filter(Boolean)
        .map((f) => (f.startsWith('~') ? path.join(os.homedir(), f.slice(1)) : f));
    }
    // An empty string clears the token; the masked value means "leave unchanged".
    for (const key of ['listenbrainzToken', 'jamendoClientId'] as const) {
      const v = patch[key];
      if (typeof v === 'string' && v !== '••••') s[key] = v.trim();
    }
    if (patch.eq && typeof patch.eq === 'object') {
      s.eq = {
        enabled: Boolean(patch.eq.enabled),
        preset: String(patch.eq.preset || 'Custom'),
        gains: (patch.eq.gains || []).slice(0, 10).map((g) => Math.max(-12, Math.min(12, Number(g) || 0))),
      };
    }
    if (typeof patch.volume === 'number') s.volume = Math.max(0, Math.min(1, patch.volume));
    if (typeof patch.icon === 'string' && ICONS.includes(patch.icon)) s.icon = patch.icon;
    // Merged key by key; null clears them all (the tests start each case from none).
    if (patch.prefs === null) s.prefs = {};
    else if (patch.prefs && typeof patch.prefs === 'object') {
      const next: Prefs = { ...(s.prefs || {}) };
      for (const key of Object.keys(PREF_VALUES) as (keyof Prefs)[]) {
        const v = patch.prefs[key];
        if (typeof v === 'string' && PREF_VALUES[key].includes(v)) next[key] = v;
      }
      s.prefs = next;
    }
    this.save();
  }
}

// Keep only the fields needed for display and playback.
const TRACK_FIELDS = ['id', 'source', 'title', 'artist', 'album', 'albumArtist', 'duration', 'cover',
  'stream', 'year', 'genre', 'trackNo', 'discNo', 'link', 'live', 'download', 'ext', 'addedAt', 'artistRef', 'kind'] as const;

export function cleanTrack(t: unknown = {}): Track {
  const src = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of TRACK_FIELDS) if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
  out.id = String(out.id || '');
  out.title = String(out.title || 'Untitled');
  return out as unknown as Track;
}

// User data (favorites, playlists, history, saved stations, settings) and the rules for
// changing it, with no Node or browser specifics: the server keeps it in a JSON file
// (lib/store.ts), the phone-only version in the browser's IndexedDB (web/src/standalone).

import type { Data, Playlist, Prefs, PublicState, Track } from './types.ts';

const HISTORY_LIMIT = 5000;

// App icon variants (folders in public/icons). The choice is stored here, so every device shows the same icon.
export const ICONS = ['dial', 'night', 'vinyl', 'bars'];
export const DEFAULT_ICON = 'bars'; // Spectrum

export const defaults = (folders: string[] = []): Data => ({
  version: 1,
  settings: {
    folders,
    listenbrainzToken: '',
    jamendoClientId: '',
    eq: { enabled: false, preset: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    volume: 0.8,
    phone: { enabled: false, token: '' },
    icon: DEFAULT_ICON,
    prefs: {},
  },
  favorites: {},      // id -> { track, at }
  playlists: [],      // { id, name, created, updated, tracks: [track] }
  history: [],        // { track, at }  (newest last)
  playCounts: {},     // id -> count
  lastPlayed: {},     // id -> timestamp
  radioStations: {},  // id -> track (saved stations)
});

// Allowed values of the synced appearance choices (Settings → Language and Appearance).
const PREF_VALUES: Record<keyof Prefs, readonly string[]> = {
  theme: ['black', 'indigo', 'light'],
  lang: ['en', 'bs', 'sr', 'hr', 'de', 'tr', 'es', 'fr', 'pt', 'sl', 'mk', 'sq'],
  dialStyle: ['dial', 'minimal', 'color', 'mirror'],
  dialStylePhone: ['minimal'], // phones have no spectrum
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

export class DataStore {
  data: Data;

  // `raw` is saved data, possibly from an older version: missing fields get their defaults.
  constructor(raw: Partial<Data> | null = null, base: Data = defaults()) {
    this.data = raw ? { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } } : base;
  }

  // Called after every change; the subclass decides how to keep the data.
  save(): void { /* in memory only */ }

  // How a saved folder is shown, and how a typed one is stored (the server uses ~ for home).
  protected showFolder(f: string): string { return f; }
  protected storeFolder(f: string): string { return f; }

  // State for the client: no secret tokens, only whether they exist.
  publicState(): PublicState {
    const { settings, ...rest } = this.data;
    return {
      ...rest,
      history: this.data.history.slice(-1000),
      settings: {
        ...settings,
        folders: settings.folders.map((f) => this.showFolder(f)),
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

  // Every song, set and station that started playing goes into the history. Returns false
  // when the play is not counted: the same song was already counted less than its own length
  // ago (a page reload or continuing on another device, not a second listen).
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

  // ListenBrainz gets a listen once the song was really heard (half of it or 4 minutes, their
  // rule). Returns false when the same song was sent less than its own length ago (a reload
  // or continuing on another device, not a second listen). Kept in memory only.
  private scrobbled = new Map<string, number>();
  claimScrobble(track: Partial<Track>, at: number = Date.now()): boolean {
    const id = String(track.id);
    const last = this.scrobbled.get(id);
    const gap = Math.max(Number(track.duration) || 0, 60) * 1000;
    if (last !== undefined && Math.abs(at - last) < gap) return false;
    this.scrobbled.set(id, at);
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
      id: globalThis.crypto.randomUUID(),
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
      s.folders = patch.folders.map((f) => String(f).trim()).filter(Boolean).map((f) => this.storeFolder(f));
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

// Persistent user data (favorites, playlists, history, settings) in a single
// JSON file. Writes are atomic (tmp + rename) and debounced so the disk is not
// written on every click.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const HISTORY_LIMIT = 5000;

const defaults = () => ({
  version: 1,
  settings: {
    folders: [path.join(os.homedir(), 'Music', 'Tunes')],
    listenbrainzToken: '',
    jamendoClientId: '',
    eq: { enabled: false, preset: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    volume: 0.8,
    phone: { enabled: false, token: '' },
    icon: 'dial',
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
export function tildify(f) {
  const home = os.homedir();
  return f === home ? '~' : f.startsWith(home + path.sep) ? '~' + f.slice(home.length) : f;
}

// App icon variants (folders in public/icons). The choice is stored here, so every device shows the same icon.
export const ICONS = ['dial', 'night', 'vinyl', 'bars'];

export class Store {
  constructor(file) {
    this.file = file;
    this.timer = null;
    this.data = defaults();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const d = defaults();
      this.data = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('Cannot read', file, '-', e.message);
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // State for the client: no secret tokens, only whether they exist.
  publicState() {
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

  toggleFavorite(track) {
    const fav = this.data.favorites;
    if (fav[track.id]) delete fav[track.id];
    else fav[track.id] = { track: cleanTrack(track), at: Date.now() };
    this.save();
    return Boolean(fav[track.id]);
  }

  // Returns false when the play is not counted: the same song was already counted less than
  // its own length ago (a page reload or continuing on another device, not a second listen).
  addHistory(track, at = Date.now()) {
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

  clearHistory() {
    this.data.history = [];
    this.data.playCounts = {};
    this.data.lastPlayed = {};
    this.save();
  }

  createPlaylist(name, tracks = []) {
    const p = {
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

  updatePlaylist(id, patch) {
    const p = this.data.playlists.find((x) => x.id === id);
    if (!p) return null;
    if (typeof patch.name === 'string') p.name = patch.name.slice(0, 120);
    if (Array.isArray(patch.tracks)) p.tracks = patch.tracks.map(cleanTrack);
    if (Array.isArray(patch.add)) p.tracks.push(...patch.add.map(cleanTrack));
    p.updated = Date.now();
    this.save();
    return p;
  }

  deletePlaylist(id) {
    const before = this.data.playlists.length;
    this.data.playlists = this.data.playlists.filter((x) => x.id !== id);
    this.save();
    return this.data.playlists.length !== before;
  }

  toggleStation(track) {
    const s = this.data.radioStations;
    if (s[track.id]) delete s[track.id];
    else s[track.id] = cleanTrack(track);
    this.save();
    return Boolean(s[track.id]);
  }

  updateSettings(patch) {
    const s = this.data.settings;
    if (Array.isArray(patch.folders)) {
      s.folders = patch.folders.map((f) => String(f).trim()).filter(Boolean)
        .map((f) => (f.startsWith('~') ? path.join(os.homedir(), f.slice(1)) : f));
    }
    // An empty string clears the token; the masked value means "leave unchanged".
    for (const key of ['listenbrainzToken', 'jamendoClientId']) {
      if (typeof patch[key] === 'string' && patch[key] !== '••••') s[key] = patch[key].trim();
    }
    if (patch.eq && typeof patch.eq === 'object') {
      s.eq = {
        enabled: Boolean(patch.eq.enabled),
        preset: String(patch.eq.preset || 'Custom'),
        gains: (patch.eq.gains || []).slice(0, 10).map((g) => Math.max(-12, Math.min(12, Number(g) || 0))),
      };
    }
    if (typeof patch.volume === 'number') s.volume = Math.max(0, Math.min(1, patch.volume));
    if (ICONS.includes(patch.icon)) s.icon = patch.icon;
    this.save();
  }
}

// Keep only the fields needed for display and playback.
const TRACK_FIELDS = ['id', 'source', 'title', 'artist', 'album', 'albumArtist', 'duration', 'cover',
  'stream', 'year', 'genre', 'trackNo', 'discNo', 'link', 'live', 'download', 'ext', 'addedAt', 'artistRef', 'kind'];

export function cleanTrack(t = {}) {
  const out = {};
  for (const k of TRACK_FIELDS) if (t[k] !== undefined && t[k] !== null && t[k] !== '') out[k] = t[k];
  out.id = String(out.id || '');
  out.title = String(out.title || 'Untitled');
  return out;
}

// App state in the browser: library, favorites, playlists, history.
// The server is the source of truth; this keeps a copy and announces changes via events.
import { norm, shuffleArray, tr } from './ui.js';

// Points the favicon, the home screen icon and the logo at the chosen app icon variant.
// ?v= forces browsers to drop the cached image after a change.
export function applyIcon(name) {
  if (!name) return;
  const v = '?v=' + encodeURIComponent(name);
  document.querySelector('link[rel=icon]')?.setAttribute('href', '/icons/app.svg' + v);
  document.querySelector('link[rel=apple-touch-icon]')?.setAttribute('href', '/icons/app-512.png' + v);
  document.documentElement.style.setProperty('--app-icon', `url("/icons/app.svg${v}")`);
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? tr(data.error) : tr('Error {n}', { n: res.status }));
  return data;
}

class Store extends EventTarget {
  constructor() {
    super();
    this.library = [];
    this.favorites = {};
    this.playlists = [];
    this.history = [];
    this.playCounts = {};
    this.lastPlayed = {};
    this.stations = {};
    this.settings = {};
    this.folders = [];
    this._collection = null;
    this._index = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load() {
    const [state, lib] = await Promise.all([api('/api/state'), api('/api/library')]);
    this.applyState(state);
    this.applyLibrary(lib);
  }

  applyState(s) {
    this.favorites = s.favorites || {};
    this.playlists = s.playlists || [];
    this.history = s.history || [];
    this.playCounts = s.playCounts || {};
    this.lastPlayed = s.lastPlayed || {};
    this.stations = s.radioStations || {};
    this.settings = s.settings || {};
    this._collection = null;
    applyIcon(this.settings.icon);
  }

  applyLibrary(lib) {
    this.library = lib.tracks || [];
    this.folders = lib.folders || [];
    this._collection = null;
    this._index = null;
    this.emit('library');
  }

  async reloadLibrary() {
    this.applyLibrary(await api('/api/library'));
  }

  // Collection = local files + favorite tracks from the internet.
  // Artists, albums and smart playlists are built from it.
  get collection() {
    if (!this._collection) {
      const map = new Map(this.library.map((t) => [t.id, t]));
      for (const f of Object.values(this.favorites)) if (!map.has(f.track.id) && !f.track.live) map.set(f.track.id, f.track);
      this._collection = [...map.values()];
    }
    return this._collection;
  }

  get index() {
    if (!this._index) {
      const artists = new Map();
      const albums = new Map();
      for (const t of this.collection) {
        const an = t.albumArtist || t.artist || tr('Unknown artist');
        const ak = norm(an);
        if (!artists.has(ak)) artists.set(ak, { key: ak, name: an, tracks: [], albums: new Set(), cover: null });
        const a = artists.get(ak);
        a.tracks.push(t);
        // A track also shows up under artists who are not the album artist.
        if (t.artist && norm(t.artist) !== ak) {
          const k2 = norm(t.artist);
          if (!artists.has(k2)) artists.set(k2, { key: k2, name: t.artist, tracks: [], albums: new Set(), cover: null });
          artists.get(k2).tracks.push(t);
        }
        if (t.album) {
          const bk = ak + '|' + norm(t.album);
          if (!albums.has(bk)) albums.set(bk, { key: bk, title: t.album, artist: an, artistKey: ak, year: t.year, tracks: [], cover: t.cover, source: t.source });
          const b = albums.get(bk);
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
        albums: [...albums.values()].sort((x, y) => x.artist.localeCompare(y.artist, 'sr') || (x.year || 0) - (y.year || 0)),
        albumMap: albums,
        artistMap: artists,
      };
    }
    return this._index;
  }

  isFav(id) { return Boolean(this.favorites[id]); }

  async toggleFav(track) {
    const { favorite } = await api('/api/favorites/toggle', { method: 'POST', body: { track } });
    if (favorite) this.favorites[track.id] = { track, at: Date.now() };
    else delete this.favorites[track.id];
    this._collection = null; this._index = null;
    this.emit('favorites', { id: track.id, favorite });
    return favorite;
  }

  isStation(id) { return Boolean(this.stations[id]); }

  async toggleStation(track) {
    const { saved } = await api('/api/stations/toggle', { method: 'POST', body: { track } });
    if (saved) this.stations[track.id] = track; else delete this.stations[track.id];
    this.emit('stations');
    return saved;
  }

  async logPlay(track) {
    const at = Date.now();
    const r = await api('/api/history', { method: 'POST', body: { track, at } });
    this.history.push({ track, at });
    this.playCounts[track.id] = r.playCount;
    this.lastPlayed[track.id] = at;
    this.emit('history');
  }

  async clearHistory() {
    await api('/api/history', { method: 'DELETE' });
    this.history = [];
    this.playCounts = {};
    this.lastPlayed = {};
    this.emit('history');
  }

  async createPlaylist(name, tracks = []) {
    const p = await api('/api/playlists', { method: 'POST', body: { name, tracks } });
    this.playlists.push(p);
    this.emit('playlists');
    return p;
  }

  async updatePlaylist(id, patch) {
    const p = await api('/api/playlists/' + id, { method: 'PUT', body: patch });
    const i = this.playlists.findIndex((x) => x.id === id);
    if (i >= 0) this.playlists[i] = p;
    this.emit('playlists');
    return p;
  }

  async deletePlaylist(id) {
    await api('/api/playlists/' + id, { method: 'DELETE' });
    this.playlists = this.playlists.filter((x) => x.id !== id);
    this.emit('playlists');
  }

  // Called when another device picks a different app icon.
  setIcon(name) {
    if (!name || name === this.settings.icon) return;
    this.settings = { ...this.settings, icon: name };
    applyIcon(name);
    this.emit('settings');
  }

  async saveSettings(patch) {
    const r = await api('/api/settings', { method: 'PUT', body: patch });
    this.applyState(r.state);
    this.emit('settings');
    return r;
  }

  // ------------------------------------------------------------ local search
  searchLocal(q) {
    const terms = norm(q).split(' ').filter(Boolean);
    if (!terms.length) return { tracks: [], artists: [], albums: [] };
    const match = (s) => terms.every((t) => s.includes(t));
    const tracks = this.collection.filter((t) => match(norm(`${t.title} ${t.artist} ${t.album || ''} ${t.genre || ''}`)));
    const artists = this.index.artists.filter((a) => match(norm(a.name)));
    const albums = this.index.albums.filter((b) => match(norm(`${b.title} ${b.artist}`)));
    return { tracks, artists, albums };
  }

  // ------------------------------------------------------------ smart playlists
  smart(key) {
    const now = Date.now();
    const day = 864e5;
    const historyTracks = new Map();
    for (const h of this.history) historyTracks.set(h.track.id, h.track);
    const known = new Map([...historyTracks, ...this.collection.map((t) => [t.id, t])]);
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

export const store = new Store();

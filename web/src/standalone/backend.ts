// The phone-only version's stand-in for the Tunes server: the same /api routes with the same
// JSON, answered inside the browser. User data follows the rules in lib/data.ts and is kept in
// IndexedDB; the music sources (lib/sources.ts) are asked directly, since all of them allow
// requests from other sites. Things that need a computer (its music folder, phone access,
// several devices at once) answer as "not here".
import { DataStore } from '../../../lib/data.ts';
import type { PlaylistPatch, SettingsPatch } from '../../../lib/data.ts';
import { httpError } from '../../../lib/types.ts';
import type { Data, Track } from '../../../lib/types.ts';
import { archive, audius, jamendo, listenbrainz, lyrics, radio, soundcloud } from '../../../lib/sources.ts';
import { idbGet, idbSet } from './idb.ts';

const DATA_KEY = 'data';

// Every change is written right away (several in one go count as one write): a phone may
// close the app a moment after a tap. IndexedDB writes are asynchronous and a closing page
// can cut one short, so then a copy goes to localStorage (synchronous) and is picked up on
// the next start.
const RESCUE_KEY = 'tunes.unsaved';

class BrowserStore extends DataStore {
  private queued = false;
  private writes = 0;
  private unsaved = false;

  override save(): void {
    this.unsaved = true;
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const n = ++this.writes;
      idbSet(DATA_KEY, this.data).then(() => { if (n === this.writes) this.unsaved = false; }).catch(() => { /* rescued on leave */ });
    });
  }

  rescue(): void {
    if (!this.unsaved) return;
    try { localStorage.setItem(RESCUE_KEY, JSON.stringify(this.data)); } catch { /* storage full */ }
  }
}

let store: BrowserStore;

export async function openStore(): Promise<void> {
  let saved = await idbGet<Partial<Data>>(DATA_KEY).catch(() => null);
  let rescued: Partial<Data> | null = null;
  try { rescued = JSON.parse(localStorage.getItem(RESCUE_KEY) || 'null'); } catch { /* broken copy */ }
  if (rescued) saved = rescued;
  store = new BrowserStore(saved || null);
  if (rescued) await idbSet(DATA_KEY, store.data).then(() => localStorage.removeItem(RESCUE_KEY)).catch(() => { /* next time */ });
  const leave = () => store.rescue();
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
}

type Body = Record<string, any>;
type Handler = (m: RegExpExecArray, q: URLSearchParams, body: Body) => unknown | Promise<unknown>;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, pattern: RegExp, handler: Handler) => { routes.push({ method, pattern, handler }); };

const s = () => store.data.settings;
const needTrack = (b: Body, error: string): Partial<Track> => {
  if (!b.track?.id) throw httpError(error, 400);
  return b.track;
};

route('GET', /^\/api\/state$/, () => store.publicState());
route('GET', /^\/api\/library$/, () => ({ tracks: [], folders: [], scanning: false, lastScan: null }));
route('POST', /^\/api\/library\/rescan$/, () => ({ tracks: 0 }));

route('PUT', /^\/api\/settings$/, async (m, q, patch) => {
  store.updateSettings(patch as SettingsPatch);
  const out: { ok: true; listenbrainz?: { valid: boolean; user?: string | null; error?: string } } = { ok: true };
  if (typeof patch.listenbrainzToken === 'string' && patch.listenbrainzToken && patch.listenbrainzToken !== '••••') {
    try {
      const v = await listenbrainz.validate(s().listenbrainzToken);
      out.listenbrainz = v;
      if (!v.valid) { s().listenbrainzToken = ''; store.save(); }
    } catch (e) { out.listenbrainz = { valid: false, error: (e as Error).message }; }
  }
  return { ...out, state: store.publicState() };
});

route('GET', /^\/api\/search$/, async (m, q) => {
  const term = (q.get('q') || '').trim();
  if (!term) return {};
  const wanted = (q.get('src') || 'audius,archive,radio,jamendo').split(',');
  const many = q.get('type') === 'sets';
  const jobs: Record<string, () => Promise<unknown[]>> = {
    audius: () => audius.search(term, many ? 100 : 40),
    artists: () => audius.users(term),
    archive: () => archive.search(term),
    radio: () => radio.search({ q: term, limit: 30 }),
    jamendo: () => jamendo.search(term, s().jamendoClientId, many ? 100 : 30),
  };
  const keys = wanted.filter((k) => jobs[k] && (k !== 'jamendo' || s().jamendoClientId));
  const results = await Promise.allSettled(keys.map((k) => jobs[k]()));
  const out: Record<string, { items: unknown[] } | { error: string }> = {};
  keys.forEach((k, i) => {
    const r = results[i];
    out[k] = r.status === 'fulfilled' ? { items: r.value } : { error: (r.reason as Error)?.message || 'Error' };
  });
  return out;
});

route('GET', /^\/api\/audius\/trending$/, (m, q) => audius.trending(q.get('genre') || '', q.get('time') || 'week'));
route('GET', /^\/api\/audius\/user\/(\w+)$/, ([, id], q) => audius.user(id, q.get('sort') || 'plays'));
route('GET', /^\/api\/archive\/search$/, (m, q) => archive.search(q.get('q') || 'grateful dead'));
route('GET', /^\/api\/archive\/item\/([\w.-]+)$/, ([, id]) => archive.item(id));
route('GET', /^\/api\/radio\/search$/, (m, q) => radio.search({ q: q.get('q') || '', tag: q.get('tag') || '', countrycode: q.get('country') || '' }));
route('GET', /^\/api\/radio\/top$/, () => radio.top());
route('GET', /^\/api\/radio\/nowplaying$/, () => ({ title: null })); // needs the server's stream proxy
route('GET', /^\/api\/jamendo\/popular$/, (m, q) => jamendo.popular(s().jamendoClientId, q.get('tag') || ''));
route('GET', /^\/api\/soundcloud\/resolve$/, async (m, q) => ({ track: await soundcloud.resolve(soundcloud.find(q.get('u')) || q.get('u') || '') }));
route('GET', /^\/api\/lyrics$/, (m, q) => lyrics({
  artist: q.get('artist'), title: q.get('title'), album: q.get('album'), duration: Number(q.get('duration')) || 0,
}));

route('POST', /^\/api\/favorites\/toggle$/, (m, q, b) => ({ favorite: store.toggleFavorite(needTrack(b, 'Song is missing')) }));
route('POST', /^\/api\/stations\/toggle$/, (m, q, b) => ({ saved: store.toggleStation(needTrack(b, 'Station is missing')) }));
route('POST', /^\/api\/history$/, (m, q, b) => {
  const track = needTrack(b, 'Song is missing');
  const when = Number(b.at) || Date.now();
  const counted = store.addHistory(track, when);
  if (counted && !track.live) listenbrainz.submit(s().listenbrainzToken, 'single', track, when).catch((e: Error) => console.warn(e.message));
  return { ok: true, counted, playCount: store.data.playCounts[String(track.id)] };
});
route('DELETE', /^\/api\/history$/, () => { store.clearHistory(); return { ok: true }; });
route('POST', /^\/api\/nowplaying$/, (m, q, b) => {
  if (b.track && !b.track.live) listenbrainz.submit(s().listenbrainzToken, 'playing_now', b.track).catch((e: Error) => console.warn(e.message));
  return { ok: true };
});

route('POST', /^\/api\/playlists$/, (m, q, b) => store.createPlaylist(b.name, Array.isArray(b.tracks) ? b.tracks : []));
route('PUT', /^\/api\/playlists\/([\w-]+)$/, ([, id], q, b) => {
  const p = store.updatePlaylist(id, b as PlaylistPatch);
  if (!p) throw httpError("Playlist doesn't exist", 404);
  return p;
});
route('DELETE', /^\/api\/playlists\/([\w-]+)$/, ([, id]) => ({ ok: store.deletePlaylist(id) }));

// One device, no computer: nothing to share or hand over.
route('GET', /^\/api\/session$/, () => ({ session: null }));
route('POST', /^\/api\/session(\/takeover)?$/, () => ({ ok: true }));
route('GET', /^\/api\/phone$/, () => ({ enabled: false }));
route('GET', /^\/api\/phone\/links$/, () => ({ tailscale: null }));

// Same signature as a fetch to the server: resolves with the JSON, rejects with the server's
// (English) error message.
export async function handle(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = new URL(path, location.origin);
  for (const r of routes) {
    const m = r.method === method ? r.pattern.exec(url.pathname) : null;
    if (m) return r.handler(m, url.searchParams, (body && typeof body === 'object' ? body : {}) as Body);
  }
  throw httpError('Unknown route', 404);
}

// The whole collection as a file (Settings → Backup), like the server's /api/export.
export function exportData(): string {
  const { settings, ...rest } = store.data;
  return JSON.stringify(rest, null, 2);
}

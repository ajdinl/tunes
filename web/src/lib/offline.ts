// Offline buffer: downloads the current song and the next few in the queue to
// the device, so playback survives a dropped connection (leaving Wi-Fi, a tunnel).
// Phones open Tunes over plain http, which is not a secure context: no Service
// Worker, no Cache API. Audio Blobs therefore live in IndexedDB and are played
// through object URLs.
import { media } from './media.ts';
import { locale } from './i18n.ts';
import type { Track } from '../../../lib/types.ts';

const KEY = 'tunes.offline';
const DB_NAME = 'tunes-offline';
const DEFAULTS = { enabled: true, ahead: 3, limitMB: 500 };
const RETRY_MS = 60000;   // wait before retrying a failed download
const TOUCH_MS = 60000;   // write "last used" at most once a minute per song
const EXPIRE_MS = 72 * 3600000; // songs not played for 3 days are deleted, so the buffer never clogs the device
const SWEEP_MS = 3600000;       // check for expired songs every hour
const FIRST_SWEEP_MS = 15000;   // first check after start, once the player has restored its queue
export const HOME = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
const AUDIO_TYPE = /^(audio|video)\/|^application\/(ogg|octet-stream)$/;

export interface OfflineSettings { enabled: boolean; ahead: number; limitMB: number }
export interface Meta { id: string; size: number; type: string; title: string; artist: string; source: string; added: number; used: number }

function clean(s: Partial<OfflineSettings> | null): OfflineSettings {
  const n = (v: unknown, min: number, max: number, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
  return {
    enabled: typeof s?.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    ahead: n(s?.ahead, 1, 10, DEFAULTS.ahead),
    limitMB: n(s?.limitMB, 50, 100000, DEFAULTS.limitMB),
  };
}

function loadSettings(): OfflineSettings {
  try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return clean(null); }
}

const isQuota = (e: unknown) => {
  const x = e as { name?: string; code?: number; message?: string } | null;
  return x?.name === 'QuotaExceededError' || x?.code === 22 || /quota/i.test(x?.message || '');
};

// ---------------------------------------------------------------- IndexedDB helpers
const done = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta', { keyPath: 'id' }); // { id, size, type, title, artist, source, added, used }
      r.result.createObjectStore('blobs');                    // id -> Blob
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

// Runs fn(stores...) in one transaction; resolves when it commits.
function run<T>(db: IDBDatabase, names: string[], mode: IDBTransactionMode, fn: (...stores: IDBObjectStore[]) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let out: T;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new DOMException('Transaction aborted', 'AbortError'));
    try { out = fn(...names.map((n) => t.objectStore(n))); } catch (e) { try { t.abort(); } catch { /* already done */ } reject(e); }
  });
}

// ---------------------------------------------------------------- the buffer
class Offline extends EventTarget {
  settings = loadSettings();
  db: IDBDatabase | null = null;
  index = new Map<string, Meta>();  // id -> meta, mirrors the 'meta' store
  urls = new Map<string, string>(); // id -> object URL
  keep = new Set<string>();         // ids in the current window: never evicted or revoked
  want: Track[] = [];               // tracks to download, in order
  failed = new Map<string, number>(); // id -> time of last failure
  job: { id: string; ctrl: AbortController } | null = null;
  running = false;
  last: { queue: Track[]; index: number } | null = null;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  ready: Promise<void>;

  constructor() {
    super();
    this.ready = this.init();
    window.addEventListener('online', () => this.kick());
    // Phones freeze timers in the background, so also check when the app comes back.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.expire(); });
  }

  get supported(): boolean { return typeof indexedDB !== 'undefined'; }
  get limitBytes(): number { return this.settings.limitMB * 1048576; }
  get bytes(): number { let n = 0; for (const m of this.index.values()) n += m.size; return n; }

  async init(): Promise<void> {
    if (!this.supported) return;
    try {
      const db = await openDb();
      this.db = db;
      const all = await run(db, ['meta'], 'readonly', (meta) => done(meta.getAll() as IDBRequest<Meta[]>));
      for (const m of await all) this.index.set(m.id, m);
      db.onversionchange = () => { db.close(); this.db = null; };
      if (this.index.size) this.emit({ type: 'loaded' });
      setTimeout(() => this.expire(), FIRST_SWEEP_MS);
      setInterval(() => this.expire(), SWEEP_MS);
    } catch {
      this.db = null; // private mode or storage disabled: buffering just stays off
    }
  }

  emit(detail: Record<string, unknown>): void { this.dispatchEvent(new CustomEvent('change', { detail })); }

  // Live radio never ends; local files are already on disk when running on the computer itself.
  eligible(t: Track | null | undefined): boolean {
    return Boolean(t?.id && typeof t.stream === 'string' && t.stream.startsWith('/') && !t.live && !(HOME && t.source === 'local'));
  }

  // True when a downloaded copy exists. Synchronous; false until the index has loaded (await offline.ready).
  isCached(id: string): boolean { return this.index.has(id); }

  // Object URL already created for a downloaded song (songs in the prefetch window get one ahead of time).
  url(id: string): string | null { return (this.index.has(id) && this.urls.get(id)) || null; }

  // Object URL for the downloaded copy, or null.
  async get(id: string): Promise<string | null> {
    await this.ready;
    if (!this.db || !this.index.has(id)) return null;
    if (this.urls.has(id)) { this.touch(id); return this.urls.get(id)!; }
    let value: Blob | { buf: ArrayBuffer; type: string } | undefined;
    try { value = await (await run(this.db, ['blobs'], 'readonly', (b) => done(b.get(id)))); } catch { return null; }
    if (!value) { await this.remove(id); return null; }
    if (this.urls.has(id)) return this.urls.get(id)!; // created meanwhile by a parallel call
    const meta = this.index.get(id);
    const blob = value instanceof Blob ? value : new Blob([value.buf], { type: value.type || meta?.type || '' });
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    this.touch(id);
    return url;
  }

  touch(id: string): void {
    const m = this.index.get(id);
    if (!m || !this.db || Date.now() - m.used < TOUCH_MS) return;
    m.used = Date.now();
    run(this.db, ['meta'], 'readwrite', (meta) => meta.put(m)).catch(() => {});
  }

  // Keeps the current song plus the next `ahead` songs downloaded.
  prefetch(queue: Track[], index: number): void {
    this.last = { queue, index };
    const win = (queue || []).slice(Math.max(0, index), Math.max(0, index) + 1 + this.settings.ahead).filter((t) => this.eligible(t));
    this.keep = new Set(win.map((t) => t.id));
    for (const [id, url] of this.urls) if (!this.keep.has(id)) { URL.revokeObjectURL(url); this.urls.delete(id); }
    if (this.job && !this.keep.has(this.job.id)) this.job.ctrl.abort();
    if (!this.settings.enabled || !this.supported) { this.stop(); return; }
    this.want = win;
    this.ready.then(() => {
      if (!this.db) return;
      for (const t of win) if (this.index.has(t.id) && !this.urls.has(t.id)) this.get(t.id);
      this.kick();
    });
  }

  stop(): void {
    this.want = [];
    this.job?.ctrl.abort();
    clearTimeout(this.retryTimer);
  }

  kick(): void {
    if (this.running || !this.db || !this.settings.enabled) return;
    this.running = true;
    this.loop().finally(() => { this.running = false; });
  }

  async loop(): Promise<void> {
    const pending = () => this.want.filter((t) => !this.index.has(t.id));
    for (;;) {
      if (!this.settings.enabled || !this.db || navigator.onLine === false) break;
      const t = pending().find((x) => Date.now() - (this.failed.get(x.id) || 0) > RETRY_MS);
      if (!t) break;
      await this.download(t);
    }
    // Something failed: try again later (or as soon as the network is back).
    clearTimeout(this.retryTimer);
    if (this.settings.enabled && pending().length) this.retryTimer = setTimeout(() => this.kick(), RETRY_MS);
  }

  async download(t: Track): Promise<void> {
    const ctrl = new AbortController();
    this.job = { id: t.id, ctrl };
    try {
      const res = await fetch(media(t.stream), { signal: ctrl.signal, cache: 'no-store' });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (res.status !== 200 || !AUDIO_TYPE.test(type)) throw new Error('Not downloadable');
      if (Number(res.headers.get('content-length')) > this.limitBytes) throw new Error('Too large');
      let blob = await res.blob();
      if (ctrl.signal.aborted || !this.keep.has(t.id)) return;
      if (!blob.size || blob.size > this.limitBytes) throw new Error('Too large');
      if (blob.type !== type) blob = new Blob([blob], { type });
      await this.save(t, blob, type);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') this.failed.set(t.id, Date.now());
    } finally {
      if (this.job?.ctrl === ctrl) this.job = null;
    }
  }

  async save(t: Pick<Track, 'id'> & Partial<Track>, blob: Blob, type: string): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('No database');
    const now = Date.now();
    const meta: Meta = { id: t.id, size: blob.size, type, title: t.title || '', artist: t.artist || '', source: t.source || '', added: now, used: now };
    await this.evict(this.bytes + meta.size - this.limitBytes);
    if (this.bytes + meta.size > this.limitBytes) throw new Error('No room');
    const put = (value: unknown) => run(db, ['meta', 'blobs'], 'readwrite', (m, b) => { m.put(meta); b.put(value, t.id); });
    try {
      await put(blob);
    } catch (e) {
      if ((e as Error)?.name === 'DataCloneError') {
        // Very old Safari can't store Blobs: fall back to raw bytes.
        await put({ buf: await blob.arrayBuffer(), type });
      } else if (isQuota(e)) {
        // The browser ran out of space before our own limit: free some and retry once.
        await this.evict(meta.size, true);
        await put(blob); // throws again if still full: download marked as failed, nothing else happens
      } else throw e;
    }
    this.index.set(t.id, meta);
    if (navigator.storage?.persist && this.index.size === 1) navigator.storage.persist().catch(() => {});
    this.emit({ type: 'added', id: t.id });
    if (this.keep.has(t.id)) this.get(t.id);
  }

  // Frees at least `need` bytes, least recently used first, never touching the current window.
  // quota=true: the browser itself is full, so free space even if we are under our limit.
  async evict(need: number, quota = false): Promise<void> {
    if (need <= 0 && !quota) return;
    const victims: string[] = [];
    let freed = 0;
    for (const m of [...this.index.values()].sort((a, b) => a.used - b.used)) {
      if (freed >= need) break;
      if (this.keep.has(m.id)) continue;
      victims.push(m.id);
      freed += m.size;
    }
    if (victims.length) await this.remove(...victims);
  }

  // Deletes songs not played for EXPIRE_MS. The current window is never touched, and nothing
  // is deleted while offline: that is exactly when the downloaded copies are needed.
  async expire(now = Date.now()): Promise<void> {
    if (!this.db || navigator.onLine === false) return;
    const old = [...this.index.values()]
      .filter((m) => !this.keep.has(m.id) && now - (m.used || m.added || 0) > EXPIRE_MS)
      .map((m) => m.id);
    if (old.length) await this.remove(...old);
  }

  async remove(...ids: string[]): Promise<void> {
    ids = ids.filter((id) => this.index.has(id));
    if (!ids.length || !this.db) return;
    try {
      await run(this.db, ['meta', 'blobs'], 'readwrite', (m, b) => { for (const id of ids) { m.delete(id); b.delete(id); } });
    } catch { return; }
    for (const id of ids) {
      this.index.delete(id);
      const url = this.urls.get(id);
      if (url) { URL.revokeObjectURL(url); this.urls.delete(id); }
    }
    this.emit({ type: 'removed', ids });
  }

  // Deletes every downloaded song. URLs of the current window stay alive (one may be playing)
  // and are revoked when they leave the window.
  async clear(): Promise<void> {
    await this.ready;
    this.stop();
    if (this.db) {
      try { await run(this.db, ['meta', 'blobs'], 'readwrite', (m, b) => { m.clear(); b.clear(); }); } catch { /* */ }
    }
    this.index.clear();
    this.failed.clear();
    for (const [id, url] of this.urls) if (!this.keep.has(id)) { URL.revokeObjectURL(url); this.urls.delete(id); }
    this.emit({ type: 'cleared' });
  }

  async status(): Promise<{ count: number; bytes: number }> {
    await this.ready;
    return { count: this.index.size, bytes: this.bytes };
  }

  setSettings(patch: Partial<OfflineSettings>): void {
    const before = this.settings;
    this.settings = clean({ ...before, ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* storage full or blocked */ }
    this.emit({ type: 'settings', settings: this.settings });
    if (!this.settings.enabled) { this.stop(); return; }
    if (this.settings.limitMB < before.limitMB) this.ready.then(() => this.evict(this.bytes - this.limitBytes));
    if (this.last) this.prefetch(this.last.queue, this.last.index);
  }
}

export const offline = new Offline();

export function fmtSize(bytes: number): string {
  const mb = bytes / 1048576;
  if (mb >= 1024) return (mb / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 }) + ' GB';
  return (bytes > 0 && mb < 1 ? '<1' : Math.round(mb).toLocaleString(locale())) + ' MB';
}

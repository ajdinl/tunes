// Offline buffer: downloads the current song and the next few in the queue to
// the device, so playback survives a dropped connection (leaving Wi-Fi, a tunnel).
// Phones open Tunes over plain http, which is not a secure context: no Service
// Worker, no Cache API. Audio Blobs therefore live in IndexedDB and are played
// through object URLs.
import { h, icon, toast, songs, tr } from './ui.js';
import { locale } from './i18n.js';

const KEY = 'tunes.offline';
const DB_NAME = 'tunes-offline';
const DEFAULTS = { enabled: true, ahead: 3, limitMB: 500 };
const RETRY_MS = 60000;   // wait before retrying a failed download
const TOUCH_MS = 60000;   // write "last used" at most once a minute per song
const HOME = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
const AUDIO_TYPE = /^(audio|video)\/|^application\/(ogg|octet-stream)$/;

function clean(s) {
  const n = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
  return {
    enabled: typeof s?.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    ahead: n(s?.ahead, 1, 10, DEFAULTS.ahead),
    limitMB: n(s?.limitMB, 50, 100000, DEFAULTS.limitMB),
  };
}

function loadSettings() {
  try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch { return clean(null); }
}

// ---------------------------------------------------------------- IndexedDB helpers
const done = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

function openDb() {
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
function run(db, names, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new DOMException('Transaction aborted', 'AbortError'));
    try { out = fn(...names.map((n) => t.objectStore(n))); } catch (e) { try { t.abort(); } catch { /* already done */ } reject(e); }
  });
}

const isQuota = (e) => e?.name === 'QuotaExceededError' || e?.code === 22 || /quota/i.test(e?.message || '');

// ---------------------------------------------------------------- the buffer
class Offline extends EventTarget {
  constructor() {
    super();
    this.settings = loadSettings();
    this.db = null;
    this.index = new Map();  // id -> meta, mirrors the 'meta' store
    this.urls = new Map();   // id -> object URL
    this.keep = new Set();   // ids in the current window: never evicted or revoked
    this.want = [];          // tracks to download, in order
    this.failed = new Map(); // id -> time of last failure
    this.job = null;         // { id, ctrl } of the running download
    this.running = false;
    this.last = null;        // last { queue, index } passed to prefetch()
    this.retryTimer = 0;
    this.ready = this.init();
    window.addEventListener('online', () => this.kick());
  }

  get supported() { return typeof indexedDB !== 'undefined'; }
  get limitBytes() { return this.settings.limitMB * 1048576; }
  get bytes() { let n = 0; for (const m of this.index.values()) n += m.size; return n; }

  async init() {
    if (!this.supported) return;
    try {
      this.db = await openDb();
      const all = await run(this.db, ['meta'], 'readonly', (meta) => done(meta.getAll()));
      for (const m of all) this.index.set(m.id, m);
      this.db.onversionchange = () => { this.db.close(); this.db = null; };
      if (this.index.size) this.emit({ type: 'loaded' });
    } catch {
      this.db = null; // private mode or storage disabled: buffering just stays off
    }
  }

  emit(detail) { this.dispatchEvent(new CustomEvent('change', { detail })); }

  // Live radio never ends; local files are already on disk when running on the computer itself.
  eligible(t) {
    return Boolean(t?.id && typeof t.stream === 'string' && t.stream.startsWith('/') && !t.live && !(HOME && t.source === 'local'));
  }

  // True when a downloaded copy exists. Synchronous; false until the index has loaded (await offline.ready).
  isCached(id) { return this.index.has(id); }

  // Object URL already created for a downloaded song (songs in the prefetch window get one ahead of time).
  url(id) { return (this.index.has(id) && this.urls.get(id)) || null; }

  // Object URL for the downloaded copy, or null.
  async get(id) {
    await this.ready;
    if (!this.db || !this.index.has(id)) return null;
    if (this.urls.has(id)) { this.touch(id); return this.urls.get(id); }
    let value;
    try { value = await run(this.db, ['blobs'], 'readonly', (b) => done(b.get(id))); } catch { return null; }
    if (!value) { await this.remove(id); return null; }
    if (this.urls.has(id)) return this.urls.get(id); // created meanwhile by a parallel call
    const meta = this.index.get(id);
    const blob = value instanceof Blob ? value : new Blob([value.buf], { type: value.type || meta?.type || '' });
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    this.touch(id);
    return url;
  }

  touch(id) {
    const m = this.index.get(id);
    if (!m || Date.now() - m.used < TOUCH_MS) return;
    m.used = Date.now();
    run(this.db, ['meta'], 'readwrite', (meta) => meta.put(m)).catch(() => {});
  }

  // Keeps the current song plus the next `ahead` songs downloaded.
  prefetch(queue, index) {
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

  stop() {
    this.want = [];
    this.job?.ctrl.abort();
    clearTimeout(this.retryTimer);
  }

  kick() {
    if (this.running || !this.db || !this.settings.enabled) return;
    this.running = true;
    this.loop().finally(() => { this.running = false; });
  }

  async loop() {
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

  async download(t) {
    const ctrl = new AbortController();
    this.job = { id: t.id, ctrl };
    try {
      const res = await fetch(t.stream, { signal: ctrl.signal, cache: 'no-store' });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (res.status !== 200 || !AUDIO_TYPE.test(type)) throw new Error('Not downloadable');
      if (Number(res.headers.get('content-length')) > this.limitBytes) throw new Error('Too large');
      let blob = await res.blob();
      if (ctrl.signal.aborted || !this.keep.has(t.id)) return;
      if (!blob.size || blob.size > this.limitBytes) throw new Error('Too large');
      if (blob.type !== type) blob = new Blob([blob], { type });
      await this.save(t, blob, type);
    } catch (e) {
      if (e?.name !== 'AbortError') this.failed.set(t.id, Date.now());
    } finally {
      if (this.job?.ctrl === ctrl) this.job = null;
    }
  }

  async save(t, blob, type) {
    const now = Date.now();
    const meta = { id: t.id, size: blob.size, type, title: t.title || '', artist: t.artist || '', source: t.source || '', added: now, used: now };
    await this.evict(this.bytes + meta.size - this.limitBytes);
    if (this.bytes + meta.size > this.limitBytes) throw new Error('No room');
    const put = (value) => run(this.db, ['meta', 'blobs'], 'readwrite', (m, b) => { m.put(meta); b.put(value, t.id); });
    try {
      await put(blob);
    } catch (e) {
      if (e?.name === 'DataCloneError') {
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
  async evict(need, quota = false) {
    if (need <= 0 && !quota) return;
    const victims = [];
    let freed = 0;
    for (const m of [...this.index.values()].sort((a, b) => a.used - b.used)) {
      if (freed >= need) break;
      if (this.keep.has(m.id)) continue;
      victims.push(m.id);
      freed += m.size;
    }
    if (victims.length) await this.remove(...victims);
  }

  async remove(...ids) {
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
  async clear() {
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

  async status() {
    await this.ready;
    return { count: this.index.size, bytes: this.bytes };
  }

  setSettings(patch) {
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

// ---------------------------------------------------------------- Settings page
export function fmtSize(bytes) {
  const mb = bytes / 1048576;
  if (mb >= 1024) return (mb / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 }) + ' GB';
  return (bytes > 0 && mb < 1 ? '<1' : Math.round(mb).toLocaleString(locale())) + ' MB';
}

let uid = 0;

// Content for a Settings section (mount it under a heading such as tr('Offline playback')).
export function renderOfflineSettings() {
  const root = h('div.form');
  if (!offline.supported) {
    root.append(h('p.muted', {}, tr('This browser can\'t store songs for offline playback.')));
    return root;
  }
  const id = 'offline-' + ++uid;
  const narrow = { width: 'auto', minWidth: '0', flex: 'none' };

  const onOff = h('button.switch', {
    type: 'button', role: 'switch', 'aria-labelledby': id + '-on',
    onclick: () => offline.setSettings({ enabled: !offline.settings.enabled }),
  }, h('span.switch__knob'));

  const ahead = h('select.field', { id: id + '-ahead', style: narrow, onchange: () => offline.setSettings({ ahead: Number(ahead.value) }) },
    Array.from({ length: 10 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));

  const LIMITS = [100, 250, 500, 1024, 2048, 4096, 8192];
  const limit = h('select.field', { id: id + '-limit', style: narrow, onchange: () => offline.setSettings({ limitMB: Number(limit.value) }) });

  const usage = h('p.muted', { 'aria-live': 'polite' });
  const clearBtn = h('button.btn.btn--ghost', {
    type: 'button',
    onclick: async () => {
      clearBtn.disabled = true;
      await offline.clear();
      toast(tr('Downloaded songs cleared'));
    },
  }, icon('trash', 16), tr('Clear downloaded songs'));

  const update = async () => {
    const s = offline.settings;
    onOff.setAttribute('aria-checked', String(s.enabled));
    ahead.value = String(s.ahead);
    ahead.disabled = limit.disabled = !s.enabled;
    const opts = [...new Set([...LIMITS, s.limitMB])].sort((a, b) => a - b);
    limit.replaceChildren(...opts.map((mb) => h('option', { value: String(mb) }, fmtSize(mb * 1048576))));
    limit.value = String(s.limitMB);
    const { count, bytes } = await offline.status();
    usage.textContent = tr('Downloaded for offline') + ': ' + (count ? `${songs(count)}, ${fmtSize(bytes)}` : tr('nothing yet'));
    clearBtn.disabled = !count;
  };

  // Follow cache changes while mounted; detach once the page is gone.
  let mounted = false;
  const onChange = () => {
    if (!root.isConnected) { if (mounted) offline.removeEventListener('change', onChange); return; }
    mounted = true;
    update();
  };
  offline.addEventListener('change', onChange);
  requestAnimationFrame(() => { if (root.isConnected) mounted = true; });

  root.append(
    h('p.muted', {}, tr('Downloads the current song and the next ones in the queue to this device, so music keeps playing when the connection drops.')),
    h('div.row', {}, onOff, h('span', { id: id + '-on' }, tr('Download songs ahead'))),
    h('div.row', {}, h('label', { for: id + '-ahead' }, tr('Songs to keep ahead')), ahead),
    h('div.row', {}, h('label', { for: id + '-limit' }, tr('Storage limit')), limit),
    usage,
    clearBtn,
    HOME ? h('p.muted', {}, tr('On this computer, songs from your own folders are not downloaded: they are already here.')) : null,
  );
  update();
  return root;
}

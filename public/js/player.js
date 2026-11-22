// Player: play queue, shuffle/repeat, equalizer, spectrum analyser,
// history, Media Session (media keys and Control Center), offline buffer.
import { store, api } from './store.js';
import { shuffleArray, toast, tr } from './ui.js';
import { offline } from './offline.js';
import { SoundCloudElement } from './soundcloud.js';

const STALL_MS = 8000; // stalled this long while offline: switch to the downloaded copy
const STALL_ONLINE_MS = 15000; // same, when the browser still claims to be online

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Rock: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  Acoustic: [3, 2, 1, 1, 2, 2, 3, 2, 2, 1],
  'Quiet night': [-3, -2, 0, 1, 2, 2, 1, 0, -2, -4],
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem('tunes.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tunes.' + k, JSON.stringify(v)); } catch { /* storage full */ } },
};

class Player extends EventTarget {
  constructor() {
    super();
    this.fx = new Audio();     // goes through the equalizer and analyser
    this.plain = new Audio();  // fallback for stations that don't work through the proxy
    this.sc = new SoundCloudElement(); // SoundCloud links, through the official embedded player
    this.fx.preload = 'metadata';
    this.el = this.fx;
    this.queue = [];
    this.unshuffled = null;
    this.index = -1;
    this.shuffle = LS.get('shuffle', false);
    this.repeat = LS.get('repeat', 'off'); // off | all | one
    this.volume = LS.get('volume', 0.8);
    this.muted = false;
    this.context = null; // { label, href }
    this.errors = 0;
    this.icyTitle = null;
    this.sleep = null;   // { until, mode }
    this.ctx = null;
    this.filters = [];
    this.analyser = null;
    this.eq = LS.get('eq', { enabled: false, preset: 'Flat', gains: EQ_PRESETS.Flat.slice() });
    this.loadSeq = 0;          // bumped on every load(), guards async source switches
    this.offlineSrc = false;   // fx is playing a downloaded copy (blob URL)
    this.stallTimer = 0;

    for (const el of [this.fx, this.plain, this.sc]) {
      el.volume = this.volume;
      el.addEventListener('play', () => this.emit('state'));
      el.addEventListener('pause', () => this.emit('state'));
      el.addEventListener('waiting', () => this.emit('state'));
      el.addEventListener('playing', () => { this.errors = 0; this.emit('state'); });
      el.addEventListener('timeupdate', () => this.onTime(el));
      el.addEventListener('durationchange', () => this.emit('time'));
      el.addEventListener('ended', () => this.onEnded(el));
      el.addEventListener('error', () => this.onError(el));
    }
    // Offline buffer: keep the current and next songs downloaded.
    for (const type of ['track', 'queue']) this.addEventListener(type, () => this.schedulePrefetch());
    this.fx.addEventListener('playing', () => this.schedulePrefetch());
    for (const type of ['waiting', 'stalled']) this.fx.addEventListener(type, () => this.armStall());
    for (const type of ['playing', 'timeupdate', 'pause', 'emptied']) this.fx.addEventListener(type, () => this.clearStall());
    // Inside a SoundCloud set the song changes without Tunes loading anything.
    this.sc.addEventListener('sound', () => { this.updateMediaSession(); this.emit('sound'); });
    this.sc.addEventListener('blocked', () => { if (this.el === this.sc) this.emit('scblocked'); });
    this.setupMediaSession();
    this.restore();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  get track() { return this.queue[this.index] || null; }
  get playing() { return !this.el.paused && !this.el.ended; }
  get loading() { return this.el.readyState < 3 && !this.el.paused; }
  get time() { return this.el.currentTime || 0; }
  get duration() {
    const d = this.el.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.track?.live ? Infinity : (this.track?.duration || 0);
  }

  // ------------------------------------------------------------ Web Audio
  // On phones audio skips Web Audio: iOS and Android silence it when the screen locks.
  // What SoundCloud reports as playing inside a set or artist page (title, artist, artwork).
  get scSound() {
    const s = this.el === this.sc ? this.sc.sound : null;
    if (!s || this.track?.kind === 'track') return null;
    return { title: s.title, artist: s.user?.username || '', cover: s.artwork_url ? s.artwork_url.replace('-large.', '-t500x500.') : null };
  }

  get mobile() { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); }

  ensureGraph() {
    if (this.mobile) return;
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaElementSource(this.fx);
    let node = src;
    this.filters = EQ_FREQS.map((f, i) => {
      const b = this.ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      node.connect(b);
      node = b;
      return b;
    });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.78;
    node.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.applyEq();
  }

  setEq(patch) {
    this.eq = { ...this.eq, ...patch };
    LS.set('eq', this.eq);
    this.applyEq();
    this.emit('eq');
  }

  applyEq() {
    this.filters.forEach((f, i) => {
      const g = this.eq.enabled ? (this.eq.gains[i] || 0) : 0;
      f.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    });
  }

  // Whether the current audio goes through the analyser (the radio fallback doesn't).
  get analysing() { return Boolean(this.analyser) && this.el === this.fx; }

  // ------------------------------------------------------------ play queue
  playList(tracks, start = 0, { shuffle = this.shuffle, context = null } = {}) {
    if (!tracks.length) return;
    let list = tracks.slice();
    this.unshuffled = list.slice();
    if (shuffle) {
      const first = start >= 0 ? list.splice(start, 1) : [];
      list = [...first, ...shuffleArray(list)];
      start = 0;
      if (!this.shuffle) { this.shuffle = true; LS.set('shuffle', true); }
    }
    this.queue = list;
    this.context = context;
    this.load(Math.max(0, start), true);
    this.emit('queue');
  }

  // Continue from another device: same queue, same song, same second.
  resumeAt(queue, index, time, context) {
    if (!queue?.length) return;
    this.queue = queue.slice();
    this.unshuffled = queue.slice();
    this.context = context || null;
    this.pendingSeek = time > 1 ? time : 0;
    this.load(Math.min(Math.max(0, index), queue.length - 1), true);
    this.emit('queue');
  }

  playNext(tracks) {
    tracks = [].concat(tracks);
    if (!this.track) return this.playList(tracks, 0, { shuffle: false });
    this.queue.splice(this.index + 1, 0, ...tracks);
    this.unshuffled?.push(...tracks);
    this.emit('queue');
  }

  addToQueue(tracks) {
    tracks = [].concat(tracks);
    if (!this.track) return this.playList(tracks, 0, { shuffle: false });
    this.queue.push(...tracks);
    this.unshuffled?.push(...tracks);
    this.emit('queue');
  }

  removeAt(i) {
    if (i === this.index) return;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    this.emit('queue');
    this.persist();
  }

  move(from, to) {
    if (from === to) return;
    const [t] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, t);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this.emit('queue');
    this.persist();
  }

  clearUpcoming() {
    this.queue.splice(this.index + 1);
    this.emit('queue');
    this.persist();
  }

  jump(i) { if (this.queue[i]) this.load(i, true); }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    LS.set('shuffle', this.shuffle);
    const cur = this.track;
    if (cur) {
      if (this.shuffle) {
        this.unshuffled = this.queue.slice();
        const rest = this.queue.filter((_, i) => i !== this.index);
        this.queue = [cur, ...shuffleArray(rest)];
        this.index = 0;
      } else if (this.unshuffled) {
        this.queue = this.unshuffled.slice();
        this.index = Math.max(0, this.queue.findIndex((t) => t.id === cur.id));
      }
      this.emit('queue');
    }
    this.emit('mode');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    LS.set('repeat', this.repeat);
    this.emit('mode');
  }

  // ------------------------------------------------------------ playback
  load(i, autoplay) {
    this.index = i;
    const t = this.track;
    if (!t) return;
    this.listened = 0;
    this.logged = false;
    this.lastT = 0;
    this.icyTitle = null;
    this.triedDirect = false;
    this.plain.pause();
    this.plain.removeAttribute('src');
    this.el = this.fx;
    this.clearStall();
    const seq = ++this.loadSeq;
    const at = this.pendingSeek && !t.live ? this.pendingSeek : 0;
    this.pendingSeek = 0;
    if (t.source === 'soundcloud') {
      this.fx.pause();
      this.fx.removeAttribute('src');
      this.fx.load();
      this.offlineSrc = false;
      this.el = this.sc;
      this.sc.load(t.link || t.stream, { autoplay, at });
      this.updateMediaSession();
      this.emit('track', t);
      this.emit('state');
      this.persist();
      return;
    }
    this.sc.unload();
    const start = (src, isCopy) => {
      this.offlineSrc = isCopy;
      this.fx.src = src;
      if (at) this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = at; this.lastT = at; this.emit('time'); }, { once: true });
      if (autoplay) this.fx.play().catch((e) => { if (e.name !== 'AbortError') this.emit('error', tr('Playback was blocked: press Play.')); });
    };
    if (autoplay) this.ensureGraph();
    // Play the downloaded copy when there is one. Songs in the prefetch window already
    // have an object URL; others need a quick IndexedDB read first.
    const copy = t.live ? null : offline.url(t.id);
    if (copy || t.live || !offline.isCached(t.id)) start(copy || t.stream, Boolean(copy));
    else {
      this.fx.pause();
      offline.get(t.id).then((url) => { if (seq === this.loadSeq) start(url || t.stream, Boolean(url)); });
    }
    if (autoplay && !t.live) api('/api/nowplaying', { method: 'POST', body: { track: t } }).catch(() => {});
    this.updateMediaSession();
    this.emit('track', t);
    this.emit('state');
    this.persist();
  }

  toggle() {
    if (!this.track) {
      const pool = store.smart('mix');
      if (pool.length) this.playList(pool, 0, { context: { label: tr('My mix'), href: '#/smart/mix' } });
      return;
    }
    if (this.el.paused) {
      this.ensureGraph();
      // After a pause radio restarts, so it doesn't play a stale buffer.
      if (this.track.live && this.el === this.fx) this.fx.src = this.track.stream;
      this.el.play().catch(() => {});
    } else this.el.pause();
  }

  play() { if (this.el.paused) this.toggle(); }
  pause() { this.el.pause(); }

  next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) return this.load(this.index + 1, true);
    if (this.repeat === 'all' || !auto) {
      if (this.repeat === 'all') {
        if (this.shuffle) this.queue = shuffleArray(this.queue);
        return this.load(0, true);
      }
    }
    this.el.pause();
    this.emit('state');
  }

  prev() {
    if (this.time > 3 && !this.track?.live) { this.seek(0); return; }
    if (this.index > 0) this.load(this.index - 1, true);
    else if (this.repeat === 'all' && this.queue.length) this.load(this.queue.length - 1, true);
    else this.seek(0);
  }

  seek(t) {
    if (!this.track || this.track.live) return;
    const d = this.duration;
    this.el.currentTime = Math.max(0, Math.min(t, Number.isFinite(d) ? d - 0.25 : t));
    this.lastT = this.el.currentTime;
    this.emit('time');
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.muted = this.volume === 0 ? this.muted : false;
    this.fx.volume = this.plain.volume = this.sc.volume = this.volume;
    this.fx.muted = this.plain.muted = this.sc.muted = this.muted;
    LS.set('volume', this.volume);
    this.emit('volume');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.fx.muted = this.plain.muted = this.sc.muted = this.muted;
    this.emit('volume');
  }

  // ------------------------------------------------------------ events
  onTime(el) {
    if (el !== this.el) return;
    const t = el.currentTime;
    const d = t - this.lastT;
    if (d > 0 && d < 2 && !el.paused) this.listened += d;
    this.lastT = t;
    const track = this.track;
    // Same rule as ListenBrainz: half the song or 4 minutes.
    if (track && !this.logged) {
      const dur = this.duration;
      const enough = track.live ? this.listened >= 30 : (dur > 30 && this.listened >= Math.min(dur / 2, 240));
      if (enough) { this.logged = true; store.logPlay(track).catch(() => {}); }
    }
    if (this.sleep?.until && Date.now() >= this.sleep.until) this.fadeOutAndStop();
    const now = Date.now();
    if (!this._lastPersist || now - this._lastPersist > 5000) { this._lastPersist = now; this.persist(); this.updatePosition(); }
    this.emit('time');
  }

  onEnded(el) {
    if (el !== this.el) return;
    if (this.sleep?.mode === 'end') { this.clearSleep(); this.emit('state'); return; }
    if (this.repeat === 'one') { this.seek(0); this.el.play(); return; }
    this.next(true);
  }

  onError(el) {
    if (el !== this.el || !el.getAttribute('src')) return;
    const t = this.track;
    if (!t) return;
    if (el === this.fx && !t.live) {
      // The downloaded copy itself is broken: drop it and stream instead.
      if (this.offlineSrc) {
        this.offlineSrc = false;
        offline.remove(t.id);
        this.switchSrc(t.stream);
        return;
      }
      // The stream failed (usually the network): continue from the downloaded copy.
      if (offline.isCached(t.id)) {
        const seq = this.loadSeq;
        this.useOfflineCopy().then((ok) => { if (!ok && seq === this.loadSeq) this.failTrack(t); });
        return;
      }
    }
    // Some radio stations don't work through the proxy: play them directly (no equalizer).
    if (t.live && !this.triedDirect) {
      this.triedDirect = true;
      const direct = new URL(t.stream, location.href).searchParams.get('u');
      if (direct) {
        this.fx.pause();
        this.el = this.plain;
        this.plain.src = direct;
        this.plain.volume = this.volume;
        this.plain.play().catch(() => {});
        this.emit('state');
        return;
      }
    }
    this.failTrack(t);
  }

  failTrack(t) {
    this.errors++;
    this.emit('error', t.live ? tr('Station “{title}” isn\'t broadcasting right now.', { title: t.title }) : tr('“{title}” can\'t be played.', { title: t.title }));
    if (!t.live && this.errors < 3 && this.index < this.queue.length - 1) setTimeout(() => this.next(true), 1200);
    this.emit('state');
  }

  // ------------------------------------------------------------ offline buffer
  schedulePrefetch() {
    clearTimeout(this.prefetchTimer);
    // Short delay so the stream that just started gets the bandwidth first.
    this.prefetchTimer = setTimeout(() => offline.prefetch(this.queue, this.index), 1500);
  }

  // Switch to the downloaded copy after 8 s of stalling while the browser reports
  // offline, or after 15 s even when it says "online": phones on mobile data often
  // stay "online" while the connection to the home computer is gone.
  armStall(elapsed = 0) {
    if ((this.stallTimer && !elapsed) || this.el !== this.fx || this.offlineSrc) return;
    const wait = elapsed ? STALL_ONLINE_MS - elapsed : STALL_MS;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = 0;
      const t = this.track;
      if (!t || t.live || this.el !== this.fx || this.offlineSrc) return;
      if (this.fx.paused || this.fx.readyState >= 3 || !offline.isCached(t.id)) return;
      if (navigator.onLine === false || elapsed) { this.useOfflineCopy(); return; }
      this.armStall(STALL_MS);
    }, wait);
  }

  clearStall() {
    clearTimeout(this.stallTimer);
    this.stallTimer = 0;
  }

  // Loads src into fx and resumes at the last known position.
  switchSrc(src) {
    const at = this.fx.currentTime || this.lastT || 0;
    this.fx.src = src;
    if (at) this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = at; this.lastT = at; this.emit('time'); }, { once: true });
    this.fx.play().catch(() => {});
    this.emit('state');
  }

  // Switches the current song to its downloaded copy. Resolves false if there is none.
  async useOfflineCopy() {
    const t = this.track;
    const seq = this.loadSeq;
    if (!t || this.offlineSrc) return false;
    const url = await offline.get(t.id);
    if (!url || seq !== this.loadSeq || this.el !== this.fx || this.offlineSrc) return false;
    this.clearStall();
    this.offlineSrc = true;
    this.switchSrc(url);
    toast(tr('Connection lost: playing the downloaded copy'));
    return true;
  }

  // ------------------------------------------------------------ sleep timer
  setSleep(minutes) {
    if (!minutes) return this.clearSleep();
    this.sleep = minutes === 'end' ? { mode: 'end' } : { mode: 'time', until: Date.now() + minutes * 60000, minutes };
    this.emit('sleep');
  }

  clearSleep() { this.sleep = null; this.emit('sleep'); }

  fadeOutAndStop() {
    if (this._fading) return;
    this._fading = true;
    const start = this.el.volume;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      this.el.volume = Math.max(0, start * (1 - step / 40));
      if (step >= 40) {
        clearInterval(iv);
        this.el.pause();
        this.el.volume = this.volume;
        this._fading = false;
        this.clearSleep();
      }
    }, 250);
  }

  // ------------------------------------------------------------ Media Session
  setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.prev());
    set('seekto', (e) => this.seek(e.seekTime));
    set('seekbackward', (e) => this.seek(this.time - (e.seekOffset || 10)));
    set('seekforward', (e) => this.seek(this.time + (e.seekOffset || 10)));
  }

  updateMediaSession() {
    const ms = navigator.mediaSession;
    const t = this.track;
    if (!ms || !t) return;
    const sc = this.scSound;
    const coverUrl = sc?.cover || t.cover;
    const art = coverUrl ? [{ src: new URL(coverUrl, location.href).href, sizes: '512x512' }] : [];
    ms.metadata = new MediaMetadata({
      title: sc?.title || this.icyTitle || t.title,
      artist: sc ? sc.artist : this.icyTitle ? t.title : t.artist || '',
      album: t.album || '',
      artwork: art,
    });
  }

  updatePosition() {
    const d = this.duration;
    if (!navigator.mediaSession?.setPositionState || !Number.isFinite(d) || d <= 0) return;
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(this.time, d), playbackRate: 1 }); } catch { /* */ }
  }

  setIcy(sid, title) {
    const t = this.track;
    if (!t?.live || !t.stream.includes('sid=' + encodeURIComponent(sid))) return;
    this.icyTitle = title || null;
    this.updateMediaSession();
    this.emit('icy', title);
  }

  // ------------------------------------------------------------ saving the queue
  persist() {
    LS.set('queue', { queue: this.queue.slice(0, 2000), index: this.index, time: this.track?.live ? 0 : this.time, context: this.context });
  }

  restore() {
    const s = LS.get('queue', null);
    if (!s?.queue?.length) return;
    this.queue = s.queue;
    this.index = Math.min(s.index, s.queue.length - 1);
    this.context = s.context;
    const t = this.track;
    if (!t) return;
    if (t.source === 'soundcloud') {
      this.el = this.sc;
      // Wait for the app to give the widget its dock.
      queueMicrotask(() => this.sc.load(t.link || t.stream, { autoplay: false, at: s.time || 0 }));
    } else if (!t.live) this.fx.src = t.stream; // radio isn't preloaded: toggle() starts it only on Play
    if (s.time && !t.live && t.source !== 'soundcloud') {
      this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = s.time; this.lastT = s.time; this.emit('time'); }, { once: true });
    }
    this.listened = 0;
    this.logged = false;
    this.lastT = 0;
    queueMicrotask(() => { this.updateMediaSession(); this.emit('track', t); this.emit('queue'); });
  }
}

export const player = new Player();

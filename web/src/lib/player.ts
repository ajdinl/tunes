// Player: play queue, shuffle/repeat, equalizer, spectrum analyser, history,
// Media Session (media keys and Control Center), offline buffer.
// Framework-independent: React components subscribe with usePlayer().
import { useSyncExternalStore } from 'react';

import { store, api } from './store.ts';
import type { Context, Track } from './store.ts';
import { shuffleArray } from './format.ts';
import { tr } from './i18n.ts';
import { STANDALONE } from './env.ts';
import { media } from './media.ts';
import { toast } from './feedback.ts';
import { offline } from './offline.ts';
import { SoundCloudElement } from './soundcloud.ts';
import { IS_IOS } from './install.ts';

const STALL_MS = 8000; // stalled this long while offline: switch to the downloaded copy
const STALL_ONLINE_MS = 15000; // same, when the browser still claims to be online

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Rock: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  Acoustic: [3, 2, 1, 1, 2, 2, 3, 2, 2, 1],
  'Quiet night': [-3, -2, 0, 1, 2, 2, 1, 0, -2, -4],
};

export type Repeat = 'off' | 'all' | 'one';
export interface Eq { enabled: boolean; preset: string; gains: number[] }
export type Sleep = { mode: 'end' } | { mode: 'time'; until: number; minutes: number };
export type PlayerEvent = 'state' | 'time' | 'track' | 'queue' | 'mode' | 'volume' | 'eq' | 'sleep' | 'icy' | 'sound' | 'error' | 'scblocked';

// The three things that can play: an <audio> through Web Audio, a plain <audio> for
// stations that fail through the proxy, and the SoundCloud widget.
type MediaEl = HTMLAudioElement | SoundCloudElement;

const LS = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem('tunes.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown): void { try { localStorage.setItem('tunes.' + k, JSON.stringify(v)); } catch { /* storage full */ } },
};

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }

class Player extends EventTarget {
  fx = new Audio();      // goes through the equalizer and analyser
  plain = new Audio();   // fallback for stations that don't work through the proxy
  sc = new SoundCloudElement(); // SoundCloud links, through the official embedded player
  el: MediaEl = this.fx;
  queue: Track[] = [];
  unshuffled: Track[] | null = null;
  index = -1;
  shuffle = LS.get('shuffle', false);
  repeat: Repeat = LS.get<Repeat>('repeat', 'off');
  volume = LS.get('volume', 0.8);
  muted = false;
  context: Context | null = null;
  errors = 0;
  icyTitle: string | null = null;
  sleep: Sleep | null = null;
  ctx: AudioContext | null = null;
  filters: BiquadFilterNode[] = [];
  analyser: AnalyserNode | null = null;
  eq: Eq = LS.get('eq', { enabled: false, preset: 'Flat', gains: EQ_PRESETS.Flat.slice() });
  loadSeq = 0;          // bumped on every load(), guards async source switches
  offlineSrc = false;   // fx is playing a downloaded copy (blob URL)
  stallTimer: ReturnType<typeof setTimeout> | 0 = 0;
  listened = 0;         // seconds really heard of the current track (seeking doesn't count)
  logged = false;       // in the history
  scrobbled = false;    // sent to ListenBrainz
  startedAt = 0;        // when the current track started playing
  lastT = 0;
  triedDirect = false;
  pendingSeek = 0;
  private prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPersist = 0;
  private fading = false;

  constructor() {
    super();
    this.fx.preload = 'metadata';
    for (const el of [this.fx, this.plain, this.sc] as MediaEl[]) {
      el.volume = this.volume;
      el.addEventListener('play', () => this.emit('state'));
      el.addEventListener('pause', () => this.emit('state'));
      el.addEventListener('waiting', () => this.emit('state'));
      el.addEventListener('playing', () => { this.errors = 0; this.setupMediaSession(); this.emit('state'); });
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
    // Registered again whenever audio starts: WebKit drops the handlers it got while no audio
    // session existed and then offers its defaults (±15 s on the lock screen) instead.
    this.setupMediaSession();
    this.restore();
  }

  emit(type: PlayerEvent, detail?: unknown): void {
    versions[type] = (versions[type] || 0) + 1;
    this.dispatchEvent(new CustomEvent(type, { detail }));
    for (const l of listeners) l();
  }

  get track(): Track | null { return this.queue[this.index] || null; }
  get playing(): boolean { return !this.el.paused && !this.el.ended; }
  get loading(): boolean { return this.el.readyState < 3 && !this.el.paused; }
  get time(): number { return this.el.currentTime || 0; }
  get duration(): number {
    const d = this.el.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.track?.live ? Infinity : (this.track?.duration || 0);
  }

  // What SoundCloud reports as playing inside a set or artist page (title, artist, artwork).
  get scSound(): { title: string; artist: string; cover: string | null } | null {
    const s = this.el === this.sc ? this.sc.sound : null;
    if (!s || this.track?.kind === 'track') return null;
    return { title: s.title, artist: s.user?.username || '', cover: s.artwork_url ? s.artwork_url.replace('-large.', '-t500x500.') : null };
  }

  // ------------------------------------------------------------ Web Audio
  // On phones audio skips Web Audio: iOS and Android silence it when the screen locks.
  get mobile(): boolean { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); }
  // No graph on phones, nor in the phone-only version: there is no same-origin audio proxy,
  // and Web Audio would silence streams from other sites.
  get noGraph(): boolean { return this.mobile || STANDALONE; }

  ensureGraph(): void {
    if (this.noGraph) return;
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const src = ctx.createMediaElementSource(this.fx);
    let node: AudioNode = src;
    this.filters = EQ_FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      node.connect(b);
      node = b;
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.78;
    node.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.applyEq();
  }

  setEq(patch: Partial<Eq>): void {
    this.eq = { ...this.eq, ...patch };
    LS.set('eq', this.eq);
    this.applyEq();
    this.emit('eq');
  }

  applyEq(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.filters.forEach((f, i) => {
      const g = this.eq.enabled ? (this.eq.gains[i] || 0) : 0;
      f.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
    });
  }

  // Whether the current audio goes through the analyser (the radio fallback doesn't).
  get analysing(): boolean { return Boolean(this.analyser) && this.el === this.fx; }

  // ------------------------------------------------------------ play queue
  playList(tracks: Track[], start = 0, { shuffle = this.shuffle, context = null }: { shuffle?: boolean; context?: Context | null } = {}): void {
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
  resumeAt(queue: Track[], index: number, time: number, context: Context | null): void {
    if (!queue?.length) return;
    this.queue = queue.slice();
    this.unshuffled = queue.slice();
    this.context = context || null;
    this.pendingSeek = time > 1 ? time : 0;
    this.load(Math.min(Math.max(0, index), queue.length - 1), true);
    this.emit('queue');
  }

  playNext(tracks: Track | Track[]): void {
    const list = ([] as Track[]).concat(tracks);
    if (!this.track) { this.playList(list, 0, { shuffle: false }); return; }
    this.queue.splice(this.index + 1, 0, ...list);
    this.unshuffled?.push(...list);
    this.emit('queue');
  }

  addToQueue(tracks: Track | Track[]): void {
    const list = ([] as Track[]).concat(tracks);
    if (!this.track) { this.playList(list, 0, { shuffle: false }); return; }
    this.queue.push(...list);
    this.unshuffled?.push(...list);
    this.emit('queue');
  }

  removeAt(i: number): void {
    if (i === this.index) return;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    this.emit('queue');
    this.persist();
  }

  move(from: number, to: number): void {
    if (from === to) return;
    const [t] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, t);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this.emit('queue');
    this.persist();
  }

  clearUpcoming(): void {
    this.queue.splice(this.index + 1);
    this.emit('queue');
    this.persist();
  }

  jump(i: number): void { if (this.queue[i]) this.load(i, true); }

  toggleShuffle(): void {
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

  cycleRepeat(): void {
    this.repeat = ({ off: 'all', all: 'one', one: 'off' } as const)[this.repeat];
    LS.set('repeat', this.repeat);
    this.emit('mode');
  }

  // ------------------------------------------------------------ playback
  load(i: number, autoplay: boolean): void {
    this.index = i;
    const t = this.track;
    if (!t) return;
    this.listened = 0;
    this.logged = false;
    this.scrobbled = false;
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
      this.sc.load(t.link || t.stream || '', { autoplay, at });
      this.updateMediaSession();
      this.emit('track', t);
      this.emit('state');
      this.persist();
      return;
    }
    this.sc.unload();
    const start = (src: string, isCopy: boolean) => {
      this.offlineSrc = isCopy;
      this.fx.src = src;
      if (at) this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = at; this.lastT = at; this.emit('time'); }, { once: true });
      if (autoplay) this.fx.play().catch((e: Error) => { if (e.name !== 'AbortError') this.emit('error', tr('Playback was blocked: press Play.')); });
    };
    if (autoplay) this.ensureGraph();
    // Play the downloaded copy when there is one. Songs in the prefetch window already
    // have an object URL; others need a quick IndexedDB read first.
    const copy = t.live ? null : offline.url(t.id);
    if (copy || t.live || !offline.isCached(t.id)) start(copy || media(t.stream), Boolean(copy));
    else {
      this.fx.pause();
      offline.get(t.id).then((url) => { if (seq === this.loadSeq) start(url || media(t.stream), Boolean(url)); });
    }
    if (autoplay && !t.live) api('/api/nowplaying', { method: 'POST', body: { track: t } }).catch(() => {});
    this.updateMediaSession();
    this.emit('track', t);
    this.emit('state');
    this.persist();
  }

  toggle(): void {
    const t = this.track;
    if (!t) {
      const pool = store.smart('mix');
      if (pool.length) this.playList(pool, 0, { context: { label: tr('My mix'), href: '/smart/mix' } });
      return;
    }
    if (this.el.paused) {
      this.ensureGraph();
      // After a pause radio restarts, so it doesn't play a stale buffer.
      if (t.live && this.el === this.fx) this.fx.src = media(t.stream);
      this.el.play().catch(() => {});
    } else this.el.pause();
  }

  play(): void { if (this.el.paused) this.toggle(); }
  pause(): void { this.el.pause(); }

  next(auto = false): void {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) { this.load(this.index + 1, true); return; }
    if (this.repeat === 'all' || !auto) {
      if (this.repeat === 'all') {
        if (this.shuffle) this.queue = shuffleArray(this.queue);
        this.load(0, true);
        return;
      }
    }
    this.el.pause();
    this.emit('state');
  }

  prev(): void {
    if (this.time > 3 && !this.track?.live) { this.seek(0); return; }
    if (this.index > 0) this.load(this.index - 1, true);
    else if (this.repeat === 'all' && this.queue.length) this.load(this.queue.length - 1, true);
    else this.seek(0);
  }

  seek(t: number): void {
    if (!this.track || this.track.live) return;
    const d = this.duration;
    this.el.currentTime = Math.max(0, Math.min(t, Number.isFinite(d) ? d - 0.25 : t));
    this.lastT = this.el.currentTime;
    this.emit('time');
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.muted = this.volume === 0 ? this.muted : false;
    this.fx.volume = this.plain.volume = this.sc.volume = this.volume;
    this.fx.muted = this.plain.muted = this.sc.muted = this.muted;
    LS.set('volume', this.volume);
    this.emit('volume');
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.fx.muted = this.plain.muted = this.sc.muted = this.muted;
    this.emit('volume');
  }

  // ------------------------------------------------------------ events
  onTime(el: MediaEl): void {
    if (el !== this.el) return;
    const t = el.currentTime;
    const d = t - this.lastT;
    if (d > 0 && d < 2 && !el.paused) this.listened += d;
    this.lastT = t;
    const track = this.track;
    // History: everything that really started playing (sound for a moment, not a failed load).
    if (track && !this.logged && this.listened > 0.5) {
      this.logged = true;
      this.startedAt = Date.now() - this.listened * 1000;
      store.logPlay(track, this.startedAt).catch(() => {});
    }
    // ListenBrainz has its own rule: half the song or 4 minutes (not radio).
    if (track && this.logged && !this.scrobbled && !track.live) {
      const dur = this.duration;
      if (dur > 30 && this.listened >= Math.min(dur / 2, 240)) { this.scrobbled = true; store.scrobble(track, this.startedAt).catch(() => {}); }
    }
    if (this.sleep?.mode === 'time' && Date.now() >= this.sleep.until) this.fadeOutAndStop();
    const now = Date.now();
    if (!this.lastPersist || now - this.lastPersist > 5000) { this.lastPersist = now; this.persist(); this.updatePosition(); }
    this.emit('time');
  }

  onEnded(el: MediaEl): void {
    if (el !== this.el) return;
    if (this.sleep?.mode === 'end') { this.clearSleep(); this.emit('state'); return; }
    if (this.repeat === 'one') { this.seek(0); this.el.play(); return; }
    this.next(true);
  }

  onError(el: MediaEl): void {
    if (el !== this.el || !el.getAttribute('src')) return;
    const t = this.track;
    if (!t) return;
    if (el === this.fx && !t.live) {
      // The downloaded copy itself is broken: drop it and stream instead.
      if (this.offlineSrc) {
        this.offlineSrc = false;
        offline.remove(t.id);
        this.switchSrc(t.stream || '');
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
      const direct = STANDALONE ? null : new URL(t.stream || '', location.href).searchParams.get('u');
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

  failTrack(t: Track): void {
    this.errors++;
    this.emit('error', t.live ? tr('Station “{title}” isn\'t broadcasting right now.', { title: t.title }) : tr('“{title}” can\'t be played.', { title: t.title }));
    if (!t.live && this.errors < 3 && this.index < this.queue.length - 1) setTimeout(() => this.next(true), 1200);
    this.emit('state');
  }

  // ------------------------------------------------------------ offline buffer
  schedulePrefetch(): void {
    clearTimeout(this.prefetchTimer);
    // Short delay so the stream that just started gets the bandwidth first.
    this.prefetchTimer = setTimeout(() => offline.prefetch(this.queue, this.index), 1500);
  }

  // Switch to the downloaded copy after 8 s of stalling while the browser reports
  // offline, or after 15 s even when it says "online": phones on mobile data often
  // stay "online" while the connection to the home computer is gone.
  armStall(elapsed = 0): void {
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

  clearStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = 0;
  }

  // Loads src into fx and resumes at the last known position.
  switchSrc(src: string): void {
    const at = this.fx.currentTime || this.lastT || 0;
    this.fx.src = src;
    if (at) this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = at; this.lastT = at; this.emit('time'); }, { once: true });
    this.fx.play().catch(() => {});
    this.emit('state');
  }

  // Switches the current song to its downloaded copy. Resolves false if there is none.
  async useOfflineCopy(): Promise<boolean> {
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
  setSleep(minutes: number | 'end' | null): void {
    if (!minutes) { this.clearSleep(); return; }
    this.sleep = minutes === 'end' ? { mode: 'end' } : { mode: 'time', until: Date.now() + minutes * 60000, minutes };
    this.emit('sleep');
  }

  clearSleep(): void { this.sleep = null; this.emit('sleep'); }

  fadeOutAndStop(): void {
    if (this.fading) return;
    this.fading = true;
    const start = this.el.volume;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      this.el.volume = Math.max(0, start * (1 - step / 40));
      if (step >= 40) {
        clearInterval(iv);
        this.el.pause();
        this.el.volume = this.volume;
        this.fading = false;
        this.clearSleep();
      }
    }, 250);
  }

  // ------------------------------------------------------------ Media Session
  setupMediaSession(): void {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.prev());
    set('seekto', (e) => this.seek(e.seekTime || 0));
    // iOS shows either ±15 s or previous/next on the lock screen and in CarPlay, and picks the
    // skip buttons whenever they are offered. Songs matter more than 15 seconds, so iPhones drop them.
    const skip = !IS_IOS;
    set('seekbackward', skip ? (e) => this.seek(this.time - (e.seekOffset || 10)) : null);
    set('seekforward', skip ? (e) => this.seek(this.time + (e.seekOffset || 10)) : null);
  }

  updateMediaSession(): void {
    const ms = navigator.mediaSession;
    const t = this.track;
    if (!ms || !t) return;
    const sc = this.scSound;
    const coverUrl = sc?.cover || t.cover;
    const art = coverUrl ? [{ src: new URL(media(coverUrl), location.href).href, sizes: '512x512' }] : [];
    ms.metadata = new MediaMetadata({
      title: sc?.title || this.icyTitle || t.title,
      artist: sc ? sc.artist : this.icyTitle ? t.title : t.artist || '',
      album: t.album || '',
      artwork: art,
    });
  }

  updatePosition(): void {
    const d = this.duration;
    if (!navigator.mediaSession?.setPositionState || !Number.isFinite(d) || d <= 0) return;
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(this.time, d), playbackRate: 1 }); } catch { /* */ }
  }

  setIcy(sid: string, title: string): void {
    const t = this.track;
    if (!t?.live || !(t.stream || '').includes('sid=' + encodeURIComponent(sid))) return;
    this.icyTitle = title || null;
    this.updateMediaSession();
    this.emit('icy', title);
  }

  // ------------------------------------------------------------ saving the queue
  persist(): void {
    LS.set('queue', { queue: this.queue.slice(0, 2000), index: this.index, time: this.track?.live ? 0 : this.time, context: this.context });
  }

  restore(): void {
    const s = LS.get<{ queue?: Track[]; index: number; time?: number; context?: Context | null } | null>('queue', null);
    if (!s?.queue?.length) return;
    this.queue = s.queue;
    this.index = Math.min(s.index, s.queue.length - 1);
    this.context = s.context || null;
    const t = this.track;
    if (!t) return;
    const time = s.time || 0;
    if (t.source === 'soundcloud') {
      this.el = this.sc;
      // Wait for the app to give the widget its dock.
      queueMicrotask(() => this.sc.load(t.link || t.stream || '', { autoplay: false, at: time }));
    } else if (!t.live) { // radio isn't preloaded: toggle() starts it only on Play
      this.fx.src = media(t.stream);
      this.restoreCopy(t, time);
    }
    if (time && !t.live && t.source !== 'soundcloud') this.seekOnLoad(time);
    this.listened = 0;
    this.logged = false;
    this.scrobbled = false;
    this.lastT = 0;
    queueMicrotask(() => { this.updateMediaSession(); this.emit('track', t); this.emit('queue'); });
  }

  // The restored song has a downloaded copy: Play uses it, so the app opened without a
  // connection plays right away (and with one, it saves the download).
  private restoreCopy(t: Track, time: number): void {
    const seq = this.loadSeq;
    void offline.get(t.id).then((url) => {
      if (!url || seq !== this.loadSeq || this.el !== this.fx || !this.fx.paused || this.offlineSrc) return;
      const at = this.fx.currentTime || time;
      this.offlineSrc = true;
      this.fx.src = url;
      if (at) this.seekOnLoad(at);
    });
  }

  private seekOnLoad(at: number): void {
    this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = at; this.lastT = at; this.emit('time'); }, { once: true });
  }
}

const versions: Partial<Record<PlayerEvent, number>> = {};
const listeners = new Set<() => void>();

export type { Player };
export const player = new Player();

// Re-renders the component when any of the given player events fire.
export function usePlayer(...types: PlayerEvent[]): Player {
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => types.map((t) => versions[t] || 0).join(','),
  );
  return player;
}

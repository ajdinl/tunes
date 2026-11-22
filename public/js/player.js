// Player: red za puštanje, nasumično/ponavljanje, ekvalizer, analizator
// spektra, istorija, Media Session (tasteri na tastaturi i kontrolni centar).
import { store, api } from './store.js';
import { shuffleArray, tr } from './ui.js';

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  Ravno: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bas: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Vokal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Rok: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  Elektronika: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  Akustika: [3, 2, 1, 1, 2, 2, 3, 2, 2, 1],
  'Tiho noću': [-3, -2, 0, 1, 2, 2, 1, 0, -2, -4],
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem('sl.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sl.' + k, JSON.stringify(v)); } catch { /* pun disk */ } },
};

class Player extends EventTarget {
  constructor() {
    super();
    this.fx = new Audio();     // ide kroz ekvalizer i analizator
    this.plain = new Audio();  // rezerva za stanice koje ne rade preko proxy-ja
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
    this.eq = LS.get('eq', { enabled: false, preset: 'Ravno', gains: EQ_PRESETS.Ravno.slice() });

    for (const el of [this.fx, this.plain]) {
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
  // Na telefonima zvuk ne ide kroz Web Audio: iOS i Android ga gase kad se ekran zaključa.
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

  // Da li trenutni zvuk prolazi kroz analizator (radio rezerva ne prolazi).
  get analysing() { return Boolean(this.analyser) && this.el === this.fx; }

  // ------------------------------------------------------------ red za puštanje
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

  // ------------------------------------------------------------ puštanje
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
    this.fx.src = t.stream;
    if (autoplay) {
      this.ensureGraph();
      this.fx.play().catch((e) => { if (e.name !== 'AbortError') this.emit('error', tr('Puštanje je blokirano: klikni Play.')); });
      if (!t.live) api('/api/nowplaying', { method: 'POST', body: { track: t } }).catch(() => {});
    }
    this.updateMediaSession();
    this.emit('track', t);
    this.emit('state');
    this.persist();
  }

  toggle() {
    if (!this.track) {
      const pool = store.smart('miks');
      if (pool.length) this.playList(pool, 0, { context: { label: 'Moj miks', href: '#/pametna/miks' } });
      return;
    }
    if (this.el.paused) {
      this.ensureGraph();
      // Radio posle pauze kreće ispočetka, da ne svira zastareli bafer.
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
    this.fx.volume = this.plain.volume = this.volume;
    this.fx.muted = this.plain.muted = this.muted;
    LS.set('volume', this.volume);
    this.emit('volume');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.fx.muted = this.plain.muted = this.muted;
    this.emit('volume');
  }

  // ------------------------------------------------------------ događaji
  onTime(el) {
    if (el !== this.el) return;
    const t = el.currentTime;
    const d = t - this.lastT;
    if (d > 0 && d < 2 && !el.paused) this.listened += d;
    this.lastT = t;
    const track = this.track;
    // Pravilo kao kod ListenBrainz-a: pola pesme ili 4 minuta.
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
    // Neke radio stanice ne rade preko proxy-ja: puštamo ih direktno (bez ekvalizera).
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
    this.errors++;
    this.emit('error', t.live ? tr('Stanica „{title}” trenutno ne emituje.', { title: t.title }) : tr('„{title}” ne može da se pusti.', { title: t.title }));
    if (!t.live && this.errors < 3 && this.index < this.queue.length - 1) setTimeout(() => this.next(true), 1200);
    this.emit('state');
  }

  // ------------------------------------------------------------ tajmer za spavanje
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
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* nepodržano */ } };
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
    const art = t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: '512x512' }] : [];
    ms.metadata = new MediaMetadata({
      title: this.icyTitle || t.title,
      artist: this.icyTitle ? t.title : t.artist || '',
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

  // ------------------------------------------------------------ čuvanje reda
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
    // Radio se ne učitava unapred: toggle() ga pokreće tek na Play.
    if (!t.live) this.fx.src = t.stream;
    if (s.time && !t.live) {
      this.fx.addEventListener('loadedmetadata', () => { this.fx.currentTime = s.time; this.lastT = s.time; this.emit('time'); }, { once: true });
    }
    this.listened = 0;
    this.logged = false;
    this.lastT = 0;
    queueMicrotask(() => { this.updateMediaSession(); this.emit('track', t); this.emit('queue'); });
  }
}

export const player = new Player();

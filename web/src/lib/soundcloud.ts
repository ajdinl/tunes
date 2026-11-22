// SoundCloud through its official embedded player (Widget API). The class looks like an
// <audio> element (play, pause, currentTime, volume, the same events), so the player can
// switch to it the same way it switches between its own audio elements.
// The embedded player stays visible in a small dock: SoundCloud requires it, and on
// iPhones the first Play sometimes has to be tapped inside it.

const API = 'https://w.soundcloud.com/player/api.js';

export interface ScSound { id: number; title: string; duration: number; user?: { username?: string }; artwork_url?: string | null }

interface ScWidget {
  bind(event: string, fn: (e?: any) => void): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(v: number): void;
  getDuration(cb: (ms: number) => void): void;
  getCurrentSound(cb: (s: ScSound | null) => void): void;
  getSounds(cb: (list: ScSound[]) => void): void;
  getCurrentSoundIndex(cb: (i: number) => void): void;
  load(url: string, opts: Record<string, unknown>): void;
}
type ScEvents = Record<'READY' | 'PLAY' | 'PAUSE' | 'PLAY_PROGRESS' | 'FINISH' | 'ERROR', string>;
interface ScApi { Widget: ((frame: HTMLIFrameElement) => ScWidget) & { Events: ScEvents } }

declare global { interface Window { SC?: ScApi } }

let apiPromise: Promise<ScApi> | null = null;

function loadApi(): Promise<ScApi> {
  if (window.SC?.Widget) return Promise.resolve(window.SC);
  apiPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = API;
    s.async = true;
    s.onload = () => (window.SC?.Widget ? resolve(window.SC) : reject(new Error('SoundCloud player could not be loaded')));
    s.onerror = () => { apiPromise = null; s.remove(); reject(new Error('SoundCloud player could not be loaded')); };
    document.head.append(s);
  });
  return apiPromise;
}

const OPTIONS = {
  visual: false, show_comments: false, hide_related: true, show_reposts: false, show_teaser: false,
  show_user: true, buying: false, sharing: false, download: false, single_active: true, color: '#ffb547',
};
const widgetSrc = (url: string, autoplay: boolean) => 'https://w.soundcloud.com/player/?' + new URLSearchParams({
  url, auto_play: String(Boolean(autoplay)), ...Object.fromEntries(Object.entries(OPTIONS).map(([k, v]) => [k, String(v)])),
});

export class SoundCloudElement extends EventTarget {
  paused = true;
  ended = false;
  readyState = 0;
  duration = NaN;
  url = '';
  sound: ScSound | null = null;   // what SoundCloud says is playing
  frame: HTMLIFrameElement | null = null;
  widget: ScWidget | null = null;
  host: HTMLElement | null = null; // element the iframe lives in (set by the app)
  errorMessage = '';
  error: null = null;
  private _time = 0;
  private _volume = 1;
  private _muted = false;
  private _seq = 0;
  private _at = 0;
  private _autoplay = false;
  private _blockTimer: ReturnType<typeof setTimeout> | undefined;

  fire(type: string, detail?: unknown): void { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ---- the <audio>-like surface the player uses
  getAttribute(name: string): string | null { return name === 'src' && this.url ? this.url : null; }
  removeAttribute(): void { this.unload(); }

  get currentTime(): number { return this._time; }
  set currentTime(t: number) {
    this._time = Math.max(0, Number(t) || 0);
    if (this.readyState) this.widget?.seekTo(this._time * 1000);
    else this._at = this._time;
    this.fire('timeupdate');
  }

  get volume(): number { return this._volume; }
  set volume(v: number) { this._volume = Math.max(0, Math.min(1, v)); this.applyVolume(); }
  get muted(): boolean { return this._muted; }
  set muted(m: boolean) { this._muted = Boolean(m); this.applyVolume(); }
  applyVolume(): void { if (this.readyState) this.widget?.setVolume(this._muted ? 0 : Math.round(this._volume * 100)); }

  play(): Promise<void> {
    if (!this.url) return Promise.resolve();
    this.ended = false;
    if (this.readyState) this.widget!.play();
    else this._autoplay = true;
    // iPhone (and some browsers) only start embedded audio after a tap inside the player.
    clearTimeout(this._blockTimer);
    this._blockTimer = setTimeout(() => { if (this.paused && this.url) this.fire('blocked'); }, 4000);
    return Promise.resolve();
  }

  pause(): void {
    this._autoplay = false;
    clearTimeout(this._blockTimer);
    if (this.readyState) this.widget?.pause();
  }

  // ---- loading
  async load(url: string, { autoplay = false, at = 0 } = {}): Promise<void> {
    const seq = ++this._seq;
    this.url = url;
    this.sound = null;
    this.readyState = 0;
    this.duration = NaN;
    this._time = at || 0;
    this._at = at || 0;
    this._autoplay = autoplay;
    this.ended = false;
    this.fire('emptied');
    let SC: ScApi;
    try { SC = await loadApi(); } catch (e) { if (seq === this._seq) this.fail((e as Error).message); return; }
    if (seq !== this._seq) return;
    if (!this.frame) {
      this.frame = document.createElement('iframe');
      this.frame.title = 'SoundCloud';
      this.frame.allow = 'autoplay; encrypted-media';
      this.frame.setAttribute('scrolling', 'no');
      this.frame.className = 'scdock__frame';
      this.frame.src = widgetSrc(url, autoplay);
      (this.host || document.body).append(this.frame);
      this.widget = SC.Widget(this.frame);
      this.bind(SC.Widget.Events);
      // The first READY event comes from the iframe itself.
      this.widget.bind(SC.Widget.Events.READY, () => { if (seq === this._seq) this.ready(seq); });
    } else {
      this.widget!.load(url, { ...OPTIONS, auto_play: Boolean(autoplay), callback: () => this.ready(this._seq) });
    }
  }

  ready(seq: number): void {
    if (seq !== this._seq || !this.widget) return;
    const w = this.widget;
    this.readyState = 4;
    this.applyVolume();
    w.getDuration((ms) => {
      if (seq !== this._seq) return;
      this.duration = ms > 0 ? ms / 1000 : NaN;
      this.fire('durationchange');
      this.fire('loadedmetadata');
      if (this._at) { w.seekTo(this._at * 1000); this._at = 0; }
    });
    this.refreshSound();
    if (this._autoplay) w.play();
  }

  bind(E: ScEvents): void {
    const w = this.widget!;
    w.bind(E.PLAY, () => {
      clearTimeout(this._blockTimer);
      this.paused = false;
      this.ended = false;
      this.fire('play');
      this.fire('playing');
      this.refreshSound();
    });
    w.bind(E.PAUSE, () => { this.paused = true; this.fire('pause'); });
    w.bind(E.PLAY_PROGRESS, (e: { currentPosition?: number }) => {
      if (!this.readyState) return;
      this._time = (e.currentPosition || 0) / 1000;
      this.fire('timeupdate');
    });
    w.bind(E.FINISH, () => {
      // Sets and artist pages play on inside the widget; only the last song ends the item.
      w.getSounds((list) => w.getCurrentSoundIndex((i) => {
        if (Array.isArray(list) && list.length > 1 && i < list.length - 1) return;
        this.paused = true;
        this.ended = true;
        this.fire('pause');
        this.fire('ended');
      }));
    });
    w.bind(E.ERROR, () => this.fail('SoundCloud could not play this link'));
  }

  // The current song inside a set changes the title, artist and artwork shown in Tunes.
  refreshSound(): void {
    const seq = this._seq;
    this.widget?.getCurrentSound((s) => {
      if (seq !== this._seq || !s) return;
      const changed = s.id !== this.sound?.id;
      this.sound = s;
      if (s.duration > 0 && (changed || !(this.duration > 0))) { this.duration = s.duration / 1000; this.fire('durationchange'); }
      if (changed) this.fire('sound', s);
    });
  }

  fail(message: string): void {
    this.paused = true;
    this.errorMessage = message;
    this.fire('error', message);
  }

  unload(): void {
    if (!this.url) return;
    this._seq++;
    this.url = '';
    this.sound = null;
    this.readyState = 0;
    this.paused = true;
    clearTimeout(this._blockTimer);
    try { this.widget?.pause(); } catch { /* iframe gone */ }
    this.fire('emptied');
  }
}

// Finds a SoundCloud address in pasted text (share messages contain extra words).
export function findSoundCloudUrl(text: unknown): string | null {
  const m = /https?:\/\/(?:www\.|m\.|on\.)?(?:soundcloud\.com|snd\.sc)\/[^\s"'<>]+/i.exec(String(text || ''));
  return m ? m[0] : null;
}

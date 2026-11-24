// Mixcloud through its official embedded player (Widget API). Like SoundCloudElement, the
// class looks like an <audio> element (play, pause, currentTime, volume, the same events),
// so the player switches to it the same way it switches between its own audio elements.
// The embedded player stays visible in the dock, and on iPhones the first Play may have to
// be tapped inside it.

const API = 'https://widget.mixcloud.com/media/js/widgetApi.js';
const WIDGET = 'https://player-widget.mixcloud.com/widget/iframe/';

// The documented surface of Mixcloud.PlayerWidget(iframe). Methods answer with promises.
interface McWidget {
  ready: Promise<unknown>;
  events: Record<'progress' | 'buffering' | 'play' | 'pause' | 'ended' | 'error', { on(fn: (...args: any[]) => void): void }>;
  load(key: string, startPlaying: boolean): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<boolean>;
  setVolume(v: number): Promise<void>;
  getIsPaused(): Promise<boolean>;
}

declare global { interface Window { Mixcloud?: { PlayerWidget(frame: HTMLIFrameElement): McWidget } } }

let apiPromise: Promise<NonNullable<Window['Mixcloud']>> | null = null;

function loadApi(): Promise<NonNullable<Window['Mixcloud']>> {
  if (window.Mixcloud?.PlayerWidget) return Promise.resolve(window.Mixcloud);
  apiPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = API;
    s.async = true;
    s.onload = () => (window.Mixcloud?.PlayerWidget ? resolve(window.Mixcloud) : reject(new Error('Mixcloud player could not be loaded')));
    s.onerror = () => { apiPromise = null; s.remove(); reject(new Error('Mixcloud player could not be loaded')); };
    document.head.append(s);
  });
  return apiPromise;
}

// The show's key ('/user/show/') from its address on www.mixcloud.com.
export const mixcloudKey = (url: string): string => {
  try { return new URL(url).pathname; } catch { return ''; }
};

const widgetSrc = (key: string, autoplay: boolean) => WIDGET + '?' + new URLSearchParams({
  feed: key, mini: '1', hide_cover: '1', hide_artwork: '1', autoplay: autoplay ? '1' : '0',
  ...(document.documentElement.dataset.theme === 'light' ? { light: '1' } : {}),
});

export class MixcloudElement extends EventTarget {
  paused = true;
  ended = false;
  readyState = 0;
  duration = NaN;
  url = '';
  frame: HTMLIFrameElement | null = null;
  widget: McWidget | null = null;
  host: HTMLElement | null = null; // element the iframe lives in (set by the app)
  error: null = null;
  private _time = 0;
  private _volume = 1;
  private _muted = false;
  private _seq = 0;
  private _at = 0;           // where to start once the show plays (restored position)
  private _blockTimer: ReturnType<typeof setTimeout> | undefined;

  fire(type: string, detail?: unknown): void { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ---- the <audio>-like surface the player uses
  getAttribute(name: string): string | null { return name === 'src' && this.url ? this.url : null; }
  removeAttribute(): void { this.unload(); }

  get currentTime(): number { return this._time; }
  set currentTime(t: number) {
    this._time = Math.max(0, Number(t) || 0);
    if (this.readyState && !this.paused) void this.widget?.seek(this._time);
    else this._at = this._time;
    this.fire('timeupdate');
  }

  get volume(): number { return this._volume; }
  set volume(v: number) { this._volume = Math.max(0, Math.min(1, v)); this.applyVolume(); }
  get muted(): boolean { return this._muted; }
  set muted(m: boolean) { this._muted = Boolean(m); this.applyVolume(); }
  applyVolume(): void { if (this.readyState) void this.widget?.setVolume(this._muted ? 0 : this._volume); }

  play(): Promise<void> {
    if (!this.url) return Promise.resolve();
    this.ended = false;
    if (this.readyState) void this.widget!.play();
    // iPhone (and some browsers) only start embedded audio after a tap inside the player.
    clearTimeout(this._blockTimer);
    this._blockTimer = setTimeout(() => { if (this.paused && this.url) this.fire('blocked'); }, 4000);
    return Promise.resolve();
  }

  pause(): void {
    clearTimeout(this._blockTimer);
    if (this.readyState) void this.widget?.pause();
  }

  // ---- loading
  async load(url: string, { autoplay = false, at = 0 } = {}): Promise<void> {
    const seq = ++this._seq;
    const key = mixcloudKey(url);
    this.url = url;
    this.readyState = 0;
    this.duration = NaN;
    this.paused = true;
    this.ended = false;
    this._time = at || 0;
    this._at = at || 0;
    this.fire('emptied');
    let api: NonNullable<Window['Mixcloud']>;
    try { api = await loadApi(); } catch (e) { if (seq === this._seq) this.fail((e as Error).message); return; }
    if (seq !== this._seq) return;
    if (!this.frame) {
      this.frame = document.createElement('iframe');
      this.frame.title = 'Mixcloud';
      this.frame.allow = 'autoplay; encrypted-media';
      this.frame.className = 'scdock__frame';
      this.frame.src = widgetSrc(key, autoplay);
      (this.host || document.body).append(this.frame);
      const widget = api.PlayerWidget(this.frame);
      this.widget = widget;
      await widget.ready;
      this.bind(widget);
      // Autoplay may have started the show before the events were bound.
      if (!(await widget.getIsPaused()) && seq === this._seq) this.started(widget);
    } else {
      // Reusing the widget keeps the permission to play that a tap inside it gave.
      await this.widget!.load(key, autoplay);
    }
    if (seq !== this._seq) return;
    this.readyState = 4;
    this.applyVolume();
    this.fire('loadedmetadata');
    if (autoplay) this.play();
  }

  bind(w: McWidget): void {
    w.events.play.on(() => this.started(w));
    w.events.pause.on(() => { this.paused = true; this.fire('pause'); });
    w.events.buffering.on(() => this.fire('waiting'));
    w.events.progress.on((position: number, duration: number) => {
      if (!this.readyState) return;
      this._time = Number(position) || 0;
      if (duration > 0 && duration !== this.duration) { this.duration = duration; this.fire('durationchange'); }
      this.fire('timeupdate');
    });
    w.events.ended.on(() => {
      this.paused = true;
      this.ended = true;
      this.fire('pause');
      this.fire('ended');
    });
    w.events.error.on(() => this.fail('Mixcloud could not play this show'));
  }

  started(w: McWidget): void {
    if (!this.url || !this.paused) return;
    clearTimeout(this._blockTimer);
    this.paused = false;
    this.ended = false;
    if (this._at) { void w.seek(this._at); this._at = 0; }
    this.fire('play');
    this.fire('playing');
  }

  fail(message: string): void {
    this.paused = true;
    this.fire('error', message);
  }

  unload(): void {
    if (!this.url) return;
    this._seq++;
    this.url = '';
    this.readyState = 0;
    this.paused = true;
    clearTimeout(this._blockTimer);
    try { void this.widget?.pause(); } catch { /* iframe gone */ }
    this.fire('emptied');
  }
}

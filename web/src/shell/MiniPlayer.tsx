// Mini player: a small always-on-top window (Document Picture-in-Picture) with the cover,
// the song and the basic controls, so Tunes stays at hand while you work in other apps.
// Chrome, Edge and Brave on computers support it. Safari gets a picture-in-picture video
// instead (MiniVideo.ts); where neither exists (phones, Firefox) the button is hidden.
// The window is a React portal: the same player and state, rendered into its document.
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../components/Icon.tsx';
import { Cover } from '../components/common.tsx';
import { shownTrack } from './Deck.tsx';
import { player, usePlayer } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import { tr } from '../lib/i18n.ts';
import { fmtTime, cx } from '../lib/format.ts';
import { toggleFav } from '../lib/actions.ts';
import { videoPipSupported, videoMiniOpen, onVideoMiniChange, prepareVideoMini, openVideoMini, closeVideoMini } from './MiniVideo.ts';

interface PipApi { requestWindow(opts: { width: number; height: number }): Promise<Window> }
const pip = (): PipApi | undefined => (window as Window & { documentPictureInPicture?: PipApi }).documentPictureInPicture;

export const miniSupported = (): boolean => (Boolean(pip()) && !player.mobile) || videoPipSupported();

// Safari's video needs to exist before the click (see MiniVideo.ts).
export function prepareMini(): void {
  if (!pip()) prepareVideoMini();
}

let win: Window | null = null;
const listeners = new Set<() => void>();
function setWin(w: Window | null): void {
  win = w;
  for (const l of listeners) l();
}
export function useMiniWindow(): Window | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => win);
}

// Either kind of mini player is open.
export function useMiniOpen(): boolean {
  const w = useMiniWindow();
  return useSyncExternalStore(onVideoMiniChange, videoMiniOpen) || Boolean(w);
}

// The window gets the app's styles, theme and language, so it looks like the rest of Tunes.
function dress(w: Window): void {
  const d = w.document;
  d.title = 'Tunes';
  d.documentElement.lang = document.documentElement.lang;
  d.documentElement.dataset.theme = document.documentElement.dataset.theme || 'black';
  // The rules themselves go into a <style>: nothing to download, no unstyled flash, and it
  // works in a fresh window where a <link> may not load. Relative url()s (fonts) are made
  // absolute against the sheet they came from.
  const css: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    try {
      const base = sheet.href || location.href;
      for (const rule of [...sheet.cssRules]) {
        css.push(rule.cssText.replace(/url\((['"]?)(?!data:|https?:|blob:|\/)([^'")]+)\1\)/g, (_m, q, u) => `url(${q}${new URL(u, base).href}${q})`));
      }
    } catch {
      // A sheet the page may not read: link it instead.
      if (sheet.href) { const link = d.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; d.head.append(link); }
    }
  }
  const style = d.createElement('style');
  style.textContent = css.join('\n');
  d.head.append(style);
  d.body.className = 'mini-body';
}

export async function toggleMini(): Promise<void> {
  if (win) { win.close(); return; }
  if (videoMiniOpen()) { closeVideoMini(); return; }
  const api = pip();
  if (!api) { openVideoMini(); return; }
  const w = await api.requestWindow({ width: 380, height: 124 });
  dress(w);
  w.addEventListener('pagehide', () => setWin(null));
  setWin(w);
}

export function MiniPlayer() {
  const w = useMiniWindow();
  return w ? createPortal(<MiniContent w={w} />, w.document.body) : null;
}

function MiniContent({ w }: { w: Window }) {
  const p = usePlayer('track', 'state', 'time', 'sound', 'icy');
  useStore('favorites');
  const t = shownTrack(p);
  const fav = Boolean(p.track && store.isFav(p.track.id));
  const dur = p.duration;
  const progress = t && !t.live && Number.isFinite(dur) && dur > 0 ? Math.min(1, p.time / dur) : t?.live ? 1 : 0;

  // Follow the theme and language of the main window.
  useEffect(() => {
    w.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'black';
    w.document.documentElement.lang = document.documentElement.lang;
  });

  // Space, arrows and M also work while the mini window has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const run: Record<string, () => void> = {
        ' ': () => player.toggle(),
        ArrowRight: () => (e.shiftKey ? player.next() : player.seek(player.time + 5)),
        ArrowLeft: () => (e.shiftKey ? player.prev() : player.seek(player.time - 5)),
        m: () => player.toggleMute(),
      };
      const f = run[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (f) { e.preventDefault(); f(); }
    };
    w.document.addEventListener('keydown', onKey);
    return () => w.document.removeEventListener('keydown', onKey);
  }, [w]);

  if (!t) return <div className="mini mini--empty"><p>{tr('Nothing playing')}</p></div>;
  return (
    <div className="mini">
      {/* Absolute URL: the window's own document may resolve relative ones differently. */}
      <Cover src={t.cover ? new URL(t.cover, location.href).href : null} label={t.title} className="mini__cv" />
      <div className="mini__main">
        <div className="mini__meta">
          <span className="mini__title">{t.live && p.icyTitle ? p.icyTitle : t.title}</span>
          <span className="mini__artist">{t.live ? t.title : t.artist || ''}</span>
        </div>
        <div className="mini__ctrls">
          <button type="button" className="ibtn" aria-label={tr('Previous')} title={tr('Previous')} onClick={() => player.prev()}><Icon name="prev" size={18} /></button>
          <button type="button" className="play" aria-label={p.playing ? tr('Pause') : tr('Play')} title={p.playing ? tr('Pause') : tr('Play')} onClick={() => player.toggle()}>
            <Icon name={p.playing ? 'pause' : 'play'} size={18} />
          </button>
          <button type="button" className="ibtn" aria-label={tr('Next')} title={tr('Next')} onClick={() => player.next()}><Icon name="next" size={18} /></button>
          <button type="button" className={cx('ibtn', fav && 'is-on')} aria-label={tr('Favorite')} title={tr('Favorite')} onClick={() => p.track && toggleFav(p.track)}>
            <Icon name={fav ? 'heartFill' : 'heart'} size={17} />
          </button>
          <span className="mini__time">{t.live ? tr('live') : `${fmtTime(p.time)} / ${fmtTime(dur)}`}</span>
        </div>
      </div>
      {/* A plain bar instead of the canvas dial: it keeps moving while the main window is hidden. */}
      <div className="mini__bar" role="slider" tabIndex={0} aria-label={tr('Position in song')} aria-valuemin={0}
        aria-valuemax={Math.round(dur || 0)} aria-valuenow={Math.round(p.time)}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); player.seek(((e.clientX - r.left) / r.width) * player.duration); }}>
        <span className="mini__fill" style={{ width: (progress * 100).toFixed(2) + '%' }} />
      </div>
    </div>
  );
}

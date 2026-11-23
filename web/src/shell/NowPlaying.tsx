// "Now Playing" full screen: big cover, lyrics, the big dial and controls. On phones it is
// where all the player's controls live (the bar at the bottom is compact there).
import { useEffect, useRef } from 'react';

import { Icon, IconButton } from '../components/Icon.tsx';
import { Cover } from '../components/common.tsx';
import { Lyrics } from '../components/Lyrics.tsx';
import { DialView } from './DialView.tsx';
import { shownTrack, SleepButton } from './Deck.tsx';
import { Queue } from './Panel.tsx';
import { shell, useShell, nowHasSide } from './ui.ts';
import { player, usePlayer } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import { tr } from '../lib/i18n.ts';
import { fmtTime, norm, cx } from '../lib/format.ts';
import { stationFreq } from '../lib/dial.ts';
import { toggleFav, artistHref } from '../lib/actions.ts';
import { toPath } from '../lib/router.ts';
import { media } from '../lib/media.ts';

// The queue button in "Now playing" (and Q while it is open).
export function toggleNowQueue(): void {
  if (nowHasSide()) shell.set({ nowSide: shell.get().nowSide === 'queue' ? 'lyrics' : 'queue' });
  else shell.set({ now: false, panel: 'queue' });
}

export function NowPlaying() {
  const ui = useShell();
  const p = usePlayer('track', 'state', 'time', 'mode', 'icy', 'sound');
  useStore('favorites', 'library');
  const root = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);
  const t = shownTrack(p);
  const open = ui.now && Boolean(t);

  useEffect(() => {
    if (ui.now && !t) shell.set({ now: false });
  }, [ui.now, t]);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    root.current?.querySelector<HTMLElement>('.now__close')?.focus();
    return () => { (lastFocus.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  const close = () => shell.set({ now: false });
  // Tab stays inside the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !root.current) return;
    const f = [...root.current.querySelectorAll<HTMLElement>('a, button, [tabindex="0"]')].filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { f.at(-1)!.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { f[0].focus(); e.preventDefault(); }
  };

  const fav = Boolean(t && store.isFav(t.id));
  const artistLink = Boolean(t && !t.live && store.index.artistMap.has(norm(t.albumArtist || t.artist)));
  return (
    <div ref={root} className="now" id="now" role="dialog" aria-modal="true" aria-label={tr('Now playing')} hidden={!open} onKeyDown={onKeyDown}>
      {open && t && (
        <>
          <div className="now__bg" style={t.cover ? { backgroundImage: `url("${media(t.cover)}")` } : {}} />
          <div className="now__top">
            {p.context ? <p className="now__ctx">{tr('Playing from: ')}<a href={toPath(p.context.href)} onClick={close}>{p.context.label}</a></p> : <span />}
            <IconButton icon="collapse" label={tr('Close (Esc)')} className="now__close" onClick={close} />
          </div>
          <div className="now__body">
            <div className="now__art">
              <Cover src={t.cover} label={t.title} className="now__cv" />
              <div className="now__meta">
                <h2 className="now__title">{t.live && p.icyTitle ? p.icyTitle : t.title}</h2>
                <p className="now__artist">
                  {t.live ? t.title : artistLink ? <a href={artistHref(t.albumArtist || t.artist || '')} onClick={close}>{t.artist}</a> : t.artist || ''}
                  {t.album && !t.live && <span className="now__album">{t.album}</span>}
                </p>
              </div>
            </div>
            {ui.nowSide === 'queue' ? <div className="now__queue"><Queue /></div> : <div className="now__lyrics"><Lyrics big /></div>}
          </div>
          <div className="now__deck">
            <div className="deck__dial">
              <span className="deck__time" data-time="0">{t.live ? tr('live') : fmtTime(p.time)}</span>
              <DialView big />
              <span className="deck__time deck__time--end" data-time="1">{t.live ? stationFreq(t) + ' MHz' : fmtTime(p.duration)}</span>
            </div>
            <div className="deck__ctrls deck__ctrls--big">
              <IconButton icon="shuffle" label={tr('Shuffle')} className={cx(p.shuffle && 'is-on')} onClick={() => player.toggleShuffle()} />
              <IconButton icon="prev" size={24} label={tr('Previous')} onClick={() => player.prev()} />
              <button type="button" className="play play--big" aria-label={p.playing ? tr('Pause') : tr('Play')} onClick={() => player.toggle()}>
                <Icon name={p.playing ? 'pause' : 'play'} size={28} />
              </button>
              <IconButton icon="next" size={24} label={tr('Next')} onClick={() => player.next()} />
              <IconButton icon={p.repeat === 'one' ? 'repeat1' : 'repeat'} className={cx(p.repeat !== 'off' && 'is-on')}
                label={{ off: tr('Repeat off (R)'), all: tr('Repeating the queue (R)'), one: tr('Repeating this song (R)') }[p.repeat]} onClick={() => player.cycleRepeat()} />
            </div>
            <div className="now__tools">
              <button type="button" className={cx('ibtn', fav && 'is-on')} aria-label={tr('Favorite')} onClick={() => p.track && toggleFav(p.track)}>
                <Icon name={fav ? 'heartFill' : 'heart'} size={22} />
              </button>
              {/* Computers: the queue takes the place of the lyrics, and the same button brings them
                  back. Phones have no room for either, so they open in the side panel. */}
              <IconButton icon="lyrics" label={tr('Lyrics (T)')} className="now__lyricsbtn" onClick={() => shell.set({ now: false, panel: 'lyrics' })} />
              <button type="button" className={cx('ibtn', 'now__queuebtn', ui.nowSide === 'queue' && 'is-on')} aria-label={tr('Play queue (Q)')}
                aria-pressed={nowHasSide() ? ui.nowSide === 'queue' : undefined} onClick={() => toggleNowQueue()}>
                <Icon name="queue" size={22} />
              </button>
              <SleepButton />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

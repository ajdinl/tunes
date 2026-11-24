// Track list. Large lists render in chunks as you scroll, so even 20,000 tracks stay smooth.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { Icon } from './Icon.tsx';
import { Cover, SourceTag, Empty } from './common.tsx';
import { tr } from '../lib/i18n.ts';
import { fmtTime, cx } from '../lib/format.ts';
import { player, usePlayer } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import type { Context, Playlist, Track } from '../lib/store.ts';
import { openMenu } from '../lib/feedback.ts';
import { toggleFav, trackMenu } from '../lib/actions.ts';
import { offline, useOffline } from '../lib/offline.ts';

const CHUNK = 200;

export interface TrackListProps {
  tracks: Track[];
  context?: Context | null;
  numbered?: boolean;
  album?: boolean;
  coverArt?: boolean;
  playlist?: Playlist | null;
  leading?: (t: Track, i: number) => ReactNode;
  // Given, every row gets a handle (≡) to move it: drag with a finger or the mouse, or
  // focus it and press ↑ ↓. Called with the old and the new position.
  onReorder?: (from: number, to: number) => void;
  emptyText?: string;
}

type Drag = { from: number; over: number };

export function TrackList({ tracks, context = null, numbered = false, album = true, coverArt = true, playlist = null, leading, onReorder, emptyText }: TrackListProps) {
  const p = usePlayer('track', 'state');
  const currentId = p.track?.id;
  useStore('favorites');
  useOffline();
  const [shown, setShown] = useState(CHUNK);
  const [drag, setDrag] = useState<Drag | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= tracks.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setShown((n) => n + CHUNK); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, tracks.length]);

  if (!tracks.length) return <Empty>{emptyText ?? tr('No songs.')}</Empty>;

  // One click or tap plays a song; on the song that is already on, it pauses and resumes instead.
  const play = (t: Track, i: number) => {
    if (t.id === currentId) player.toggle();
    else player.playList(tracks, i, { shuffle: false, context });
  };
  const menuFor = (t: Track, i: number) => trackMenu(t, { playlist, index: i, list: tracks });

  // Moving a row by its handle. The pointer is captured by the handle, so a finger can travel
  // over other rows; near the top or bottom edge the screen scrolls by itself.
  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, from: number) => {
    if (!onReorder || e.button > 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const list = grip.closest('.tl') as HTMLElement;
    const scroller = document.getElementById('main');
    grip.setPointerCapture(e.pointerId);
    let y = e.clientY;
    let over = from;
    let raf = 0;
    const pick = () => {
      const rows = [...list.querySelectorAll<HTMLElement>(':scope > .tr')];
      over = Number(rows[rows.length - 1]?.dataset.i ?? from);
      for (const r of rows) if (y < r.getBoundingClientRect().bottom) { over = Number(r.dataset.i); break; }
      setDrag({ from, over });
    };
    const edgeScroll = () => {
      if (scroller) {
        const b = scroller.getBoundingClientRect();
        const step = y < b.top + 60 ? -14 : y > b.bottom - 60 ? 14 : 0;
        if (step) { scroller.scrollTop += step; pick(); }
      }
      raf = requestAnimationFrame(edgeScroll);
    };
    const move = (ev: PointerEvent) => { y = ev.clientY; pick(); };
    const end = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      setDrag(null);
      if (ev.type === 'pointerup' && over !== from) onReorder(from, over);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    raf = requestAnimationFrame(edgeScroll);
    setDrag({ from, over });
  };

  const gripKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!onReorder) return;
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
    if (to < 0 || to >= tracks.length) return;
    e.preventDefault();
    e.stopPropagation();
    const list = e.currentTarget.closest('.tl');
    onReorder(i, to);
    // Keep the focus on the moved song's handle.
    requestAnimationFrame(() => (list?.querySelector(`.tr[data-i="${to}"] .tr__grip`) as HTMLElement | null)?.focus());
  };

  return (
    <div className={cx('tl', !album && 'tl--noalbum', !coverArt && 'tl--nocover', onReorder && 'tl--sortable', drag && 'is-dragging')} role="list">
      {tracks.slice(0, shown).map((t, i) => (
        <Row key={t.id + ':' + i} t={t} i={i} current={t.id === currentId} paused={!p.playing} fav={store.isFav(t.id)}
          lead={leading ? leading(t, i) : numbered ? (t.trackNo || i + 1) : i + 1}
          album={album} coverArt={coverArt} onPlay={() => play(t, i)} menu={() => menuFor(t, i)}
          grip={onReorder ? { onPointerDown: (e) => startDrag(e, i), onKeyDown: (e) => gripKey(e, i) } : null}
          dragState={!drag ? null : drag.from === i ? 'drag' : drag.over === i && drag.over !== drag.from ? (drag.over < drag.from ? 'before' : 'after') : null} />
      ))}
      {shown < tracks.length && <div className="tl__more" aria-hidden="true" ref={sentinel} />}
    </div>
  );
}

interface GripHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

function Row({ t, i, current, paused, fav, lead, album, coverArt, onPlay, menu, grip, dragState }: {
  t: Track; i: number; current: boolean; paused: boolean; fav: boolean; lead: ReactNode; album: boolean; coverArt: boolean;
  onPlay: () => void; menu: () => ReturnType<typeof trackMenu>; grip: GripHandlers | null; dragState: 'drag' | 'before' | 'after' | null;
}) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const r = e.currentTarget;
    if (e.target !== r) return;
    if (e.key === 'Enter') { onPlay(); e.preventDefault(); }
    if (e.key === 'ArrowDown') { (r.nextElementSibling as HTMLElement | null)?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { (r.previousElementSibling as HTMLElement | null)?.focus(); e.preventDefault(); }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const b = r.getBoundingClientRect(); openMenu(b.left + 40, b.bottom, menu()); e.preventDefault(); }
  };
  return (
    <div className={cx('tr', current && 'is-playing', dragState === 'drag' && 'is-drag', dragState === 'before' && 'is-over', dragState === 'after' && 'is-over-after')}
      role="listitem" tabIndex={0} data-id={t.id} data-i={i} aria-label={`${t.title}, ${t.artist || ''}`}
      onKeyDown={onKeyDown}
      // The buttons in the row keep their own job. The second click of a double click is ignored,
      // or it would pause the song the first one started.
      onClick={(e) => { if (e.detail < 2 && !(e.target as Element).closest('button, a, input')) onPlay(); }}
      onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, menu()); }}>
      {grip && (
        <button type="button" className="tr__grip" aria-label={tr('Drag to change the order')} title={tr('Drag to change the order')}
          onPointerDown={grip.onPointerDown} onKeyDown={grip.onKeyDown} onClick={(e) => e.stopPropagation()}><Icon name="grip" size={18} /></button>
      )}
      <div className="tr__lead">
        <span className="tr__num">{lead}</span>
        <button type="button" className="tr__play" aria-label={current && !paused ? tr('Pause') : tr('Play ') + t.title}
          onClick={(e) => { e.stopPropagation(); onPlay(); }}><Icon name={current && !paused ? 'pause' : 'play'} size={16} /></button>
      </div>
      {coverArt && <Cover src={t.cover} label={t.title} className="tr__cv" />}
      <div className="tr__main">
        <span className="tr__title">{t.title}</span>
        <span className="tr__artist">
          {offline.isPinned(t.id) && <span className="tr__dl" role="img" aria-label={tr('Downloaded')} title={tr('Downloaded')}><Icon name="downloaded" size={13} /></span>}
          {t.artist || ''}
        </span>
      </div>
      {album && <span className="tr__album">{t.album || ''}</span>}
      <span className="tr__src"><SourceTag source={t.source} /></span>
      <button type="button" className={cx('tr__fav', fav && 'is-on')} aria-pressed={fav} aria-label={fav ? tr('Remove from favorites') : tr('Add to favorites')}
        onClick={(e) => { e.stopPropagation(); toggleFav(t); }}><Icon name={fav ? 'heartFill' : 'heart'} size={17} /></button>
      <span className="tr__dur">{t.live ? tr('live') : fmtTime(t.duration || 0)}</span>
      <button type="button" className="tr__more" aria-label={tr('More options')}
        onClick={(e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left - 180, b.bottom + 4, menu()); }}><Icon name="more" size={18} /></button>
    </div>
  );
}

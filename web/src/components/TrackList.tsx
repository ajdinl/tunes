// Track list. Large lists render in chunks as you scroll, so even 20,000 tracks stay smooth.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';

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

const TOUCH = matchMedia('(hover: none)').matches;

const CHUNK = 200;

export interface TrackListProps {
  tracks: Track[];
  context?: Context | null;
  numbered?: boolean;
  album?: boolean;
  coverArt?: boolean;
  playlist?: Playlist | null;
  leading?: (t: Track, i: number) => ReactNode;
  sortable?: boolean;
  emptyText?: string;
}

export function TrackList({ tracks, context = null, numbered = false, album = true, coverArt = true, playlist = null, leading, sortable = false, emptyText }: TrackListProps) {
  const playingId = usePlayer('track').track?.id;
  useStore('favorites');
  useOffline();
  const [shown, setShown] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= tracks.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setShown((n) => n + CHUNK); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, tracks.length]);

  if (!tracks.length) return <Empty>{emptyText ?? tr('No songs.')}</Empty>;

  const play = (i: number) => player.playList(tracks, i, { shuffle: false, context });
  const menuFor = (t: Track, i: number) => trackMenu(t, { playlist, index: i, list: tracks });

  return (
    <div className={cx('tl', !album && 'tl--noalbum', !coverArt && 'tl--nocover')} role="list">
      {tracks.slice(0, shown).map((t, i) => (
        <Row key={t.id + ':' + i} t={t} i={i} playing={t.id === playingId} fav={store.isFav(t.id)}
          lead={leading ? leading(t, i) : numbered ? (t.trackNo || i + 1) : i + 1}
          album={album} coverArt={coverArt} onPlay={() => play(i)} menu={() => menuFor(t, i)}
          sortable={sortable && Boolean(playlist)} onMove={(from) => {
            if (!playlist || from === i) return;
            const list = playlist.tracks.slice();
            const [x] = list.splice(from, 1);
            list.splice(i, 0, x);
            store.updatePlaylist(playlist.id, { tracks: list });
          }} />
      ))}
      {shown < tracks.length ? <div className="tl__more" aria-hidden="true" ref={sentinel} /> : null}
    </div>
  );
}

function Row({ t, i, playing, fav, lead, album, coverArt, onPlay, menu, sortable, onMove }: {
  t: Track; i: number; playing: boolean; fav: boolean; lead: ReactNode; album: boolean; coverArt: boolean;
  onPlay: () => void; menu: () => ReturnType<typeof trackMenu>; sortable: boolean; onMove: (from: number) => void;
}) {
  const [drag, setDrag] = useState(false);
  const [over, setOver] = useState(false);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const r = e.currentTarget;
    if (e.target !== r) return;
    if (e.key === 'Enter') { onPlay(); e.preventDefault(); }
    if (e.key === 'ArrowDown') { (r.nextElementSibling as HTMLElement | null)?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { (r.previousElementSibling as HTMLElement | null)?.focus(); e.preventDefault(); }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const b = r.getBoundingClientRect(); openMenu(b.left + 40, b.bottom, menu()); e.preventDefault(); }
  };
  return (
    <div className={cx('tr', playing && 'is-playing', drag && 'is-drag', over && 'is-over')} role="listitem" tabIndex={0}
      data-id={t.id} data-i={i} aria-label={`${t.title}, ${t.artist || ''}`}
      onDoubleClick={onPlay} onKeyDown={onKeyDown}
      // On touch screens one tap on a song plays it (the buttons in the row keep their own job).
      onClick={TOUCH ? (e) => { if (!(e.target as Element).closest('button, a, input')) onPlay(); } : undefined}
      onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, menu()); }}
      draggable={sortable || undefined}
      onDragStart={sortable ? (e) => { e.dataTransfer.setData('text/x-index', String(i)); e.dataTransfer.effectAllowed = 'move'; setDrag(true); } : undefined}
      onDragEnd={sortable ? () => setDrag(false) : undefined}
      onDragOver={sortable ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={sortable ? () => setOver(false) : undefined}
      onDrop={sortable ? (e) => {
        e.preventDefault();
        setOver(false);
        const from = Number(e.dataTransfer.getData('text/x-index'));
        if (!Number.isNaN(from)) onMove(from);
      } : undefined}>
      <div className="tr__lead">
        <span className="tr__num">{lead}</span>
        <button type="button" className="tr__play" aria-label={tr('Play ') + t.title} onClick={(e) => { e.stopPropagation(); onPlay(); }}><Icon name="play" size={16} /></button>
      </div>
      {coverArt ? <Cover src={t.cover} label={t.title} className="tr__cv" /> : null}
      <div className="tr__main">
        <span className="tr__title">{t.title}</span>
        <span className="tr__artist">
          {offline.isPinned(t.id) ? <span className="tr__dl" role="img" aria-label={tr('Downloaded')} title={tr('Downloaded')}><Icon name="downloaded" size={13} /></span> : null}
          {t.artist || ''}
        </span>
      </div>
      {album ? <span className="tr__album">{t.album || ''}</span> : null}
      <span className="tr__src"><SourceTag source={t.source} /></span>
      <button type="button" className={cx('tr__fav', fav && 'is-on')} aria-pressed={fav} aria-label={fav ? tr('Remove from favorites') : tr('Add to favorites')}
        onClick={(e) => { e.stopPropagation(); toggleFav(t); }}><Icon name={fav ? 'heartFill' : 'heart'} size={17} /></button>
      <span className="tr__dur">{t.live ? tr('live') : fmtTime(t.duration || 0)}</span>
      <button type="button" className="tr__more" aria-label={tr('More options')}
        onClick={(e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left - 180, b.bottom + 4, menu()); }}><Icon name="more" size={18} /></button>
    </div>
  );
}

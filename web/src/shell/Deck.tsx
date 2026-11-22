// The player bar at the bottom.
import { useEffect, useState } from 'react';

import { Icon, IconButton } from '../components/Icon.tsx';
import { Cover, SourceTag } from '../components/common.tsx';
import { DialView } from './DialView.tsx';
import { shell, useShell } from './ui.ts';
import { player, usePlayer } from '../lib/player.ts';
import type { Player } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import { tr } from '../lib/i18n.ts';
import { fmtTime, cx } from '../lib/format.ts';
import { stationFreq } from '../lib/dial.ts';
import { openMenu, toast } from '../lib/feedback.ts';
import { toggleFav } from '../lib/actions.ts';
import { toPath } from '../lib/router.ts';

// The track as shown: inside a SoundCloud set, the song that is playing right now.
export function shownTrack(p: Player): Track | null {
  const t = p.track;
  const sc = p.scSound;
  return t && sc ? { ...t, title: sc.title || t.title, artist: sc.artist || t.artist, cover: sc.cover || t.cover, album: t.title } : t;
}

export function Deck() {
  const p = usePlayer('track', 'state', 'time', 'mode', 'volume', 'sleep', 'icy', 'sound', 'eq');
  useStore('favorites');
  const ui = useShell();
  const t = shownTrack(p);
  const playing = p.playing;
  const fav = Boolean(p.track && store.isFav(p.track.id));
  const v = p.muted ? 0 : p.volume;

  useEffect(() => {
    document.title = t ? `${p.icyTitle || t.title} · Tunes` : 'Tunes';
  }, [t?.title, p.icyTitle]);

  return (
    <footer className="deck" id="deck" aria-label={tr('Player')}>
      <div className="deck__now">
        <button type="button" className="deck__cv" aria-label={tr('Open “Now playing”')} onClick={() => { if (player.track) shell.set({ now: true }); }}>
          <Cover src={t?.cover} label={t?.title || '♪'} />
        </button>
        <div className="deck__meta">
          {t ? (
            <a className="deck__title" href={toPath(p.context?.href || '/')} title={p.context ? tr('Playing from: ') + p.context.label : ''}>{t.title}</a>
          ) : <a className="deck__title">{tr('Nothing playing')}</a>}
          <span className="deck__artist">
            {t ? <><SourceTag source={t.source} />{' '}{t.live ? (p.icyTitle || t.artist) : t.artist || ''}</> : tr('Pick a song, album or station')}
          </span>
        </div>
        <button type="button" className={cx('ibtn', 'deck__fav', fav && 'is-on')} aria-pressed={fav} disabled={!p.track}
          aria-label={fav ? tr('Remove from favorites (L)') : tr('Add to favorites (L)')} onClick={() => p.track && toggleFav(p.track)}>
          <Icon name={fav ? 'heartFill' : 'heart'} size={19} />
        </button>
      </div>
      <div className="deck__center">
        <div className="deck__ctrls">
          <IconButton icon="shuffle" label={tr('Shuffle (S)')} className={cx(p.shuffle && 'is-on')} aria-pressed={p.shuffle} onClick={() => player.toggleShuffle()} />
          <IconButton icon="prev" label={tr('Previous (Shift + ←)')} onClick={() => player.prev()} />
          <button type="button" className={cx('play', p.loading && 'is-loading')} aria-label={playing ? tr('Pause (space)') : tr('Play (space)')} onClick={() => player.toggle()}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <IconButton icon="next" label={tr('Next (Shift + →)')} onClick={() => player.next()} />
          <IconButton icon={p.repeat === 'one' ? 'repeat1' : 'repeat'} className={cx(p.repeat !== 'off' && 'is-on')}
            label={{ off: tr('Repeat off (R)'), all: tr('Repeating the queue (R)'), one: tr('Repeating this song (R)') }[p.repeat]} onClick={() => player.cycleRepeat()} />
        </div>
        <div className="deck__dial">
          <span className="deck__time">{t?.live ? tr('live') : fmtTime(p.time)}</span>
          <DialView />
          <span className="deck__time deck__time--end">{t?.live ? stationFreq(t) + ' MHz' : fmtTime(p.duration)}</span>
        </div>
      </div>
      <div className="deck__tools">
        <IconButton icon="lyrics" label={tr('Lyrics (T)')} className={cx(ui.panel === 'lyrics' && 'is-on')} onClick={() => shell.togglePanel('lyrics')} />
        <IconButton icon="queue" label={tr('Play queue (Q)')} className={cx(ui.panel === 'queue' && 'is-on')} onClick={() => shell.togglePanel('queue')} />
        <IconButton icon="eq" label={tr('Equalizer (E)')} className={cx((p.eq.enabled || ui.eq) && 'is-on')} onClick={() => shell.set({ eq: !ui.eq })} />
        <SleepButton />
        <div className="volbox">
          <IconButton icon={v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume'} label={tr('Mute (M)')} onClick={() => player.toggleMute()} />
          <input className="vol" type="range" min="0" max="1" step="0.01" value={String(v)} aria-label={tr('Volume')}
            style={{ '--v': (v * 100).toFixed(0) + '%' } as React.CSSProperties}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            onWheel={(e) => player.setVolume(player.volume - Math.sign(e.deltaY) * 0.05)} />
        </div>
        <IconButton icon="expand" label={tr('Full screen (F)')} onClick={() => { if (player.track) shell.set({ now: true }); }} />
      </div>
    </footer>
  );
}

function SleepButton() {
  const p = usePlayer('sleep');
  const [, tick] = useState(0);
  const s = p.sleep;
  useEffect(() => {
    if (s?.mode !== 'time') return;
    const iv = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(iv);
  }, [s]);
  let title = tr('Sleep timer');
  let badge: string | undefined;
  if (s?.mode === 'end') { title = tr('Stops at the end of the song'); badge = '♪'; }
  if (s?.mode === 'time') {
    const min = Math.max(0, Math.ceil((s.until - Date.now()) / 60000));
    title = tr('Stops in {m} min', { m: min });
    badge = String(min);
  }
  const open = (btn: HTMLElement) => {
    const b = btn.getBoundingClientRect();
    openMenu(b.left - 120, b.top - 260, [
      ...[15, 30, 45, 60, 90].map((m) => ({ label: tr('In {m} minutes', { m }), action: () => { player.setSleep(m); toast(tr('Music stops in {m} minutes', { m })); } })),
      { label: tr('At the end of this song'), action: () => { player.setSleep('end'); toast(tr('Music stops at the end of this song')); } },
      player.sleep ? '-' : null,
      player.sleep ? { label: tr('Turn off timer'), action: () => { player.clearSleep(); toast(tr('Timer off')); } } : null,
    ]);
  };
  // aria-label stays "Sleep timer"; the tooltip shows the time left (like before).
  return (
    <button type="button" className={cx('ibtn', s && 'is-on')} aria-label={tr('Sleep timer')} data-tip={title} data-badge={badge}
      onClick={(e) => open(e.currentTarget)}>
      <Icon name="moon" size={20} />
    </button>
  );
}

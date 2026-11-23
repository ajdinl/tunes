// Side panel: the play queue or the lyrics.
import { useState } from 'react';

import { IconButton } from '../components/Icon.tsx';
import { Cover } from '../components/common.tsx';
import { Lyrics } from '../components/Lyrics.tsx';
import { shell, useShell } from './ui.ts';
import { player, usePlayer } from '../lib/player.ts';
import type { Track } from '../lib/store.ts';
import { tr } from '../lib/i18n.ts';
import { songs, cx } from '../lib/format.ts';
import { openMenu } from '../lib/feedback.ts';
import { trackMenu } from '../lib/actions.ts';
import { toPath } from '../lib/router.ts';

export function Panel() {
  const ui = useShell();
  const tab = ui.panel;
  return (
    <aside className="panel" id="panel" aria-label={tr('Side panel')} hidden={!tab}>
      {tab && (
        <>
          <div className="panel__head">
            <div className="tabs tabs--small" role="tablist">
              {(['queue', 'lyrics'] as const).map((k) => (
                <button key={k} type="button" role="tab" className={cx('tab', tab === k && 'is-on')} aria-selected={tab === k}
                  onClick={() => shell.set({ panel: k })}>{k === 'queue' ? tr('Queue') : tr('Lyrics')}</button>
              ))}
            </div>
            <IconButton icon="close" size={18} label={tr('Close panel')} onClick={() => shell.set({ panel: null })} />
          </div>
          {tab === 'lyrics' ? <Lyrics /> : <Queue />}
        </>
      )}
    </aside>
  );
}

export function Queue() {
  const p = usePlayer('queue', 'track', 'mode');
  const q = p.queue;
  const i = p.index;
  if (!q.length) return <div className="queue"><p className="empty">{tr('The queue is empty. Play an album, playlist or station.')}</p></div>;
  const upcoming = q.slice(i + 1);
  return (
    <div className="queue">
      <p className="queue__label">{tr('Now playing')}</p>
      {/* The current row sits outside the lists, as before (same spacing from app.css). */}
      <QueueRow t={q[i]} idx={i} current />
      <div className="queue__bar">
        <p className="queue__label">{upcoming.length ? tr('Up next ({n})', { n: songs(upcoming.length) }) : tr('No more songs in the queue')}</p>
        {upcoming.length > 0 && <button type="button" className="link" onClick={() => player.clearUpcoming()}>{tr('Clear')}</button>}
      </div>
      {p.context && <p className="queue__ctx">{tr('From: ')}<a href={toPath(p.context.href)}>{p.context.label}</a></p>}
      <ol className="queue__list">
        {upcoming.slice(0, 300).map((t, k) => <QueueRow key={t.id + ':' + (i + 1 + k)} t={t} idx={i + 1 + k} />)}
      </ol>
      {i > 0 && (
        <details className="queue__prev">
          <summary>{tr('Already played ({n})', { n: i })}</summary>
          <ol className="queue__list">
            {q.slice(Math.max(0, i - 50), i).map((t, k) => <QueueRow key={t.id + ':' + (Math.max(0, i - 50) + k)} t={t} idx={Math.max(0, i - 50) + k} />)}
          </ol>
        </details>
      )}
    </div>
  );
}

function QueueRow({ t, idx, current = false }: { t: Track; idx: number; current?: boolean }) {
  const [drag, setDrag] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <li className={cx('qr', current && 'is-current', drag && 'is-drag', over && 'is-over')} draggable={current ? undefined : true} data-i={idx}
      onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, trackMenu(t)); }}
      onDragStart={current ? undefined : (e) => { e.dataTransfer.setData('text/x-q', String(idx)); setDrag(true); }}
      onDragEnd={current ? undefined : () => setDrag(false)}
      onDragOver={current ? undefined : (e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={current ? undefined : () => setOver(false)}
      onDrop={current ? undefined : (e) => {
        e.preventDefault();
        setOver(false);
        const from = Number(e.dataTransfer.getData('text/x-q'));
        if (!Number.isNaN(from)) player.move(from, idx);
      }}>
      <Cover src={t.cover} label={t.title} className="qr__cv" />
      <button type="button" className="qr__main" aria-label={tr('Play ') + t.title} onClick={() => player.jump(idx)}>
        <span className="qr__title">{t.title}</span><span className="qr__artist">{t.artist || ''}</span>
      </button>
      {!current && <IconButton icon="close" size={16} label={tr('Remove from queue')} onClick={() => player.removeAt(idx)} />}
    </li>
  );
}

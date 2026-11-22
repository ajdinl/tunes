// Lyrics of the current song. Synced lyrics follow the song line by line, and clicking a
// line seeks to that point.
import { useEffect, useRef, useState } from 'react';

import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { player, usePlayer } from '../lib/player.ts';
import { getLyrics } from '../lib/lyrics.ts';
import type { SongLyrics } from '../lib/lyrics.ts';

type State = { kind: 'none' } | { kind: 'live' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ok'; data: SongLyrics };

export function Lyrics({ big = false }: { big?: boolean }) {
  const p = usePlayer('track', 'time');
  const t = p.track;
  const [state, setState] = useState<State>({ kind: 'none' });
  const root = useRef<HTMLDivElement>(null);
  const userScrollUntil = useRef(0);
  const lastLine = useRef(-1);

  useEffect(() => {
    let stale = false;
    lastLine.current = -1;
    if (!t) { setState({ kind: 'none' }); return; }
    if (t.live) { setState({ kind: 'live' }); return; }
    setState({ kind: 'loading' });
    getLyrics(t).then(
      (data) => { if (!stale) setState(data ? { kind: 'ok', data } : { kind: 'missing' }); },
      () => { if (!stale) setState({ kind: 'error' }); },
    );
    return () => { stale = true; };
  }, [t?.id]);

  const lines = state.kind === 'ok' ? state.data.synced || [] : [];
  let current = -1;
  if (lines.length) {
    const now = p.time + 0.25;
    current = lines.length - 1;
    while (current >= 0 && lines[current].t > now) current--;
  }

  // Keep the current line in view, unless the user just scrolled the lyrics themselves.
  useEffect(() => {
    if (current === lastLine.current) return;
    lastLine.current = current;
    const r = root.current;
    const n = r?.querySelectorAll<HTMLElement>('.lyr__line')[current];
    if (!r || !n || Date.now() < userScrollUntil.current || !r.offsetParent) return;
    r.scrollTo({ top: n.offsetTop - r.clientHeight * 0.38, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [current]);

  const msg = (text: string) => <p className="lyr__msg">{text}</p>;
  let body;
  switch (state.kind) {
    case 'none': body = msg(tr('Play a song and its lyrics will appear here.')); break;
    case 'live': body = msg(tr('Radio stations have no lyrics. The song playing live is shown on the dial.')); break;
    case 'loading': body = msg(tr('Looking for lyrics…')); break;
    case 'error': body = msg(tr('LRCLIB isn\'t responding. Try again in a few minutes.')); break;
    case 'missing': body = msg(tr('No lyrics for “{title}” in LRCLIB.', { title: t?.title || '' })); break;
    case 'ok': {
      const d = state.data;
      if (d.instrumental) body = msg(tr('Instrumental: this song has no lyrics.'));
      else if (lines.length) {
        body = lines.map((l, k) => (
          <button key={k} type="button" className={cx('lyr__line', k === current && 'is-on', k < current && 'is-past')}
            onClick={() => { player.seek(l.t); userScrollUntil.current = 0; }}>{l.text || '♪'}</button>
        ));
      } else if (d.plain) body = d.plain.split('\n').map((l, k) => <p key={k} className="lyr__plain">{l || ' '}</p>);
      break;
    }
  }

  return (
    <div ref={root} className={cx('lyr', big && 'lyr--big')}
      onWheel={() => { userScrollUntil.current = Date.now() + 4000; }}
      onTouchMove={() => { userScrollUntil.current = Date.now() + 4000; }}>
      {body}
    </div>
  );
}

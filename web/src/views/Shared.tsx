// A song someone shared (/shared#…): the song from the link, ready to play, keep or add to a
// playlist. Usually opened in the phone-only version by someone who has never used Tunes.
import { useEffect, useState } from 'react';

import { Cover, Header } from '../components/common.tsx';
import { Icon, IconButton } from '../components/Icon.tsx';
import { player, usePlayer } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import { toggleFav, trackMenu } from '../lib/actions.ts';
import { openMenu } from '../lib/feedback.ts';
import { tr } from '../lib/i18n.ts';
import { SOURCES, fmtTime } from '../lib/format.ts';
import { readShared } from '../../../lib/share.ts';
import type { Route } from '../lib/router.ts';

// The song is in the part after the #, which can change while the page is open (another
// shared link opened in the same tab).
function useHash(): string {
  const [, rerender] = useState(0);
  useEffect(() => {
    const on = () => rerender((n) => n + 1);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return location.hash;
}

export function Shared(_: { route: Route }) {
  const hash = useHash();
  const t = readShared(hash);
  const p = usePlayer('track', 'state');
  useStore('favorites');

  if (!t) {
    return (
      <div className="view view--narrow">
        <Header title={tr('Shared song')} />
        <p className="empty">{tr('This link is broken or incomplete. Ask for it again.')}</p>
        <a className="btn" href="/"><Icon name="home" size={16} />{tr('Go to Home')}</a>
      </div>
    );
  }

  const here = p.track?.id === t.id;
  const playing = here && p.playing;
  const fav = store.isFav(t.id);
  const source = SOURCES[t.source || '']?.name;
  return (
    <div className="view view--narrow shared">
      <Header kicker={tr('Shared with you')} title={t.title}
        meta={[t.artist, source && tr(source), t.duration && !t.live ? fmtTime(t.duration) : ''].filter(Boolean).join(' · ')}
        art={<Cover src={t.cover} label={t.title} className="hd__cv" />}
        actions={[
          <button key="play" type="button" className="btn btn--primary shared__play"
            onClick={() => (here ? player.toggle() : player.playList([t], 0, { context: { label: tr('Shared with you'), href: '/shared' + hash } }))}>
            <Icon name={playing ? 'pause' : 'play'} size={18} />{playing ? tr('Pause') : tr('Play')}
          </button>,
          <button key="fav" type="button" className="btn btn--ghost shared__fav" aria-pressed={fav} onClick={() => toggleFav(t)}>
            <Icon name={fav ? 'heartFill' : 'heart'} size={16} />{fav ? tr('In favorites') : tr('Add to favorites')}
          </button>,
          <IconButton key="more" icon="more" label={tr('More')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom, trackMenu(t)); }} />,
        ]} />
      <p className="muted shared__about">{tr('Tunes is a free music player: radio, DJ mixes and free music from artists who share it. Add it to your Home Screen to keep it.')}</p>
    </div>
  );
}

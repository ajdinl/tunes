// A song or a playlist someone shared (/shared#…): ready to play, keep or add to a playlist.
// Usually opened in the phone-only version by someone who has never used Tunes.
import { useEffect, useState } from 'react';

import { Collage, Cover, Header, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon, IconButton } from '../components/Icon.tsx';
import { player, usePlayer } from '../lib/player.ts';
import { store, useStore } from '../lib/store.ts';
import { playlistHref, toggleFav, trackMenu } from '../lib/actions.ts';
import { openMenu, toast } from '../lib/feedback.ts';
import { tr } from '../lib/i18n.ts';
import { SOURCES, fmtTime, totalMeta } from '../lib/format.ts';
import { isPlaylistHash, readShared, readSharedPlaylist } from '../../../lib/share.ts';
import type { SharedPlaylist as SharedList } from '../../../lib/share.ts';
import { go } from '../lib/router.ts';
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

const Broken = ({ title }: { title: string }) => (
  <div className="view view--narrow">
    <Header title={title} />
    <p className="empty">{tr('This link is broken or incomplete. Ask for it again.')}</p>
    <a className="btn" href="/"><Icon name="home" size={16} />{tr('Go to Home')}</a>
  </div>
);

const About = () => (
  <p className="muted shared__about">{tr('Tunes is a free music player: radio, DJ mixes and free music from artists who share it. Add it to your Home Screen to keep it.')}</p>
);

export function Shared(_: { route: Route }) {
  const hash = useHash();
  return isPlaylistHash(hash) ? <SharedPlaylist hash={hash} /> : <SharedSong hash={hash} />;
}

function SharedSong({ hash }: { hash: string }) {
  const t = readShared(hash);
  const p = usePlayer('track', 'state');
  useStore('favorites');

  if (!t) return <Broken title={tr('Shared song')} />;

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
      <About />
    </div>
  );
}

// A playlist link is compressed, so it is read asynchronously.
function SharedPlaylist({ hash }: { hash: string }) {
  const [list, setList] = useState<SharedList | null | undefined>(undefined);
  useStore('playlists');
  useEffect(() => {
    let stale = false;
    setList(undefined);
    readSharedPlaylist(hash).then((l) => { if (!stale) setList(l); });
    return () => { stale = true; };
  }, [hash]);

  if (list === undefined) return <div className="view" />;
  if (!list) return <Broken title={tr('Shared playlist')} />;

  const name = list.name || tr('Shared playlist');
  const ctx = { label: name, href: '/shared' + hash };
  // Already kept: a playlist with this name and these songs.
  const ids = list.tracks.map((t) => t.id).join();
  const kept = store.playlists.find((p) => p.name === name && p.tracks.map((t) => t.id).join() === ids);
  const keep = async () => {
    try {
      const p = await store.createPlaylist(name, list.tracks);
      toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go(playlistHref(p.id)) });
    } catch (e) { toast((e as Error).message, { error: true }); }
  };
  return (
    <div className="view shared">
      <Header kicker={tr('Shared with you')} title={name} meta={totalMeta(list.tracks)}
        art={<Collage covers={list.tracks.map((t) => t.cover)} label={name} />}
        actions={[
          ...playButtons(list.tracks, ctx),
          kept
            ? <a key="open" className="btn btn--ghost shared__open" href={playlistHref(kept.id)}><Icon name="check" size={16} />{tr('In your playlists')}</a>
            : <button key="keep" type="button" className="btn btn--ghost shared__keep" onClick={keep}><Icon name="plus" size={16} />{tr('Save to my playlists')}</button>,
        ]} />
      <About />
      <TrackList tracks={list.tracks} context={ctx} />
    </div>
  );
}

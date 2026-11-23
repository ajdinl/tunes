// Home: greeting, recently played, smart playlists, saved stations and what's popular on Audius,
// in the order chosen in Settings → Home screen (sections of turned-off sources are left out).
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Icon } from '../components/Icon.tsx';
import { Header, Section, Grid, Loading, ErrorBox } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { StationGrid } from '../components/StationGrid.tsx';
import { tr, plural } from '../lib/i18n.ts';
import { songs } from '../lib/format.ts';
import { player } from '../lib/player.ts';
import { store, useStore, api, SMART } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';
import { STANDALONE } from '../lib/env.ts';
import { useLook } from '../lib/look.ts';

type Trending = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'done'; list: Track[] };

export function Home(_props: { route: Route }) {
  useStore('library', 'favorites', 'history', 'stations', 'settings');
  const [trend, setTrend] = useState<Trending>({ state: 'loading' });
  const look = useLook();
  const shown = (key: string) => look.home.some((s) => s.key === key && s.on);
  const showPopular = shown('popular') && !look.hide.includes('audius');

  useEffect(() => {
    if (!showPopular) return;
    let cancelled = false;
    api<Track[]>('/api/audius/trending')
      .then((list) => { if (!cancelled) setTrend({ state: 'done', list }); })
      .catch((e: Error) => { if (!cancelled) setTrend({ state: 'error', msg: e.message }); });
    return () => { cancelled = true; };
  }, [showPopular]);

  const hour = new Date().getHours();
  const hello = hour < 5 ? tr('Good night') : hour < 11 ? tr('Good morning') : hour < 18 ? tr('Good afternoon') : tr('Good evening');
  const lib = store.library;
  const idx = store.index;

  // Recently played: unique tracks, newest first.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const list: Track[] = [];
    for (let i = store.history.length - 1; i >= 0 && list.length < 8; i--) {
      const t = store.history[i].track;
      if (!seen.has(t.id)) { seen.add(t.id); list.push(t); }
    }
    return list;
  }, [store.history]);

  // Smart playlists are partly random: compute them once per data change, not on every render.
  const collection = store.collection;
  const smartTiles = useMemo(
    () => SMART.map((s) => ({ s, tracks: store.smart(s.key) })).filter((x) => x.tracks.length),
    [collection, store.history, store.library],
  );

  const stations = Object.values(store.stations);

  // Each section, or nothing when it has nothing to show.
  const sections: Record<string, ReactNode> = {
    recent: recent.length > 0 && (
      <Section title={tr('Recently played')} link={{ href: '/history', label: tr('Full history') }}>
        <TrackList tracks={recent} context={{ label: tr('Recently played'), href: '/history' }} album={false} />
      </Section>
    ),
    smart: smartTiles.length > 0 && (
      <Section title={tr('Smart playlists')}>
        <Grid items={smartTiles.map(({ s, tracks }) => ({
          key: s.key, title: tr(s.name), sub: tr(s.desc), href: '/smart/' + s.key,
          collage: tracks.map((t) => t.cover),
          play: () => player.playList(tracks, 0, { shuffle: false, context: { label: tr(s.name), href: '/smart/' + s.key } }),
        }))} />
      </Section>
    ),
    stations: stations.length > 0 && !look.hide.includes('radio') && (
      <Section title={tr('My stations')} link={{ href: '/radio', label: tr('All radio') }}>
        <StationGrid list={stations} />
      </Section>
    ),
    popular: showPopular && (
      <Section title={tr('Popular this week on Audius')} link={{ href: '/discover', label: tr('Discover more') }}>
        <div>
          {trend.state === 'loading' && <Loading text={tr('Loading what\'s popular on Audius…')} />}
          {trend.state === 'error' && <ErrorBox msg={tr('Audius isn\'t responding: ') + trend.msg} />}
          {trend.state === 'done' && <TrackList tracks={trend.list.slice(0, 10)} context={{ label: tr('Audius, popular'), href: '/discover' }} />}
        </div>
      </Section>
    ),
  };

  return (
    <div className="view">
      <Header
        title={hello}
        meta={STANDALONE ? tr('Free music from Audius, Internet Archive and internet radio.')
          : lib.length
            ? tr('On this computer: {a}, {b}, {c}', { a: songs(lib.length), b: plural(idx.artists.length, 'artist', 'artists'), c: plural(idx.albums.length, 'album', 'albums') })
            : tr('Your local library is empty, but internet radio, Audius and Internet Archive work right away.')}
        big />

      {!lib.length && !STANDALONE ? (
        <div className="note">
          <h2>{tr('Add your music')}</h2>
          <p>{tr('Put MP3, FLAC or M4A files in the folder ')}<code>{store.folders[0] || '~/Music/Tunes'}</code>
            {tr('. Tunes picks them up in seconds and sorts them by artist and album.')}</p>
          <a className="btn" href="/settings"><Icon name="folder" size={16} />{tr('Set up folders')}</a>
        </div>
      ) : null}

      {look.home.filter((sec) => sec.on).map((sec) => <Fragment key={sec.key}>{sections[sec.key]}</Fragment>)}
    </div>
  );
}

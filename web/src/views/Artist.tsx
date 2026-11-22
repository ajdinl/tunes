// One artist from the collection: albums and all songs.
import { Header, Section, Grid, NotFound, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { albumTile } from './tiles.tsx';
import { tr, plural } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import type { Album } from '../lib/store.ts';
import { artistHref } from '../lib/actions.ts';
import type { Route } from '../lib/router.ts';

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export function Artist({ route }: { route: Route }) {
  useStore('library', 'favorites');
  const a = store.index.artistMap.get(decode(route.arg));
  if (!a) return <NotFound text={tr('This artist isn\'t in your collection.')} back="/artists" />;
  const albums = [...a.albums].map((k) => store.index.albumMap.get(k)).filter((b): b is Album => Boolean(b))
    .sort((x, y) => Number(y.year || 0) - Number(x.year || 0));
  const tracks = a.tracks.slice().sort((x, y) => (x.album || '').localeCompare(y.album || '') || (x.trackNo || 0) - (y.trackNo || 0));
  const ctx = { label: a.name, href: artistHref(a.name) };
  return (
    <div className="view">
      <Header title={a.name} big
        meta={[plural(albums.length, 'album', 'albums'), totalMeta(tracks)].join(', ')}
        actions={[...playButtons(tracks, ctx),
          <a key="more" className="btn btn--ghost" href={'/search?q=' + encodeURIComponent(a.name)}><Icon name="search" size={16} />{tr('Find more online')}</a>]} />
      {albums.length ? <Section title={tr('Albums')}><Grid items={albums.map(albumTile)} /></Section> : null}
      <Section title={tr('All songs')}><TrackList tracks={tracks} context={ctx} /></Section>
    </div>
  );
}

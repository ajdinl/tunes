// One album from the collection.
import { Header, Cover, NotFound, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { tr } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import { albumHref, artistHref } from '../lib/actions.ts';
import type { Route } from '../lib/router.ts';
import { DownloadButton } from '../components/DownloadButton.tsx';

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export function Album({ route }: { route: Route }) {
  useStore('library', 'favorites');
  const b = store.index.albumMap.get(decode(route.arg));
  if (!b) return <NotFound text={tr('This album isn\'t in your collection.')} back="/albums" />;
  const ctx = { label: b.title, href: albumHref(b.key) };
  return (
    <div className="view">
      <Header title={b.title}
        kicker={<a href={artistHref(b.artist)}>{b.artist}</a>}
        meta={[b.year, totalMeta(b.tracks)].filter(Boolean).join(', ')}
        art={<Cover src={b.cover} label={b.title} className="hd__cv" />}
        actions={[...playButtons(b.tracks, ctx),
          <DownloadButton key="dl" tracks={b.tracks} />]} />
      <TrackList tracks={b.tracks} context={ctx} numbered album={false} coverArt={false} />
    </div>
  );
}

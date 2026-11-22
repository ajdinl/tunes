// One album from the collection.
import { Header, Cover, NotFound, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import { albumHref, artistHref, saveToLibrary } from '../lib/actions.ts';
import type { Route } from '../lib/router.ts';
import { STANDALONE } from '../lib/env.ts';

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export function Album({ route }: { route: Route }) {
  useStore('library', 'favorites');
  const b = store.index.albumMap.get(decode(route.arg));
  if (!b) return <NotFound text={tr('This album isn\'t in your collection.')} back="/albums" />;
  const ctx = { label: b.title, href: albumHref(b.key) };
  const downloadable = b.tracks.filter((t) => t.download && t.source !== 'local');
  return (
    <div className="view">
      <Header title={b.title}
        kicker={<a href={artistHref(b.artist)}>{b.artist}</a>}
        meta={[b.year, totalMeta(b.tracks)].filter(Boolean).join(', ')}
        art={<Cover src={b.cover} label={b.title} className="hd__cv" />}
        actions={[...playButtons(b.tracks, ctx),
          downloadable.length && !STANDALONE ? <button key="save" type="button" className="btn btn--ghost" onClick={() => saveToLibrary(downloadable)}><Icon name="download" size={16} />{tr('Save to computer')}</button> : null]} />
      <TrackList tracks={b.tracks} context={ctx} numbered album={false} coverArt={false} />
    </div>
  );
}

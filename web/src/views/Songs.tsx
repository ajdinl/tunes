// Every song in the collection: filter by text, category and source; sort.
import { useMemo, useState } from 'react';

import { Header, FilterInput, Chips, playButtons } from '../components/common.tsx';
import type { ChipOption } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { EmptyCollection } from './tiles.tsx';
import { tr } from '../lib/i18n.ts';
import { byKind, norm, totalMeta } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';

type Kind = 'all' | 'songs' | 'sets';
type Src = 'all' | 'local' | 'online';
type Sort = 'artist' | 'title' | 'added' | 'plays';
const KINDS: ChipOption<Kind>[] = [{ value: 'all', label: 'All' }, { value: 'songs', label: 'Songs' }, { value: 'sets', label: 'Sets & mixes' }];
const SRCS: ChipOption<Src>[] = [{ value: 'all', label: 'All sources' }, { value: 'local', label: 'On this computer' }, { value: 'online', label: 'Online' }];
const SORTS: ChipOption<Sort>[] = [{ value: 'artist', label: 'Artist' }, { value: 'title', label: 'Title' }, { value: 'added', label: 'Recently added' }, { value: 'plays', label: 'Most played' }];

export function Songs(_: { route: Route }) {
  useStore('library', 'favorites');
  const [sort, setSort] = useState<Sort>('artist');
  const [filter, setFilter] = useState('');
  const [src, setSrc] = useState<Src>('all');
  const [kind, setKind] = useState<Kind>('all');
  const all = store.collection;
  const playCounts = store.playCounts;

  const list = useMemo(() => {
    let out = all.filter(byKind(kind));
    if (src === 'local') out = out.filter((t) => t.source === 'local');
    if (src === 'online') out = out.filter((t) => t.source !== 'local');
    if (filter) { const f = norm(filter); out = out.filter((t) => norm(`${t.title} ${t.artist} ${t.album || ''}`).includes(f)); }
    out = out.slice();
    const by: Record<Sort, (x: Track, y: Track) => number> = {
      artist: (x, y) => (x.artist || '').localeCompare(y.artist || '', 'sr') || (x.album || '').localeCompare(y.album || '') || (x.trackNo || 0) - (y.trackNo || 0),
      title: (x, y) => x.title.localeCompare(y.title, 'sr'),
      added: (x, y) => (y.addedAt || 0) - (x.addedAt || 0),
      plays: (x, y) => (playCounts[y.id] || 0) - (playCounts[x.id] || 0),
    };
    return out.sort(by[sort]);
  }, [all, kind, src, filter, sort, playCounts]);

  const ctx = { label: tr('All songs'), href: '/songs' };
  return (
    <div className="view">
      <Header title={tr('Songs')} meta={totalMeta(all)} actions={playButtons(all, ctx)} />
      <div className="toolbar">
        <FilterInput placeholder={tr('Filter songs')} onChange={setFilter} />
        <Chips options={KINDS} value={kind} onPick={setKind} label={tr('Category')} />
        <Chips options={SRCS} value={src} onPick={setSrc} label={tr('Source')} />
        <Chips options={SORTS} value={sort} onPick={setSort} label={tr('Sort')} />
      </div>
      <div>{list.length ? <TrackList tracks={list} context={ctx} /> : <EmptyCollection text={tr('No songs match this filter.')} />}</div>
    </div>
  );
}

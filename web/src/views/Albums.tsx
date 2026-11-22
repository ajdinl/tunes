// All albums in the collection: filter and sort.
import { useState } from 'react';

import { Header, Grid, FilterInput, Chips } from '../components/common.tsx';
import type { ChipOption } from '../components/common.tsx';
import { albumTile, EmptyCollection } from './tiles.tsx';
import { tr, plural } from '../lib/i18n.ts';
import { norm } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import type { Album } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';

type Sort = 'artist' | 'title' | 'year' | 'added';
const SORTS: ChipOption<Sort>[] = [
  { value: 'artist', label: 'By artist' }, { value: 'title', label: 'By title' }, { value: 'year', label: 'By year' }, { value: 'added', label: 'Recently added' },
];
const newest = (b: Album): number => Math.max(...b.tracks.map((t) => t.addedAt || 0));

export function Albums(_: { route: Route }) {
  useStore('library', 'favorites');
  const [sort, setSort] = useState<Sort>('artist');
  const [filter, setFilter] = useState('');
  const all = store.index.albums;
  const list = filter ? all.filter((b) => norm(`${b.title} ${b.artist}`).includes(norm(filter))) : all.slice();
  if (sort === 'year') list.sort((x, y) => Number(y.year || 0) - Number(x.year || 0));
  if (sort === 'added') list.sort((x, y) => newest(y) - newest(x));
  if (sort === 'title') list.sort((x, y) => x.title.localeCompare(y.title, 'sr'));
  return (
    <div className="view">
      <Header title={tr('Albums')} meta={tr('{n} in your collection', { n: plural(all.length, 'album', 'albums') })} />
      {all.length > 1 ? (
        <div className="toolbar">
          <FilterInput placeholder={tr('Filter albums')} onChange={setFilter} />
          <Chips options={SORTS} value={sort} onPick={setSort} label={tr('Sort')} />
        </div>
      ) : null}
      <div>{list.length ? <Grid items={list.map(albumTile)} /> : <EmptyCollection text={tr('No albums yet.')} />}</div>
    </div>
  );
}

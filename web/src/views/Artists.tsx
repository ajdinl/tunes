// All artists in the collection, with a filter once the list gets long.
import { useState } from 'react';

import { Header, Grid, FilterInput } from '../components/common.tsx';
import { artistTile, EmptyCollection } from './tiles.tsx';
import { tr, plural } from '../lib/i18n.ts';
import { norm } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';

export function Artists(_: { route: Route }) {
  useStore('library', 'favorites');
  const [filter, setFilter] = useState('');
  const all = store.index.artists;
  const list = filter ? all.filter((a) => norm(a.name).includes(norm(filter))) : all;
  return (
    <div className="view">
      <Header title={tr('Artists')} meta={tr('{n} in your collection', { n: plural(all.length, 'artist', 'artists') })} />
      {all.length > 8 && <div className="toolbar"><FilterInput placeholder={tr('Filter artists')} onChange={setFilter} /></div>}
      <div>{list.length ? <Grid items={list.map(artistTile)} round /> : <EmptyCollection text={tr('No artists yet.')} />}</div>
    </div>
  );
}

// Favorite songs, newest first (radio stations live on the radio screen).
import { Header, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { tr } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';
import { DownloadButton } from '../components/DownloadButton.tsx';

export function Favorites(_: { route: Route }) {
  useStore('favorites');
  const list = Object.values(store.favorites).sort((a, b) => b.at - a.at).map((f) => f.track).filter((t) => !t.live);
  const ctx = { label: tr('Favorites'), href: '/favorites' };
  return (
    <div className="view">
      <Header title={tr('Favorites')} meta={list.length ? totalMeta(list) : null} actions={[...playButtons(list, ctx), <DownloadButton key="dl" tracks={list} />]} />
      <TrackList tracks={list} context={ctx} emptyText={tr('Click the heart next to any song (or press L while it plays) and it will show up here.')} />
    </div>
  );
}

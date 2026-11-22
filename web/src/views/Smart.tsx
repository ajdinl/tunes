// Smart playlists: lists that build themselves from the collection and history.
import { useMemo } from 'react';

import { Header, Collage, NotFound, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { tr, locale } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { store, useStore, SMART } from '../lib/store.ts';
import { toast, ask } from '../lib/feedback.ts';
import { playlistHref } from '../lib/actions.ts';
import { go } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';

export function Smart({ route }: { route: Route }) {
  useStore('library');
  const key = route.arg;
  const s = SMART.find((x) => x.key === key);
  // Computed once per library change, like the old screen (the mix is random, so it must not reshuffle on every render).
  const tracks = useMemo(() => (s ? store.smart(key) : []), [s, key, store.library]);
  if (!s) return <NotFound text={tr('Unknown smart playlist.')} back="/" />;
  const ctx = { label: tr(s.name), href: '/smart/' + key };

  const save = async () => {
    const name = await ask(tr('Save as playlist'), { value: `${tr(s.name)}, ${new Date().toLocaleDateString(locale())}`, confirm: tr('Save') });
    if (!name) return;
    const p = await store.createPlaylist(name, tracks);
    toast(tr('Saved as “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go(playlistHref(p.id)) });
  };

  return (
    <div className="view">
      <Header title={tr(s.name)} kicker={tr('Smart playlist')}
        meta={[tr(s.desc), tracks.length ? totalMeta(tracks) : null].filter(Boolean).join('. ')}
        art={<Collage covers={tracks.map((t) => t.cover)} label={tr(s.name)} />}
        actions={[...playButtons(tracks, ctx),
          tracks.length ? <button key="save" type="button" className="btn btn--ghost" onClick={save}><Icon name="plus" size={16} />{tr('Save as playlist')}</button> : null]} />
      <TrackList tracks={tracks} context={ctx} emptyText={tr('This list fills itself as you listen and add music.')} />
    </div>
  );
}

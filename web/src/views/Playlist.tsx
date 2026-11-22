// One playlist: play, rename, export, delete, reorder by dragging.
import { Header, Collage, NotFound, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import { toast, ask } from '../lib/feedback.ts';
import { playlistHref } from '../lib/actions.ts';
import { go } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';

export function Playlist({ route }: { route: Route }) {
  useStore('playlists');
  const p = store.playlists.find((x) => x.id === route.arg);
  if (!p) return <NotFound text={tr('This playlist no longer exists.')} back="/" />;
  const ctx = { label: p.name, href: playlistHref(p.id) };

  const rename = async () => {
    const name = await ask(tr('Rename playlist'), { value: p.name, confirm: tr('Rename') });
    if (name) await store.updatePlaylist(p.id, { name });
  };
  const remove = async () => {
    if (await ask(tr('Delete playlist “{name}”?', { name: p.name }), { input: false, confirm: tr('Delete'), danger: true })) {
      await store.deletePlaylist(p.id);
      toast(tr('Playlist deleted'));
      go('/');
    }
  };

  return (
    <div className="view">
      <Header title={p.name} kicker={tr('Playlist')}
        meta={p.tracks.length ? totalMeta(p.tracks) : tr('Empty')}
        art={<Collage covers={p.tracks.map((t) => t.cover)} label={p.name} />}
        actions={[
          ...playButtons(p.tracks, ctx),
          <button key="rename" type="button" className="btn btn--ghost" onClick={rename}>{tr('Rename')}</button>,
          p.tracks.length ? <a key="m3u" className="btn btn--ghost" href={`/api/playlists/${p.id}/m3u`} download=""><Icon name="download" size={16} />{tr('Export M3U')}</a> : null,
          <button key="delete" type="button" className="btn btn--ghost" onClick={remove}><Icon name="trash" size={16} />{tr('Delete')}</button>,
        ]} />
      <TrackList tracks={p.tracks} context={ctx} playlist={p} sortable
        emptyText={tr('Add songs with the ⋯ menu next to any song, or by right-clicking a song.')} />
      {p.tracks.length > 1 ? <p className="muted pad">{tr('Drag a song to change the order.')}</p> : null}
    </div>
  );
}

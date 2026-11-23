// Things you can do with a song from anywhere: favorite, add to a playlist, save to the
// computer, open its artist or album. The track menu (⋯ and right click) is built here.
import { store, api } from './store.ts';
import type { Playlist, Track } from './store.ts';
import { player } from './player.ts';
import { tr } from './i18n.ts';
import { toast, ask } from './feedback.ts';
import type { MenuEntry } from './feedback.ts';
import { norm, songs, safeHttp } from './format.ts';
import { go } from './router.ts';
import { STANDALONE } from './env.ts';
import { offline } from './offline.ts';

export const artistHref = (name: string): string => '/artist/' + encodeURIComponent(norm(name));
export const albumHref = (key: string): string => '/album/' + encodeURIComponent(key);
export const playlistHref = (id: string): string => '/playlist/' + id;

export async function toggleFav(track: Track): Promise<void> {
  try {
    const fav = await store.toggleFav(track);
    toast(fav ? tr('“{title}” added to favorites', { title: track.title }) : tr('Removed from favorites'));
  } catch (e) { toast((e as Error).message, { error: true }); }
}

async function addToPlaylist(p: Playlist, tracks: Track[]): Promise<void> {
  const have = new Set(p.tracks.map((t) => t.id));
  const fresh = tracks.filter((t) => !have.has(t.id) && !t.live);
  if (!fresh.length) { toast(tr('Already in playlist “{name}”', { name: p.name })); return; }
  await store.updatePlaylist(p.id, { add: fresh });
  toast(fresh.length === 1 ? tr('Added to “{name}”', { name: p.name }) : tr('{n} added to “{name}”', { n: songs(fresh.length), name: p.name }));
}

async function addAllToPlaylist(tracks: Track[]): Promise<void> {
  const options = store.playlists.map((p) => p.name).join(', ');
  const name = await ask(tr('Add to playlist'), { placeholder: options ? tr('Existing ({list}) or new', { list: options }) : tr('New playlist name'), confirm: tr('Add') });
  if (!name) return;
  const existing = store.playlists.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) { await addToPlaylist(existing, tracks); return; }
  const p = await store.createPlaylist(name, tracks.filter((t) => !t.live));
  toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go(playlistHref(p.id)) });
}

export async function newPlaylist(tracks: Track[] = []): Promise<Playlist | null> {
  const name = await ask(tr('New playlist'), { placeholder: tr('Playlist name'), confirm: tr('Create') });
  if (!name) return null;
  return store.createPlaylist(name, tracks);
}

function openArtist(track: Track): void {
  const artist = track.artist || '';
  if (track.artistRef?.startsWith('audius:') && !store.index.artistMap.has(norm(artist))) {
    go('/audius/' + encodeURIComponent(track.artistRef.slice(7)));
    return;
  }
  const key = norm(track.albumArtist || artist);
  if (store.index.artistMap.has(key)) go(artistHref(track.albumArtist || artist));
  else if (store.index.artistMap.has(norm(artist))) go(artistHref(artist));
  else go('/search?q=' + encodeURIComponent(artist));
}

function openAlbum(track: Track): void {
  if (track.source === 'archive') { go('/archive/' + encodeURIComponent(track.id.slice(3).split('/')[0])); return; }
  const key = norm(track.albumArtist || track.artist || tr('Unknown artist')) + '|' + norm(track.album);
  if (store.index.albumMap.has(key)) go(albumHref(key));
  else go('/search?q=' + encodeURIComponent(track.album || ''));
}

// Keeps songs on this device for listening without a connection (a trip): they stay until
// removed. Radio and SoundCloud can't be kept.
export async function downloadTracks(tracks: Track[]): Promise<void> {
  const n = await offline.pin(tracks);
  if (!n) { toast(tr('These songs can\'t be downloaded'), { error: true }); return; }
  toast(tr('Downloading {n}…', { n: songs(n) }), { action: tr('Downloads'), onAction: () => go('/downloads') });
}

export async function removeDownloads(tracks: Track[]): Promise<void> {
  await offline.unpin(tracks.map((t) => t.id));
  toast(tr('Removed from downloads'));
}

async function saveToLibrary(tracks: Track[]): Promise<void> {
  const list = tracks.filter((t) => t.download);
  if (!list.length) { toast(tr('The source doesn\'t allow downloading these songs'), { error: true }); return; }
  toast(list.length === 1 ? tr('Saving “{title}” to your computer…', { title: list[0].title }) : tr('Saving {n} to your computer…', { n: songs(list.length) }));
  let ok = 0;
  for (const t of list) {
    try { await api('/api/download', { method: 'POST', body: { track: t } }); ok++; }
    catch (e) { toast(`„${t.title}”: ${(e as Error).message}`, { error: true }); }
  }
  if (ok) toast(ok === 1 ? tr('Saved to library') : tr('{n} saved to library', { n: songs(ok) }), { action: tr('View'), onAction: () => go('/songs') });
}

export function trackMenu(track: Track, { playlist, index, list }: { playlist?: Playlist | null; index?: number; list?: Track[] } = {}): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (!track.live) {
    items.push({ label: tr('Play next'), icon: 'next', action: () => { player.playNext(track); toast(tr('“{title}” plays next', { title: track.title })); } });
    items.push({ label: tr('Add to queue'), icon: 'queue', action: () => { player.addToQueue(track); toast(tr('Added to queue')); } });
    items.push({
      label: tr('Add to playlist'),
      items: [
        { label: tr('New playlist…'), icon: 'plus', action: async () => {
          const p = await newPlaylist([track]);
          if (p) toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go(playlistHref(p.id)) });
        } },
        store.playlists.length ? '-' : null,
        ...store.playlists.map((p) => ({ label: p.name, action: () => { addToPlaylist(p, [track]); } })),
      ],
    });
    items.push('-');
  }
  const fav = store.isFav(track.id);
  items.push({ label: fav ? tr('Remove from favorites') : tr('Add to favorites'), icon: fav ? 'heartFill' : 'heart', action: () => { toggleFav(track); } });
  if (track.live) {
    items.push({ label: store.isStation(track.id) ? tr('Remove from my stations') : tr('Save station'), icon: 'radio', action: () => { store.toggleStation(track); } });
  } else {
    if (track.artist) items.push({ label: tr('Go to artist'), icon: 'artist', action: () => openArtist(track) });
    if (track.album) items.push({ label: tr('Go to album'), icon: 'album', action: () => openAlbum(track) });
  }
  if (offline.supported && offline.pinnable(track)) {
    items.push(offline.isPinned(track.id) || offline.isPinning(track.id)
      ? { label: tr('Remove download'), icon: 'trash', action: () => { removeDownloads([track]); } }
      : { label: tr('Download'), icon: 'download', action: () => { downloadTracks([track]); } });
  }
  if (track.download && !STANDALONE) items.push({ label: tr('Save to computer'), icon: 'download', action: () => { saveToLibrary([track]); } });
  const link = safeHttp(track.link);
  if (link) items.push({ label: tr('Open on source website'), icon: 'external', action: () => { window.open(link, '_blank', 'noopener'); } });
  if (playlist && index !== undefined) {
    items.push('-');
    items.push({ label: tr('Remove from this playlist'), icon: 'trash', action: async () => {
      const tracks = playlist.tracks.slice();
      tracks.splice(index, 1);
      await store.updatePlaylist(playlist.id, { tracks });
      toast(tr('Removed from playlist'));
    } });
  }
  if (list && !playlist && list.length > 1 && !track.live) {
    items.push('-');
    items.push({ label: tr('Add whole list to playlist…'), icon: 'plus', action: () => { addAllToPlaylist(list); } });
  }
  return items;
}

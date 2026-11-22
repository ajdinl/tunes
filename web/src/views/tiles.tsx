// Tiles for the cover grids, shared by several screens.
import { Icon } from '../components/Icon.tsx';
import type { Tile } from '../components/common.tsx';
import { tr, plural } from '../lib/i18n.ts';
import { songs } from '../lib/format.ts';
import { player } from '../lib/player.ts';
import { api } from '../lib/store.ts';
import type { Album, Artist, Track } from '../lib/store.ts';
import { toast } from '../lib/feedback.ts';
import { artistHref, albumHref } from '../lib/actions.ts';

export interface AudiusArtist { id: string; name: string; handle: string; followers: number; trackCount: number; bio: string; cover: string | null; link: string }
export interface ArchiveResult { id: string; identifier: string; title: string; artist: string; year: string | null; cover: string }
export interface ArchiveAlbum { title: string; artist: string; year: string | null; description: string; cover: string; link: string; license?: string | null }

export function artistTile(a: Artist): Tile {
  return {
    key: a.key, title: a.name, sub: songs(a.tracks.length), href: artistHref(a.name), cover: a.cover,
    play: () => player.playList(a.tracks, -1, { shuffle: true, context: { label: a.name, href: artistHref(a.name) } }),
  };
}

export function albumTile(b: Album): Tile {
  return {
    key: b.key, title: b.title, sub: [b.artist, b.year].filter(Boolean).join(', '), href: albumHref(b.key), cover: b.cover,
    play: () => player.playList(b.tracks, 0, { shuffle: false, context: { label: b.title, href: albumHref(b.key) } }),
  };
}

export function audiusArtistTile(a: AudiusArtist): Tile {
  return { key: a.id, title: a.name, sub: plural(a.followers, 'follower', 'followers'), href: '/audius/' + encodeURIComponent(a.id), cover: a.cover };
}

export function archiveTile(x: ArchiveResult): Tile {
  return {
    key: x.identifier, title: x.title, sub: [x.artist, x.year].filter(Boolean).join(', '),
    href: '/archive/' + encodeURIComponent(x.identifier), cover: x.cover,
    play: async () => {
      try {
        const d = await api<{ album: ArchiveAlbum; tracks: Track[] }>('/api/archive/item/' + encodeURIComponent(x.identifier));
        if (!d.tracks.length) { toast(tr('This release has no recordings your browser can play'), { error: true }); return; }
        player.playList(d.tracks, 0, { shuffle: false, context: { label: d.album.title, href: '/archive/' + x.identifier } });
      } catch (e) { toast((e as Error).message, { error: true }); }
    },
  };
}

// Empty artists/albums/songs screens: what the collection is and where to get music.
export function EmptyCollection({ text }: { text: string }) {
  return (
    <div className="note">
      <p>{text}{tr(' Your collection is the songs on this computer plus everything you heart online.')}</p>
      <div className="row">
        <a className="btn" href="/discover"><Icon name="compass" size={16} />{tr('Discover music')}</a>
        <a className="btn btn--ghost" href="/settings"><Icon name="folder" size={16} />{tr('Folders')}</a>
      </div>
    </div>
  );
}

// "Download" for a whole list (album, playlist, favorites): keeps its songs on this device
// for listening without a connection. Shows progress, then "Downloaded" (a tap removes them).
import { Icon } from './Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { offline, useOffline } from '../lib/offline.ts';
import { downloadTracks, removeDownloads } from '../lib/actions.ts';
import type { Track } from '../lib/store.ts';

export function DownloadButton({ tracks }: { tracks: Track[] }) {
  useOffline();
  const list = tracks.filter((t) => offline.pinnable(t));
  if (!offline.supported || !list.length) return null;
  const have = list.filter((t) => offline.isPinned(t.id)).length;
  const busy = list.some((t) => offline.isPinning(t.id));
  if (have === list.length) {
    return (
      <button type="button" className="btn btn--ghost is-on" aria-pressed="true" title={tr('Remove download')} onClick={() => { removeDownloads(list); }}>
        <Icon name="downloaded" size={16} />{tr('Downloaded')}
      </button>
    );
  }
  return (
    <button type="button" className="btn btn--ghost" aria-pressed="false" onClick={() => { downloadTracks(list); }}>
      <Icon name="download" size={16} />{busy ? `${tr('Downloading…')} ${have}/${list.length}` : tr('Download')}
    </button>
  );
}

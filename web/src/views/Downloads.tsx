// Songs kept on this device for listening without a connection (a trip, a flight), newest
// first. The list comes from the device itself, so it also works offline.
import { Header, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { songs } from '../lib/format.ts';
import { offline, useOffline, fmtSize } from '../lib/offline.ts';
import { removeDownloads } from '../lib/actions.ts';
import { ask } from '../lib/feedback.ts';
import { IS_IOS } from '../lib/install.ts';
import type { Route } from '../lib/router.ts';

// Safari may delete a website's data after a week without use; a Home Screen app keeps it.
const HOME_SCREEN = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function Downloads(_: { route: Route }) {
  useOffline();
  const list = offline.pinned().map((m) => m.track!);
  const waiting = offline.pins.filter((t) => !offline.isPinned(t.id)).length;
  const ctx = { label: tr('Downloads'), href: '/downloads' };
  const removeAll = async () => {
    if (await ask(tr('Remove all downloaded songs from this device?'), { input: false, confirm: tr('Remove all downloads'), danger: true })) removeDownloads([...list, ...offline.pins]);
  };
  return (
    <div className="view">
      <Header title={tr('Downloads')}
        meta={list.length ? `${songs(list.length)}, ${fmtSize(offline.pinnedBytes)}` : null}
        actions={[...playButtons(list, ctx),
          list.length || waiting ? <button key="remove" type="button" className="btn btn--ghost" onClick={removeAll}><Icon name="trash" size={16} />{tr('Remove all downloads')}</button> : null]} />
      {waiting ? <p className="muted pad" aria-live="polite">{tr('Downloading {n}…', { n: songs(waiting) })}</p> : null}
      {IS_IOS && !HOME_SCREEN ? <p className="muted pad">{tr('On iPhone, add Tunes to your Home Screen, or Safari may delete downloads after a week without use.')}</p> : null}
      <TrackList tracks={list} context={ctx}
        emptyText={tr('Nothing downloaded yet. Use Download on a song, album or playlist, and it plays without a connection.')} />
    </div>
  );
}

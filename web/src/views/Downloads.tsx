// Songs kept on this device for listening without a connection (a trip, a flight). The list
// comes from the device itself, so it also works offline. Sort it with one tap, search it,
// or choose "My order" and arrange the songs by their handles (no playlist needed).
import { useMemo, useState } from 'react';

import { Header, FilterInput, Chips, playButtons } from '../components/common.tsx';
import type { ChipOption } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { tr } from '../lib/i18n.ts';
import { norm, songs } from '../lib/format.ts';
import { offline, useOffline, fmtSize } from '../lib/offline.ts';
import { removeDownloads } from '../lib/actions.ts';
import { ask } from '../lib/feedback.ts';
import { IS_IOS } from '../lib/install.ts';
import type { Track } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';

type Sort = 'recent' | 'mine' | 'title' | 'artist';
const SORTS: ChipOption<Sort>[] = [
  { value: 'recent', label: 'Recently downloaded' }, { value: 'mine', label: 'My order' },
  { value: 'title', label: 'Title' }, { value: 'artist', label: 'Artist' },
];
const SORT_KEY = 'tunes.downloads.sort';
const ORDER_KEY = 'tunes.downloads.order';
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const keep = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full */ } };

// Safari may delete a website's data after a week without use; a Home Screen app keeps it.
const HOME_SCREEN = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function Downloads(_: { route: Route }) {
  useOffline();
  const [sort, setSortState] = useState<Sort>(() => { const s = load<string>(SORT_KEY, ''); return SORTS.find((o) => o.value === s)?.value ?? 'recent'; });
  const [order, setOrder] = useState<string[]>(() => load<string[]>(ORDER_KEY, []));
  const [filter, setFilter] = useState('');
  const setSort = (s: Sort) => { setSortState(s); keep(SORT_KEY, s); };

  const recent = offline.pinned().map((m) => m.track!);
  const list = useMemo(() => {
    let out: Track[];
    if (sort === 'mine') {
      // Songs in the saved order first; newer downloads follow at the end.
      const pos = new Map(order.map((id, i) => [id, i]));
      out = recent.slice().sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
    } else if (sort === 'title') out = recent.slice().sort((a, b) => a.title.localeCompare(b.title, 'sr'));
    else if (sort === 'artist') out = recent.slice().sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'sr') || a.title.localeCompare(b.title, 'sr'));
    else out = recent;
    if (filter) { const f = norm(filter); out = out.filter((t) => norm(`${t.title} ${t.artist || ''} ${t.album || ''}`).includes(f)); }
    return out;
  }, [recent.map((t) => t.id).join(), sort, order, filter]);

  const reorder = (from: number, to: number) => {
    const ids = list.map((t) => t.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    setOrder(ids);
    keep(ORDER_KEY, ids);
  };

  const waiting = offline.pins.filter((t) => !offline.isPinned(t.id)).length;
  const ctx = { label: tr('Downloads'), href: '/downloads' };
  const removeAll = async () => {
    if (await ask(tr('Remove all downloaded songs from this device?'), { input: false, confirm: tr('Remove all downloads'), danger: true })) removeDownloads([...recent, ...offline.pins]);
  };
  return (
    <div className="view">
      <Header title={tr('Downloads')}
        meta={recent.length ? `${songs(recent.length)}, ${fmtSize(offline.pinnedBytes)}` : null}
        actions={[...playButtons(list, ctx),
          recent.length || waiting ? <button key="remove" type="button" className="btn btn--ghost" onClick={removeAll}><Icon name="trash" size={16} />{tr('Remove all downloads')}</button> : null]} />
      {waiting ? <p className="muted pad" aria-live="polite">{tr('Downloading {n}…', { n: songs(waiting) })}</p> : null}
      {IS_IOS && !HOME_SCREEN ? <p className="muted pad">{tr('On iPhone, add Tunes to your Home Screen, or Safari may delete downloads after a week without use.')}</p> : null}
      {recent.length > 1 ? (
        <div className="toolbar">
          <FilterInput placeholder={tr('Search downloads')} onChange={setFilter} />
          <Chips options={SORTS} value={sort} onPick={setSort} label={tr('Sort')} />
        </div>
      ) : null}
      {sort === 'mine' && !filter && list.length > 1 ? <p className="muted pad">{tr('Drag a song by its handle to change the order.')}</p> : null}
      <TrackList tracks={list} context={ctx} onReorder={sort === 'mine' && !filter ? reorder : undefined}
        emptyText={filter ? tr('No songs match this filter.') : tr('Nothing downloaded yet. Use Download on a song, album or playlist, and it plays without a connection.')} />
    </div>
  );
}

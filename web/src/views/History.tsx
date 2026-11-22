// Listening history: top artists of the last 30 days and plays grouped by day.
import type { CSSProperties } from 'react';

import { Header, Section } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Icon } from '../components/Icon.tsx';
import { tr, plural, locale } from '../lib/i18n.ts';
import { fmtDuration, norm, relDay, songs } from '../lib/format.ts';
import { store, useStore } from '../lib/store.ts';
import type { HistoryEntry } from '../../../lib/types.ts';
import { toast, ask } from '../lib/feedback.ts';
import { artistHref } from '../lib/actions.ts';
import type { Route } from '../lib/router.ts';

type Item = HistoryEntry & { n: number };

export function History(_: { route: Route }) {
  useStore('history', 'library', 'favorites', 'settings');
  const hist = store.history.slice().reverse();
  const weekAgo = Date.now() - 7 * 864e5;
  const week = hist.filter((x) => x.at >= weekAgo);
  const weekTime = week.reduce((s, x) => s + (x.track.live ? 0 : x.track.duration || 0), 0);

  const clear = async () => {
    if (await ask(tr('Delete your whole listening history?'), { input: false, confirm: tr('Delete'), danger: true })) {
      await store.clearHistory();
      toast(tr('History deleted'));
    }
  };

  const header = (
    <Header title={tr('Listening history')}
      meta={hist.length ? tr('Last 7 days: {n}', { n: songs(week.length) }) + (weekTime ? ', ' + tr('{d} of music', { d: fmtDuration(weekTime) }) : '') : null}
      actions={hist.length ? [
        store.settings.hasListenbrainz
          ? <a key="lb" className="btn btn--ghost" href="https://listenbrainz.org/my/listens/" target="_blank" rel="noopener"><Icon name="external" size={16} />{tr('Stats on ListenBrainz')}</a>
          : null,
        <button key="clear" type="button" className="btn btn--ghost" onClick={clear}><Icon name="trash" size={16} />{tr('Delete history')}</button>,
      ] : []} />
  );

  if (!hist.length) {
    return (
      <div className="view">
        {header}
        <p className="empty">{tr('A song is added to history once you\'ve heard at least half of it (or 4 minutes). Radio stations after 30 seconds.')}</p>
      </div>
    );
  }

  // Most played artists in the last 30 days
  const monthAgo = Date.now() - 30 * 864e5;
  const counts = new Map<string, number>();
  for (const x of hist) {
    if (x.at < monthAgo || x.track.live) continue;
    const name = x.track.artist || tr('Unknown');
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top.length ? top[0][1] : 1;

  // By day (first 400 plays)
  const groups = new Map<string, HistoryEntry[]>();
  for (const x of hist.slice(0, 400)) {
    const k = relDay(x.at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(x);
  }
  // Like YouTube: a song appears once per day (at its latest play), with the number of plays.
  const days = [...groups].map(([day, all]) => {
    const items: Item[] = [];
    const byId = new Map<string, Item>();
    for (const x of all) {
      const seen = byId.get(x.track.id);
      if (seen) { seen.n++; continue; }
      const item = { ...x, n: 1 };
      byId.set(x.track.id, item);
      items.push(item);
    }
    return { day, items };
  });

  return (
    <div className="view">
      {header}
      {top.length ? (
        <Section title={tr('Top artists in the last 30 days')}>
          <ol className="rank">
            {top.map(([name, n]) => (
              <li className="rank__item" key={name}>
                {store.index.artistMap.has(norm(name))
                  ? <a className="rank__name" href={artistHref(name)}>{name}</a>
                  : <span className="rank__name">{name}</span>}
                <span className="rank__bar" style={{ '--w': (n / max * 100).toFixed(1) + '%' } as CSSProperties} aria-hidden="true" />
                <span className="rank__n">{plural(n, 'play', 'plays')}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      {days.map(({ day, items }) => (
        <Section key={day} title={day}>
          <TrackList tracks={items.map((x) => x.track)} context={{ label: tr('History'), href: '/history' }}
            leading={(_t, i) => {
              const time = new Date(items[i].at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
              const n = items[i].n;
              return n > 1
                ? <span className="hist__lead" title={tr('Played {n} times this day', { n })}>{time}<small className="hist__n">{n + '×'}</small></span>
                : time;
            }} />
        </Section>
      ))}
    </div>
  );
}

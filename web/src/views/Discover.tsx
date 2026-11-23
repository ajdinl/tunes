// Discover: popular on Audius and hearthis.at, Internet Archive collections, Jamendo.
import { useEffect, useState } from 'react';

import { Header, ChipPicker, Grid, Loading, ErrorBox } from '../components/common.tsx';
import type { ChipOption } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { archiveTile } from './tiles.tsx';
import type { ArchiveResult } from './tiles.tsx';
import { tr } from '../lib/i18n.ts';
import { byKind } from '../lib/format.ts';
import { store, useStore, api } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';
import { STANDALONE } from '../lib/env.ts';
import { useLook } from '../lib/look.ts';
import { Tabs } from '../components/controls.tsx';

const AUDIUS_GENRES = ['', 'Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'Alternative', 'Rock', 'Pop', 'R&B/Soul', 'Jazz', 'Ambient', 'House', 'Techno', 'Classical', 'Acoustic', 'Experimental'];
const IA_PRESETS: ChipOption[] = [
  { value: 'collection:etree', label: 'Live Music Archive' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'classical OR symphony', label: 'Classical' },
  { value: 'collection:78rpm', label: '78 rpm records' },
  { value: 'collection:netlabels AND (electronic OR ambient)', label: 'Netlabel electronic' },
  { value: 'blues', label: 'Blues' },
];
const JAMENDO_TAGS = ['', 'pop', 'rock', 'electronic', 'jazz', 'lounge', 'classical', 'hiphop', 'world', 'soundtrack'];
const HEARTHIS_GENRES: ChipOption[] = [
  { value: '', label: 'All genres' }, { value: 'afrohouse', label: 'Afro House' }, { value: 'amapiano', label: 'Amapiano' },
  { value: 'house', label: 'House' }, { value: 'deephouse', label: 'Deep House' }, { value: 'techno', label: 'Techno' },
  { value: 'drumandbass', label: 'Drum & Bass' }, { value: 'hiphop', label: 'Hip Hop' }, { value: 'chillout', label: 'Chillout' },
];
// Jamendo needs a key, which the phone-only version doesn't ask for.
const ALL_TABS = [
  { value: 'audius', label: 'Audius' },
  { value: 'hearthis', label: 'hearthis.at' },
  { value: 'archive', label: 'Internet Archive' },
  ...(STANDALONE ? [] : [{ value: 'jamendo', label: 'Jamendo' }]),
];
// The tabs whose source isn't turned off in Settings → Music sources.
export const discoverTabs = (hidden: string[]) => ALL_TABS.filter((t) => !hidden.includes(t.value));

type Load<T> = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'done'; value: T };

// Fetches whenever the url (or the retry counter) changes; stale answers are dropped.
// An answer for another url counts as loading, so a chip click shows the spinner right away.
function useFetch<T>(url: string): [Load<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [res, setRes] = useState<{ key: string; load: Load<T> }>({ key: '', load: { state: 'loading' } });
  const key = url + '#' + attempt;
  useEffect(() => {
    let cancelled = false;
    api<T>(url)
      .then((value) => { if (!cancelled) setRes({ key, load: { state: 'done', value } }); })
      .catch((e: Error) => { if (!cancelled) setRes({ key, load: { state: 'error', msg: e.message } }); });
    return () => { cancelled = true; };
  }, [url, key]);
  return [res.key === key ? res.load : { state: 'loading' }, () => setAttempt((n) => n + 1)];
}

export function Discover({ route }: { route: Route }) {
  const tabs = discoverTabs(useLook().hide);
  const asked = route.params.get('source');
  const tab = tabs.find((t) => t.value === asked)?.value ?? tabs[0]?.value;
  return (
    <div className="view">
      <Header title={tr('Discover')} meta={tr('Free and legal music: artists who share it themselves, archives and Creative Commons.')} />
      <Tabs value={tab} tabs={tabs.map((t) => ({ ...t, href: '/discover?source=' + t.value }))} />
      <div>
        {tab === 'audius' && <AudiusTab />}
        {tab === 'hearthis' && <HearthisTab />}
        {tab === 'archive' && <ArchiveTab />}
        {tab === 'jamendo' && <JamendoTab />}
        {!tab && <p className="empty">{tr('All sources of this page are turned off. Turn them on in Settings → Music sources.')}</p>}
      </div>
    </div>
  );
}

function AudiusTab() {
  const [genre, setGenre] = useState('');
  const [time, setTime] = useState('week');
  const [kind, setKind] = useState('all');
  const [res, retry] = useFetch<Track[]>(`/api/audius/trending?genre=${encodeURIComponent(genre)}&time=${time}`);
  return (
    <>
      <div className="toolbar">
        <ChipPicker options={[{ value: 'all', label: 'All' }, { value: 'songs', label: 'Songs' }, { value: 'sets', label: 'Sets & mixes' }]}
          initial="all" onPick={setKind} label={tr('Category')} />
      </div>
      <div className="toolbar">
        <ChipPicker options={AUDIUS_GENRES.map((g) => ({ value: g, label: g || 'All genres' }))} initial="" onPick={setGenre} label={tr('Genre')} />
      </div>
      <div className="toolbar">
        <ChipPicker options={[{ value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }, { value: 'allTime', label: 'All time' }]}
          initial="week" onPick={setTime} label={tr('Period')} />
      </div>
      <div>
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorBox msg={tr('Audius isn\'t responding: ') + res.msg} retry={retry} />}
        {res.state === 'done' && (
          <TrackList tracks={res.value.filter(byKind(kind))} context={{ label: 'Audius' + (genre ? ', ' + genre : ''), href: '/discover' }}
            emptyText={kind === 'sets' ? tr('No sets among the popular tracks. Try searching “set” or “mix”.') : tr('No songs.')} />
        )}
      </div>
    </>
  );
}

function HearthisTab() {
  const [genre, setGenre] = useState('');
  const [res, retry] = useFetch<Track[]>('/api/hearthis/popular?genre=' + encodeURIComponent(genre));
  const label = HEARTHIS_GENRES.find((g) => g.value === genre)?.label;
  return (
    <>
      <p className="muted pad">{tr('DJ mixes and electronic music, shared by the DJs and producers themselves.')}</p>
      <div className="toolbar">
        <ChipPicker options={HEARTHIS_GENRES} initial="" onPick={setGenre} label={tr('Genre')} />
      </div>
      <div>
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorBox msg={tr('hearthis.at isn\'t responding: ') + res.msg} retry={retry} />}
        {res.state === 'done' && <TrackList tracks={res.value} context={{ label: 'hearthis.at' + (genre ? ', ' + label : ''), href: '/discover?source=hearthis' }} />}
      </div>
    </>
  );
}

function ArchiveTab() {
  const [q, setQ] = useState(IA_PRESETS[0].value);
  const [res, retry] = useFetch<ArchiveResult[]>('/api/archive/search?q=' + encodeURIComponent(q));
  return (
    <>
      <p className="muted pad">{tr('Concert recordings shared with the artists\' permission, netlabel releases and old public-domain recordings. You can save all of it to your computer.')}</p>
      <div className="toolbar">
        <ChipPicker options={IA_PRESETS} initial={IA_PRESETS[0].value} onPick={setQ} label={tr('Collection')} />
      </div>
      <div>
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorBox msg={tr('Internet Archive isn\'t responding: ') + res.msg} retry={retry} />}
        {res.state === 'done' && (res.value.length ? <Grid items={res.value.map(archiveTile)} /> : <p className="empty">{tr('No results.')}</p>)}
      </div>
    </>
  );
}

function JamendoTab() {
  useStore('settings');
  if (!store.settings.hasJamendo) {
    return (
      <div className="note">
        <h2>{tr('Turn on Jamendo')}</h2>
        <p>{tr('Jamendo has hundreds of thousands of Creative Commons songs, many of them downloadable. You need a free key:')}</p>
        <ol>
          <li>{tr('Create an account at ')}<a href="https://devportal.jamendo.com" target="_blank" rel="noopener">devportal.jamendo.com</a>.</li>
          <li>{tr('Click “Create a new app” and copy the Client ID.')}</li>
          <li>{tr('Paste it in Settings, under Jamendo.')}</li>
        </ol>
        <a className="btn" href="/settings">{tr('Open settings')}</a>
      </div>
    );
  }
  return <JamendoList />;
}

function JamendoList() {
  const [tag, setTag] = useState('');
  const [res, retry] = useFetch<Track[]>('/api/jamendo/popular?tag=' + encodeURIComponent(tag));
  return (
    <>
      <div className="toolbar">
        <ChipPicker options={JAMENDO_TAGS.map((x) => ({ value: x, label: x || 'All' }))} initial="" onPick={setTag} label={tr('Genre')} />
      </div>
      <div>
        {res.state === 'loading' && <Loading />}
        {res.state === 'error' && <ErrorBox msg={res.msg} retry={retry} />}
        {res.state === 'done' && <TrackList tracks={res.value} context={{ label: 'Jamendo', href: '/discover?source=jamendo' }} />}
      </div>
    </>
  );
}

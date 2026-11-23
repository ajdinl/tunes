// Search: your collection first, then the online sources. A pasted SoundCloud link opens that song, set or artist.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Icon } from '../components/Icon.tsx';
import { Section, Chips, Grid, Loading, ErrorBox } from '../components/common.tsx';
import type { ChipOption } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { StationGrid } from '../components/StationGrid.tsx';
import { artistTile, albumTile, audiusArtistTile, archiveTile } from './tiles.tsx';
import type { AudiusArtist, ArchiveResult } from './tiles.tsx';
import { tr } from '../lib/i18n.ts';
import { SOURCES, byKind, cx } from '../lib/format.ts';
import { player } from '../lib/player.ts';
import { store, useStore, api } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import { replaceUrl } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { findSoundCloudUrl } from '../lib/soundcloud.ts';
import { getLook, useLook } from '../lib/look.ts';

// The online sources you picked are remembered while the app is open.
let lastSources = ['audius', 'hearthis', 'archive', 'radio', 'jamendo'];

type Kind = 'all' | 'songs' | 'sets' | 'albums' | 'artists' | 'radio';
const KINDS: ChipOption<Kind>[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'sets', label: 'Sets & mixes' },
  { value: 'albums', label: 'Albums & concerts' },
  { value: 'artists', label: 'Artists' },
  { value: 'radio', label: 'Radio stations' },
];
// Which online sources each category needs.
const KIND_SOURCES: Record<Kind, string[]> = {
  all: ['audius', 'artists', 'hearthis', 'archive', 'radio', 'jamendo'],
  songs: ['audius', 'hearthis', 'jamendo'],
  sets: ['audius', 'hearthis', 'jamendo'],
  albums: ['archive'],
  artists: ['artists'],
  radio: ['radio'],
};
const HINTS = ['lofi', 'jazz', 'techno set', 'boiler room', 'Grateful Dead', 'ambient', 'Sarajevo radio'];

interface Block { items?: unknown[]; error?: string }
type BlockKey = 'artists' | 'audius' | 'hearthis' | 'jamendo' | 'archive' | 'radio';
type SearchData = Partial<Record<BlockKey, Block>>;
type Online =
  | { state: 'idle' }
  | { state: 'nosrc' }
  | { state: 'loading' }
  | { state: 'error'; msg: string }
  | { state: 'done'; data: SearchData };

const isKind = (v: string | null): v is Kind => KINDS.some((k) => k.value === v);

export function Search({ route }: { route: Route }) {
  // The address is read once; after that the screen owns its state and keeps the address in sync.
  const [init] = useState(() => {
    const type = route.params.get('type');
    return { q: route.params.get('q') || '', kind: isKind(type) ? type : 'all' as Kind };
  });
  const [input, setInput] = useState(init.q);
  const [query, setQuery] = useState(init.q.trim());
  const [kind, setKind] = useState<Kind>(init.kind);
  const [sources, setSources] = useState<string[]>(lastSources);
  const [online, setOnline] = useState<Online>({ state: 'idle' });
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useStore('library', 'favorites', 'settings');
  const look = useLook();

  function run(raw: string, force = false, k: Kind = kind, srcs: string[] = sources): void {
    const q = raw.trim();
    const my = ++token.current;
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (k !== 'all') qs.set('type', k);
    replaceUrl('/search' + (qs.toString() ? '?' + qs : ''));
    setQuery(q);
    setKind(k);
    clearTimeout(timer.current);
    if (!q || findSoundCloudUrl(q)) { setOnline({ state: 'idle' }); return; }
    const hidden = getLook().hide;
    const src = KIND_SOURCES[k].filter((x) => { const s = x === 'artists' ? 'audius' : x; return srcs.includes(s) && !hidden.includes(s); });
    if (!src.length) { setOnline({ state: 'nosrc' }); return; }
    setOnline({ state: 'idle' });
    timer.current = setTimeout(async () => {
      setOnline({ state: 'loading' });
      let data: SearchData;
      try { data = await api<SearchData>('/api/search?q=' + encodeURIComponent(q) + '&src=' + src.join(',') + '&type=' + k); }
      catch (e) { if (my === token.current) setOnline({ state: 'error', msg: (e as Error).message }); return; }
      if (my !== token.current) return;
      setOnline({ state: 'done', data });
    }, force ? 0 : 450);
  }

  // Runs once on mount: the first search from the address.
  useEffect(() => {
    run(init.q, true);
    return () => { clearTimeout(timer.current); token.current++; };
  }, []);

  const toggleSource = (s: string) => {
    const next = sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s];
    lastSources = next;
    setSources(next);
    run(input, true, kind, next);
  };

  const collection = store.collection;
  const local = useMemo(() => (query ? store.searchLocal(query) : null), [query, collection]);

  const qs = new URLSearchParams();
  if (query) qs.set('q', query);
  if (kind !== 'all') qs.set('type', kind);
  const here = '/search?' + qs;
  const scUrl = query ? findSoundCloudUrl(query) : null;

  let body: ReactNode;
  if (!query) {
    body = (
      <div className="hints">
        <p className="muted">{tr('Try one of these:')}</p>
        <div className="chips">
          {HINTS.map((x) => <button key={x} type="button" className="chip" onClick={() => { setInput(x); run(x); }}>{x}</button>)}
        </div>
        <p className="muted">{tr('You can also paste a SoundCloud link to a song, set or artist.')}</p>
      </div>
    );
  } else if (scUrl) {
    body = <SoundCloudResult key={query} url={scUrl} here={here} />;
  } else if (local) {
    const localTracks = local.tracks.filter(byKind(kind));
    const showArtists = ['all', 'artists'].includes(kind) && local.artists.length > 0;
    const showAlbums = ['all', 'albums'].includes(kind) && local.albums.length > 0;
    const showTracks = ['all', 'songs', 'sets'].includes(kind) && localTracks.length > 0;
    const shown = showArtists || showAlbums || showTracks;
    body = (
      <>
        {showArtists && (
          <Section title={tr('Artists in your collection')}><Grid items={local.artists.slice(0, 12).map(artistTile)} round /></Section>
        )}
        {showAlbums && (
          <Section title={tr('Albums in your collection')}><Grid items={local.albums.slice(0, 12).map(albumTile)} /></Section>
        )}
        {showTracks && (
          <Section title={kind === 'sets' ? tr('Sets in your collection') : tr('Songs in your collection')}>
            <TrackList tracks={localTracks.slice(0, 50)} context={{ label: tr('Search “{q}”', { q: query }), href: here }} />
          </Section>
        )}
        {!shown && store.collection.length > 0 && kind !== 'radio' && <p className="muted pad">{tr('Nothing in your collection for “{q}”. Online results are coming below.', { q: query })}</p>}
        <div className="online">
          <OnlineResults online={online} q={query} kind={kind} here={here} retry={() => run(query, true)} />
        </div>
        {/* SoundCloud can't be searched without a paid API key: search on their site, paste the link here. */}
        {kind !== 'radio' && (
          <p className="muted pad scsearch"><Icon name="cloud" size={16} />{tr('Looking for something on SoundCloud? ')}
            <a href={'https://soundcloud.com/search?q=' + encodeURIComponent(query)} target="_blank" rel="noopener">{tr('Search on SoundCloud')}</a>
            {tr(', copy the link of a song, set or artist and paste it here.')}</p>
        )}
      </>
    );
  }

  const onlineSrc = ['audius', 'hearthis', 'archive', 'radio'].concat(store.settings.hasJamendo ? ['jamendo'] : []).filter((s) => !look.hide.includes(s));
  // Radio turned off in Settings → Music sources: no radio category either (your collection has no stations).
  const kinds = look.hide.includes('radio') ? KINDS.filter((x) => x.value !== 'radio') : KINDS;

  return (
    <div className="view">
      <div className="searchbar">
        <Icon name="search" size={22} />
        <input className="field field--search" type="search" value={input} placeholder={tr('Song, set, artist, album, station…')}
          aria-label={tr('Search')} autoFocus
          onChange={(e) => { setInput(e.target.value); run(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { clearTimeout(timer.current); run(e.currentTarget.value, true); } }} />
      </div>
      <div className="searchsrc">
        <span className="muted">{tr('Show:')}</span>
        <Chips options={kinds} value={kind} onPick={(v) => run(input, true, v)} label={tr('Category')} />
      </div>
      {onlineSrc.length > 0 && <div className="searchsrc">
        <span className="muted">{tr('Also search:')}</span>
        <div className="chips" role="group" aria-label={tr('Online sources')}>
          {onlineSrc.map((s) => {
            const on = sources.includes(s);
            return (
              <button key={s} type="button" className={cx('chip', on && 'is-on', 'chip--' + s)} aria-pressed={on} title={tr(SOURCES[s].about)}
                onClick={() => toggleSource(s)}>{tr(SOURCES[s].name)}</button>
            );
          })}
        </div>
      </div>}
      <div className="results">{body}</div>
    </div>
  );
}

function OnlineResults({ online, q, kind, here, retry }: { online: Online; q: string; kind: Kind; here: string; retry: () => void }) {
  if (online.state === 'nosrc') return <p className="empty">{tr('Turn on at least one source above to search online.')}</p>;
  if (online.state === 'loading') return <Loading text={tr('Searching online…')} />;
  if (online.state === 'error') return <ErrorBox msg={tr('Online search failed: ') + online.msg} retry={retry} />;
  if (online.state !== 'done') return null;
  const { data } = online;
  const ctx = (name: string) => ({ label: `${name}: „${q}”`, href: here });
  const emptyText = kind === 'sets'
    ? tr('No sets for “{q}”. Try adding “set”, “mix” or a festival name.', { q })
    : tr('No results.');
  function block<T>(key: BlockKey, title: string, render: (items: T[]) => ReactNode, filter?: (x: T) => boolean): ReactNode {
    const r = data[key];
    if (!r) return null;
    if (r.error) return <Section key={key} title={title}><ErrorBox msg={r.error} /></Section>;
    const all = (r.items || []) as T[];
    const items = filter ? all.filter(filter) : all;
    if (!items.length) return <Section key={key} title={title}><p className="empty">{emptyText}</p></Section>;
    return <Section key={key} title={title}>{render(items)}</Section>;
  }
  const tracksTitle = (name: string) => (kind === 'sets' ? tr('{name}: sets & mixes', { name }) : kind === 'songs' ? tr('{name}: songs', { name }) : null);
  return (
    <>
      {block<AudiusArtist>('artists', tr('Artists on Audius'), (items) => <Grid items={(kind === 'all' ? items.slice(0, 6) : items).map(audiusArtistTile)} round />)}
      {block<Track>('audius', tracksTitle('Audius') || tr('Audius: independent artists'), (items) => <TrackList tracks={items} context={ctx('Audius')} />, byKind(kind))}
      {block<Track>('hearthis', tracksTitle('hearthis.at') || tr('hearthis.at: DJ mixes and electronic music'), (items) => <TrackList tracks={items} context={ctx('hearthis.at')} />, byKind(kind))}
      {block<Track>('jamendo', tracksTitle('Jamendo') || tr('Jamendo: Creative Commons'), (items) => <TrackList tracks={items} context={ctx('Jamendo')} />, byKind(kind))}
      {block<ArchiveResult>('archive', tr('Internet Archive: concerts and releases'), (items) => <Grid items={items.map(archiveTile)} />)}
      {block<Track>('radio', tr('Radio stations'), (items) => <StationGrid list={items} />)}
    </>
  );
}

// A pasted SoundCloud link: one result that plays through SoundCloud's own player.
type Resolved = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'done'; track: Track };

function SoundCloudResult({ url, here }: { url: string; here: string }) {
  const [res, setRes] = useState<Resolved>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    api<{ track: Track }>('/api/soundcloud/resolve?u=' + encodeURIComponent(url))
      .then(({ track }) => { if (!cancelled) setRes({ state: 'done', track }); })
      .catch((e: Error) => { if (!cancelled) setRes({ state: 'error', msg: e.message }); });
    return () => { cancelled = true; };
  }, [url]);

  let box: ReactNode;
  if (res.state === 'loading') box = <Loading text={tr('Opening the SoundCloud link…')} />;
  else if (res.state === 'error') box = <ErrorBox msg={res.msg} />;
  else {
    const { track } = res;
    const context = { label: 'SoundCloud', href: here };
    const what = ({ track: tr('Song'), set: tr('Set or playlist'), artist: tr('Artist page: plays their songs') } as Record<string, string>)[track.kind || ''] || '';
    box = (
      <>
        <TrackList tracks={[track]} context={context} />
        <div className="row" style={{ marginTop: '14px', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={() => player.playList([track], 0, { shuffle: false, context })}>
            <Icon name="play" size={16} />{tr('Play')}</button>
          <a className="btn" href={track.link || undefined} target="_blank" rel="noopener"><Icon name="external" size={16} />soundcloud.com</a>
        </div>
        <p className="muted" style={{ marginTop: '14px', maxWidth: '68ch' }}>
          {[what, tr('It plays in SoundCloud\'s own player, so the equalizer, spectrum and offline playback don\'t work for it, and SoundCloud may show ads.')].filter(Boolean).join('. ')}
        </p>
      </>
    );
  }
  return <Section title={tr('From SoundCloud')}><div>{box}</div></Section>;
}

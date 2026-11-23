// An Audius artist: all their tracks and sets.
import { useEffect, useState } from 'react';

import { Icon } from '../components/Icon.tsx';
import { Header, Chips, Cover, Loading, ErrorBox, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import type { AudiusArtist as AudiusArtistInfo } from './tiles.tsx';
import { tr, plural } from '../lib/i18n.ts';
import { songs, isSet, byKind } from '../lib/format.ts';
import { api } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';

interface ArtistData { artist: AudiusArtistInfo; tracks: Track[] }
type Sort = 'plays' | 'date';
type Kind = 'all' | 'songs' | 'sets';

export function AudiusArtist({ route }: { route: Route }) {
  const id = decodeURIComponent(route.arg);
  return <AudiusArtistPage key={id} id={id} />;
}

function AudiusArtistPage({ id }: { id: string }) {
  const [sort, setSort] = useState<Sort>('plays');
  const [kind, setKind] = useState<Kind>('all');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ sort: Sort; d: ArtistData } | null>(null);
  // The header is built from the first answer and stays while the sort order reloads the list.
  const [head, setHead] = useState<ArtistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ArtistData>(`/api/audius/user/${encodeURIComponent(id)}?sort=${sort}`)
      .then((d) => {
        if (cancelled) return;
        setError(null);
        setLoaded({ sort, d });
        setHead((h) => h || d);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setHead(null);
      });
    return () => { cancelled = true; };
  }, [id, sort, attempt]);

  if (error) {
    return <div className="view"><ErrorBox msg={tr('Audius isn\'t responding: ') + error} retry={() => { setError(null); setAttempt((n) => n + 1); }} /></div>;
  }
  if (!head) return <div className="view"><Loading /></div>;

  // A list for the previous sort order counts as loading.
  const data = loaded && loaded.sort === sort ? loaded.d : null;
  const a = head.artist;
  const context = { label: a.name, href: '/audius/' + id };
  const sets = head.tracks.filter(isSet).length;
  return (
    <div className="view">
      <Header
        title={a.name} big
        kicker="Audius"
        meta={[plural(a.followers, 'follower', 'followers'), songs(head.tracks.length), sets ? plural(sets, 'set', 'sets') : null].filter(Boolean).join(', ')}
        art={<Cover src={a.cover} label={a.name} className="hd__cv hd__cv--round" />}
        actions={[...playButtons(head.tracks, context),
          <a key="link" className="btn btn--ghost" href={a.link} target="_blank" rel="noopener"><Icon name="external" size={16} />audius.co</a>]} />
      {a.bio && <p className="desc">{a.bio.slice(0, 500)}</p>}
      <div className="toolbar">
        <Chips options={[{ value: 'all', label: 'All' }, { value: 'songs', label: 'Songs' }, { value: 'sets', label: 'Sets & mixes' }]}
          value={kind} onPick={setKind} label={tr('Category')} />
        <Chips options={[{ value: 'plays', label: 'Most popular' }, { value: 'date', label: 'Newest' }]}
          value={sort} onPick={setSort} label={tr('Sort')} />
      </div>
      <div>
        {data ? (
          <TrackList tracks={data.tracks.filter(byKind(kind))} context={context}
            emptyText={kind === 'sets' ? tr('This artist has no sets or mixes.') : tr('No songs.')} />
        ) : <Loading />}
      </div>
    </div>
  );
}

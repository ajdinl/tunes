// One Internet Archive release: a concert, a netlabel album or an old record.
import { useEffect, useState } from 'react';

import { Icon } from '../components/Icon.tsx';
import { Header, Cover, Loading, ErrorBox, playButtons } from '../components/common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import type { ArchiveAlbum } from './tiles.tsx';
import { tr } from '../lib/i18n.ts';
import { totalMeta } from '../lib/format.ts';
import { api } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import { saveToLibrary } from '../lib/actions.ts';
import type { Route } from '../lib/router.ts';
import { STANDALONE } from '../lib/env.ts';

interface ArchiveData { album: ArchiveAlbum; tracks: Track[] }
type Load = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'done'; data: ArchiveData };

export function ArchiveItem({ route }: { route: Route }) {
  const id = decodeURIComponent(route.arg);
  return <ArchivePage key={id} id={id} />;
}

function ArchivePage({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const [res, setRes] = useState<{ attempt: number; load: Load }>({ attempt: 0, load: { state: 'loading' } });

  useEffect(() => {
    let cancelled = false;
    api<ArchiveData>('/api/archive/item/' + encodeURIComponent(id))
      .then((data) => { if (!cancelled) setRes({ attempt, load: { state: 'done', data } }); })
      .catch((e: Error) => { if (!cancelled) setRes({ attempt, load: { state: 'error', msg: e.message } }); });
    return () => { cancelled = true; };
  }, [id, attempt]);

  const load: Load = res.attempt === attempt ? res.load : { state: 'loading' };
  if (load.state === 'loading') return <div className="view"><Loading text={tr('Loading release from Internet Archive…')} /></div>;
  if (load.state === 'error') {
    return <div className="view"><ErrorBox msg={tr('Can\'t load this release: ') + load.msg} retry={() => setAttempt((n) => n + 1)} /></div>;
  }

  const { album: a, tracks } = load.data;
  const ctx = { label: a.title, href: '/archive/' + id };
  return (
    <div className="view">
      <Header
        title={a.title} kicker={a.artist}
        meta={[a.year, tracks.length ? totalMeta(tracks) : null].filter(Boolean).join(', ')}
        art={<Cover src={a.cover} label={a.title} className="hd__cv" />}
        actions={[...playButtons(tracks, ctx),
          tracks.length && !STANDALONE
            ? <button key="save" type="button" className="btn btn--ghost" onClick={() => { saveToLibrary(tracks); }}><Icon name="download" size={16} />{tr('Save album to computer')}</button>
            : null,
          <a key="link" className="btn btn--ghost" href={a.link} target="_blank" rel="noopener"><Icon name="external" size={16} />archive.org</a>]} />
      {a.description ? <p className="desc">{a.description}</p> : null}
      {a.license ? <p className="muted pad">{tr('License: ')}<a href={a.license} target="_blank" rel="noopener">{a.license}</a></p> : null}
      <TrackList tracks={tracks} context={ctx} numbered album={false} coverArt={false}
        emptyText={tr('This release has no recordings your browser can play.')} />
    </div>
  );
}

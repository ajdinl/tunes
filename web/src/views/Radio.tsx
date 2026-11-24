// Internet radio: saved stations, a few featured ones and a search over radio-browser.info.
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../components/Icon.tsx';
import { Header, Section, ChipPicker, Loading, ErrorBox } from '../components/common.tsx';
import type { ChipOption } from '../components/common.tsx';
import { StationGrid } from '../components/StationGrid.tsx';
import { tr } from '../lib/i18n.ts';
import { store, useStore, api } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import type { Route } from '../lib/router.ts';
import { FEATURED_STATIONS } from '../../../lib/stations.ts';

const RADIO_TAGS = ['pop', 'rock', 'jazz', 'classical', 'electronic', 'chillout', 'lounge', 'hits', '80s', '90s', 'folk', 'news'];
const COUNTRIES: ChipOption[] = [
  { value: 'RS', label: 'Serbia' }, { value: 'BA', label: 'Bosnia and Herzegovina' }, { value: 'HR', label: 'Croatia' },
  { value: 'ME', label: 'Montenegro' }, { value: 'SI', label: 'Slovenia' }, { value: 'MK', label: 'North Macedonia' },
];

type Load = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'done'; list: Track[] };

export function Radio({ route }: { route: Route }) {
  useStore('stations');
  const [q0] = useState(() => route.params.get('q') || '');
  const [q, setQ] = useState(q0);
  const [tag, setTag] = useState('');
  const [country, setCountry] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [res, setRes] = useState<{ key: string; load: Load }>({ key: '', load: { state: 'loading' } });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (tag) p.set('tag', tag);
  if (country) p.set('country', country);
  const url = p.toString() ? '/api/radio/search?' + p : '/api/radio/top';
  const key = url + '#' + attempt;

  useEffect(() => {
    let cancelled = false;
    api<Track[]>(url)
      .then((list) => { if (!cancelled) setRes({ key, load: { state: 'done', list } }); })
      .catch((e: Error) => { if (!cancelled) setRes({ key, load: { state: 'error', msg: e.message } }); });
    return () => { cancelled = true; };
  }, [url, key]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // An answer for an older selection counts as loading.
  const load: Load = res.key === key ? res.load : { state: 'loading' };
  const saved = Object.values(store.stations);

  return (
    <div className="view">
      <Header title="Radio" meta={tr('Over 40,000 internet stations from the open radio-browser.info database')} />
      {saved.length > 0 && <Section title={tr('My stations')}><StationGrid list={saved} /></Section>}
      <Section title={tr('Featured stations')}><StationGrid list={FEATURED_STATIONS} /></Section>
      <Section title={tr('Find a station')}>
        <div>
          <div className="toolbar">
            <label className="filter">
              <Icon name="search" size={16} />
              <input className="field field--filter" type="search" placeholder={tr('Station name')} aria-label={tr('Find a station')} defaultValue={q0}
                onChange={(e) => {
                  const v = e.target.value;
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setQ(v.trim()), 350);
                }} />
            </label>
          </div>
          <div className="toolbar">
            <ChipPicker options={[{ value: '', label: 'Whole world' }, ...COUNTRIES]} initial="" onPick={setCountry} label={tr('Country')} />
          </div>
          <div className="toolbar">
            <ChipPicker options={[{ value: '', label: 'All genres' }, ...RADIO_TAGS.map((x) => ({ value: x, label: x }))]} initial="" onPick={setTag} label={tr('Genre')} />
          </div>
          <div>
            {load.state === 'loading' && <Loading text={tr('Searching stations…')} />}
            {load.state === 'error' && <ErrorBox msg={tr('The radio database isn\'t responding: ') + load.msg} retry={() => setAttempt((n) => n + 1)} />}
            {load.state === 'done' && (load.list.length ? <StationGrid list={load.list} /> : <p className="empty">{tr('No stations for this selection.')}</p>)}
          </div>
        </div>
      </Section>
    </div>
  );
}

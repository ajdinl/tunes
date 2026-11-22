// Settings: language, appearance, folders, ListenBrainz, Jamendo, Spotify import,
// offline playback, backup, keyboard shortcuts and phone access.
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';

import { Header, Section } from '../components/common.tsx';
import { Icon } from '../components/Icon.tsx';
import { OfflineSettings } from './OfflineSettings.tsx';
import { tr, setLang, LANGUAGES, useLang } from '../lib/i18n.ts';
import { norm, songs } from '../lib/format.ts';
import { store, useStore, api } from '../lib/store.ts';
import type { Track } from '../lib/store.ts';
import { toast } from '../lib/feedback.ts';
import { playlistHref } from '../lib/actions.ts';
import { go } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';

const THEMES = [{ value: 'black', label: 'Black', sw: '#000000' }, { value: 'indigo', label: 'Night indigo', sw: '#1c1f3a' }, { value: 'light', label: 'Light', sw: '#f4f4f6' }];
const ICON_OPTS = [{ value: 'dial', label: 'Dial' }, { value: 'night', label: 'Dial on black' }, { value: 'vinyl', label: 'Vinyl' }, { value: 'bars', label: 'Spectrum' }];
const KEYS: [string, string, boolean][] = [ // [key, description, translate the key]
  ['Space', 'Play / pause', true], ['← →', 'Skip 5 seconds', false], ['Shift + ← →', 'Previous / next song', false],
  ['↑ ↓', 'Volume', false], ['M', 'Mute', false], ['L', 'Favorite (heart)', false], ['S', 'Shuffle', false], ['R', 'Repeat', false],
  ['/', 'Search', false], ['Q', 'Play queue', false], ['T', 'Lyrics', false], ['E', 'Equalizer', false], ['F', 'Full screen: now playing', false], ['Esc', 'Close', false],
];
const ext = { target: '_blank', rel: 'noopener' } as const;

export function setTheme(t: string): void {
  document.documentElement.dataset.theme = t;
  document.querySelector<HTMLMetaElement>('meta[name=theme-color]')?.setAttribute('content', t === 'black' ? '#000000' : t === 'light' ? '#f4f4f6' : '#1c1f3a');
  try { localStorage.setItem('tunes.theme', JSON.stringify(t)); } catch { /* storage full or blocked */ }
}

export function Settings(_: { route: Route }) {
  useStore('library', 'settings');
  const lang = useLang();
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || 'black');
  const icon = store.settings.icon || 'dial';

  // ---- folders (a local copy, refreshed when the library reloads)
  const [folders, setFolders] = useState<string[]>(() => store.folders.slice());
  useEffect(() => { setFolders(store.folders.slice()); }, [store.folders]);
  const [newFolder, setNewFolder] = useState('');
  const [scanning, setScanning] = useState(false);

  // ---- ListenBrainz / Jamendo
  const [lbToken, setLbToken] = useState('');
  // Kept as an English key so it follows a language switch.
  const [lbStatus, setLbStatus] = useState<{ key: string; vars?: Record<string, string> }>(() => ({
    key: store.settings.hasListenbrainz ? 'Connected: every song you finish is also logged on ListenBrainz.' : 'Not connected.',
  }));
  const [jmId, setJmId] = useState('');

  // ---- Spotify import
  const [csv, setCsv] = useState<{ text: string; name: string; n: number } | null>(null);

  const pickIcon = async (value: string) => {
    if (icon === value) return;
    try { await store.saveSettings({ icon: value }); toast(tr('App icon changed')); } catch (e) { toast((e as Error).message, { error: true }); }
  };

  const removeFolder = async (i: number) => {
    const next = folders.slice();
    next.splice(i, 1);
    setFolders(next);
    await store.saveSettings({ folders: next });
    toast(tr('Folder removed from library'));
  };

  const addFolder = async (e: FormEvent) => {
    e.preventDefault();
    const v = newFolder.trim();
    if (!v) return;
    const next = [...folders, v];
    await store.saveSettings({ folders: next });
    setFolders(next);
    setNewFolder('');
    toast(tr('Folder added, scanning…'));
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api<{ count: number }>('/api/library/rescan', { method: 'POST', body: {} });
      await store.reloadLibrary();
      toast(tr('Scanned: {n}', { n: songs(r.count) }));
    } finally { setScanning(false); }
  };

  const saveLb = async (e: FormEvent) => {
    e.preventDefault();
    const r = await store.saveSettings({ listenbrainzToken: lbToken.trim() });
    setLbToken('');
    if (r.listenbrainz?.valid) { setLbStatus({ key: 'Connected as {user}.', vars: { user: r.listenbrainz.user || '' } }); toast(tr('ListenBrainz connected')); }
    else if (r.listenbrainz) { setLbStatus({ key: 'The token wasn\'t accepted. Copy it again from the page below.' }); toast(tr('ListenBrainz rejected the token'), { error: true }); }
    else { setLbStatus({ key: 'Not connected.' }); toast(tr('ListenBrainz disconnected')); }
  };

  const saveJamendo = async (e: FormEvent) => {
    e.preventDefault();
    await store.saveSettings({ jamendoClientId: jmId.trim() });
    setJmId('');
    toast(store.settings.hasJamendo ? tr('Jamendo turned on') : tr('Jamendo turned off'));
  };

  return (
    <div className="view view--narrow">
      <Header title={tr('Settings')} />

      <Section title={tr('Language')}>
        <div className="theme-pick" role="group" aria-label={tr('Language')}>
          {LANGUAGES.map((l) => {
            const name = tr(l.name);
            return (
              <button key={l.code} type="button" className="theme-opt lang-opt" lang={l.code} aria-pressed={lang === l.code}
                onClick={() => { if (lang !== l.code) setLang(l.code); }}>
                <span className="lang-opt__flag" aria-hidden="true">{l.flag}</span>
                <span className="lang-opt__text"><span>{name}</span>{name !== l.native ? <span className="lang-opt__native">{l.native}</span> : null}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={tr('Appearance')}>
        <div className="form">
          <div className="theme-pick" role="group" aria-label={tr('Theme')}>
            {THEMES.map((t) => (
              <button key={t.value} type="button" className="theme-opt" aria-pressed={theme === t.value}
                onClick={() => { setTheme(t.value); setThemeState(t.value); }}>
                <span className="theme-opt__sw" style={{ '--sw': t.sw } as CSSProperties} aria-hidden="true" />{tr(t.label)}
              </button>
            ))}
          </div>
          <h3 className="form__label">{tr('App icon')}</h3>
          {/* App icon: stored on the server, so the computer and the phone show the same one. */}
          <div className="theme-pick" role="group" aria-label={tr('App icon')}>
            {ICON_OPTS.map((o) => (
              <button key={o.value} type="button" className="theme-opt" aria-pressed={icon === o.value} onClick={() => pickIcon(o.value)}>
                <img className="theme-opt__icon" src={`/icons/${o.value}/icon.svg`} alt="" width={34} height={34} />{tr(o.label)}
              </button>
            ))}
          </div>
          <p className="muted">{tr('The icon changes on all your devices. A shortcut already on a home screen keeps its old icon until you add it again.')}</p>
        </div>
      </Section>

      <Section title={tr('Music on this computer')}>
        <div className="form">
          <p className="muted">{tr('{n} in your libraries. New songs appear on their own as soon as you drop them in the folder.', { n: songs(store.library.length) })}</p>
          <ul className="folders">
            {folders.map((f, i) => (
              <li className="folders__item" key={f + ':' + i}>
                <Icon name="folder" size={16} /><code>{f}</code>
                {folders.length > 1 ? <button type="button" className="ibtn" aria-label={tr('Remove folder')} onClick={() => removeFolder(i)}><Icon name="close" size={16} /></button> : null}
              </li>
            ))}
          </ul>
          <form className="row" onSubmit={addFolder}>
            <input className="field" type="text" placeholder="~/Music/Another folder" aria-label={tr('Folder path')} value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
            <button className="btn">{tr('Add folder')}</button>
          </form>
          <button type="button" className="btn btn--ghost" disabled={scanning} onClick={rescan}><Icon name="refresh" size={16} />{tr('Rescan')}</button>
          <p className="muted">
            {tr('Tip: the ')}<a href="https://beets.io" {...ext}>beets</a>
            {tr(' tool fixes tags and covers and sorts files by artist and album. Command: ')}<code>beet import ~/Downloads/new-album</code>
          </p>
        </div>
      </Section>

      <Section title={tr('History on ListenBrainz')}>
        <div className="form">
          <p className="muted">{tr('A free, open-source service: it keeps your full history, makes yearly reviews and weekly recommendations. It can also log what you play on Spotify, so you have one history for everything.')}</p>
          <form className="row" onSubmit={saveLb}>
            <input className="field" type="password" placeholder={store.settings.hasListenbrainz ? tr('Token saved') : tr('Paste token')} aria-label="ListenBrainz token" autoComplete="off"
              value={lbToken} onChange={(e) => setLbToken(e.target.value)} />
            <button className="btn">{tr('Save')}</button>
          </form>
          <p className="muted">{tr(lbStatus.key, lbStatus.vars)}</p>
          <p className="muted">{tr('Find your token at ')}<a href="https://listenbrainz.org/settings/" {...ext}>listenbrainz.org/settings</a>{tr('. Saving an empty field disconnects it.')}</p>
        </div>
      </Section>

      <Section title="Jamendo">
        <div className="form">
          <p className="muted">{tr('Creative Commons music. Get a free Client ID at ')}<a href="https://devportal.jamendo.com" {...ext}>devportal.jamendo.com</a>.</p>
          <form className="row" onSubmit={saveJamendo}>
            <input className="field" type="password" placeholder={store.settings.hasJamendo ? tr('Client ID saved') : 'Jamendo Client ID'} aria-label="Jamendo Client ID" autoComplete="off"
              value={jmId} onChange={(e) => setJmId(e.target.value)} />
            <button className="btn">{tr('Save')}</button>
          </form>
        </div>
      </Section>

      <Section title={tr('Import a playlist from Spotify')}>
        <div className="form">
          <p className="muted">
            {tr('At ')}<a href="https://exportify.app" {...ext}>exportify.app</a>
            {tr(' (open source), export a playlist or “Liked Songs” to CSV. Tunes finds those songs in your library, builds a playlist and shows what you\'re missing.')}
          </p>
          <input type="file" accept=".csv,text/csv" className="visually-hidden" id="csv" onChange={async (e) => {
            const input = e.currentTarget;
            const f = input.files?.[0];
            if (!f) return;
            const text = await f.text();
            setCsv((c) => ({ text, name: f.name.replace(/\.csv$/i, ''), n: (c?.n || 0) + 1 }));
            input.value = '';
          }} />
          <label className="btn" htmlFor="csv"><Icon name="plus" size={16} />{tr('Choose CSV file')}</label>
          <div>{csv ? <SpotifyImport key={csv.n} text={csv.text} name={csv.name} /> : null}</div>
        </div>
      </Section>

      <Section title={tr('Offline playback')}><OfflineSettings /></Section>

      <Section title={tr('Backup')}>
        <div className="form">
          <p className="muted">{tr('Favorites, playlists and history in one JSON file.')}</p>
          <a className="btn btn--ghost" href="/api/export" download=""><Icon name="download" size={16} />{tr('Download backup')}</a>
        </div>
      </Section>

      <Section title={tr('Keyboard shortcuts')}>
        <dl className="keys">
          {KEYS.map(([k, d, translate]) => (
            <Fragment key={k}><dt><kbd>{translate ? tr(k) : k}</kbd></dt><dd>{tr(d)}</dd></Fragment>
          ))}
        </dl>
      </Section>

      <Section title={tr('Listening on your phone')}>
        <div className="form">
          <p className="muted">{tr('Click “Listen on phone” in the left menu and scan the QR code with your phone camera. The phone must be on the same Wi-Fi network.')}</p>
          <button type="button" className="btn" onClick={() => document.dispatchEvent(new CustomEvent('open-phone'))}><Icon name="phone" size={16} />{tr('Listen on phone')}</button>
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------ Spotify import
interface ImportResult { error: boolean; found: Track[]; missing: { title: string; artist: string; album: string }[] }

// Exportify CSV -> a playlist of the tracks you already have.
export function spotifyImport(text: string): ImportResult {
  const rows = parseCsv(text);
  const head = rows.shift() || [];
  const col = (re: RegExp) => head.findIndex((x) => re.test(x));
  const ti = col(/^track name$/i), ai = col(/^artist name/i), bi = col(/^album name$/i);
  if (ti < 0 || ai < 0) return { error: true, found: [], missing: [] };
  const lib = store.library.map((t) => ({ t, title: norm(t.title.replace(/\s*[([].*?[)\]]/g, '')), artist: norm(t.artist) }));
  const found: Track[] = [], missing: ImportResult['missing'] = [];
  for (const r of rows) {
    if (!r[ti]) continue;
    const title = norm(r[ti].replace(/\s*[([].*?[)\]]/g, '').replace(/ - .*(remaster|live|version|mix).*$/i, ''));
    const artists = (r[ai] || '').split(/[,;]/).map(norm).filter(Boolean);
    const hit = lib.find((x) => x.title === title && artists.some((a) => x.artist.includes(a) || a.includes(x.artist)))
      || lib.find((x) => x.title === title);
    if (hit) found.push(hit.t); else missing.push({ title: r[ti], artist: r[ai] || '', album: bi >= 0 ? r[bi] || '' : '' });
  }
  return { error: false, found, missing };
}

function SpotifyImport({ text, name }: { text: string; name: string }) {
  const res = useMemo(() => spotifyImport(text), [text]);
  const [busy, setBusy] = useState(false);
  if (res.error) return <p className="err">{tr('This doesn\'t look like an Exportify CSV: the “Track Name” and “Artist Name(s)” columns are missing.')}</p>;
  const { found, missing } = res;
  const create = async () => {
    setBusy(true);
    const p = await store.createPlaylist(name || tr('From Spotify'), found);
    toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go(playlistHref(p.id)) });
  };
  const q = (m: { artist: string; title: string }) => encodeURIComponent(`${m.artist.split(',')[0]} ${m.title}`);
  return (
    <div className="import">
      <p>{tr('Found on this computer: {found} of {total}.', { found: found.length, total: found.length + missing.length })}</p>
      {found.length ? <button type="button" className="btn btn--primary" disabled={busy} onClick={create}><Icon name="plus" size={16} />{tr('Create playlist “{name}”', { name })}</button> : null}
      {missing.length ? (
        <details className="missing">
          <summary>{tr('Missing {n}: look for them on Bandcamp, Jamendo or Audius', { n: songs(missing.length) })}</summary>
          <ul>
            {missing.slice(0, 500).map((m, i) => (
              <li key={i}>
                <span>{`${m.artist} – ${m.title}`}</span>
                <a href={'/search?q=' + q(m)}>{tr('Find')}</a>
                <a href={'https://bandcamp.com/search?q=' + q(m)} {...ext}>Bandcamp</a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

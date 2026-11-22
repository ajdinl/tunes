// Svi ekrani aplikacije. Svaki prikaz vraća DOM element.
import { h, icon, cover, fmtTime, fmtDuration, songs, plural, relDay, sourceTag, toast, ask, norm, SOURCES, isSet, tr } from './ui.js';
import { lang, setLang, locale } from './i18n.js';
import { store, api, SMART } from './store.js';
import { player, EQ_PRESETS } from './player.js';
import {
  go, artistHref, albumHref, trackList, grid, collage, header, playButtons, totalMeta, section,
  filterInput, chips, loading, errorBox, saveToLibrary, addToPlaylist, toggleFav,
} from './components.js';

// ============================================================ Početna
export function home() {
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Laku noć' : hour < 11 ? 'Dobro jutro' : hour < 18 ? 'Dobar dan' : tr('Dobro veče');
  const lib = store.library;
  const idx = store.index;
  const root = h('div.view');
  root.append(header({
    title: hello,
    meta: lib.length
      ? tr('Na računaru: {a}, {b}, {c}', { a: songs(lib.length), b: plural(idx.artists.length, ['izvođač', 'izvođača', 'izvođača'], ['artist', 'artists']), c: plural(idx.albums.length, ['album', 'albuma', 'albuma'], ['album', 'albums']) })
      : tr('Biblioteka na računaru je prazna, ali internet radio, Audius i Internet Archive rade odmah.'),
    big: true,
  }));

  if (!lib.length) {
    root.append(h('div.note', {},
      h('h2', {}, tr('Dodaj svoju muziku')),
      h('p', {}, tr('Ubaci MP3, FLAC ili M4A fajlove u folder '), h('code', {}, store.folders[0] || '~/Music/Biblioteka'),
        tr('. Tunes ih vidi za par sekundi i sama ih ređa po izvođačima i albumima.')),
      h('a.btn', { href: '#/podesavanja' }, icon('folder', 16), tr('Podesi foldere'))));
  }

  // Nedavno slušano: jedinstvene pesme, najnovije prve.
  const seen = new Set();
  const recent = [];
  for (let i = store.history.length - 1; i >= 0 && recent.length < 8; i--) {
    const t = store.history[i].track;
    if (!seen.has(t.id)) { seen.add(t.id); recent.push(t); }
  }
  if (recent.length) {
    root.append(section(tr('Nedavno slušano'), trackList(recent, { context: { label: tr('Nedavno slušano'), href: '#/istorija' }, album: false }), { href: '#/istorija', label: tr('Cijela historija') }));
  }

  const smartTiles = SMART.map((s) => ({ s, tracks: store.smart(s.key) })).filter((x) => x.tracks.length);
  if (smartTiles.length) {
    root.append(section(tr('Pametne plejliste'), grid(smartTiles.map(({ s, tracks }) => ({
      title: s.name, sub: s.desc, href: '#/pametna/' + s.key,
      collage: tracks.map((t) => t.cover),
      play: () => player.playList(tracks, 0, { shuffle: false, context: { label: s.name, href: '#/pametna/' + s.key } }),
    })))));
  }

  const stations = Object.values(store.stations);
  if (stations.length) root.append(section(tr('Moje stanice'), stationGrid(stations), { href: '#/radio', label: tr('Sav radio') }));

  const trend = h('div', {}, loading(tr('Učitavam šta je popularno na Audius-u…')));
  root.append(section(tr('Popularno ove sedmice na Audius-u'), trend, { href: '#/otkrij', label: tr('Otkrij još') }));
  api('/api/audius/trending').then((list) => {
    trend.replaceChildren(trackList(list.slice(0, 10), { context: { label: tr('Audius, popularno'), href: '#/otkrij' } }));
  }).catch((e) => trend.replaceChildren(errorBox(tr('Audius trenutno ne odgovara: ') + e.message)));

  return root;
}

// ============================================================ Pretraga
let lastSources = ['audius', 'archive', 'radio', 'jamendo'];
const KINDS = [
  { value: 'sve', label: tr('Sve') },
  { value: 'pjesme', label: tr('Pjesme') },
  { value: 'setovi', label: tr('Setovi i miksevi') },
  { value: 'albumi', label: tr('Albumi i koncerti') },
  { value: 'izvodjaci', label: tr('Izvođači') },
  { value: 'radio', label: tr('Radio stanice') },
];
// Koji onlajn izvori trebaju za koju kategoriju.
const KIND_SOURCES = {
  sve: ['audius', 'artists', 'archive', 'radio', 'jamendo'],
  pjesme: ['audius', 'jamendo'],
  setovi: ['audius', 'jamendo'],
  albumi: ['archive'],
  izvodjaci: ['artists'],
  radio: ['radio'],
};
const byKind = (kind) => (x) => (kind === 'pjesme' ? !isSet(x) : kind === 'setovi' ? isSet(x) : true);

export function search(params) {
  const q0 = params.get('q') || '';
  let kind = KINDS.some((k) => k.value === params.get('tip')) ? params.get('tip') : 'sve';
  const root = h('div.view');
  const input = h('input.field.field--search', { type: 'search', value: q0, placeholder: tr('Pjesma, set, izvođač, album, stanica…'), 'aria-label': tr('Pretraga'), autofocus: true });
  const results = h('div.results');
  root.append(h('div.searchbar', {}, icon('search', 22), input));
  root.append(h('div.searchsrc', {}, h('span.muted', {}, tr('Prikaži:')),
    chips(KINDS, kind, (v) => { kind = v; run(input.value, true); }, tr('Kategorija'))));

  const onlineSrc = ['audius', 'archive', 'radio'].concat(store.settings.hasJamendo ? ['jamendo'] : []);
  const srcChips = h('div.chips', { role: 'group', 'aria-label': tr('Izvori na internetu') }, onlineSrc.map((s) => {
    const on = lastSources.includes(s);
    const b = h('button.chip', { type: 'button', class: (on ? 'is-on ' : '') + 'chip--' + s, 'aria-pressed': String(on), onclick: () => {
      lastSources = lastSources.includes(s) ? lastSources.filter((x) => x !== s) : [...lastSources, s];
      b.classList.toggle('is-on'); b.setAttribute('aria-pressed', String(lastSources.includes(s)));
      run(input.value, true);
    } }, SOURCES[s].name);
    return b;
  }));
  root.append(h('div.searchsrc', {}, h('span.muted', {}, tr('Traži i na:')), srcChips), results);

  let token = 0;
  let onlineTimer;
  function run(q, force) {
    q = q.trim();
    const my = ++token;
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (kind !== 'sve') qs.set('tip', kind);
    history.replaceState(null, '', '#/pretraga' + (qs.toString() ? '?' + qs : ''));
    results.replaceChildren();
    if (!q) {
      results.append(h('div.hints', {},
        h('p.muted', {}, tr('Probaj nešto od ovoga:')),
        h('div.chips', {}, ['lofi', 'jazz', 'techno set', 'boiler room', 'Grateful Dead', 'ambient', 'Sarajevo radio'].map((x) =>
          h('button.chip', { type: 'button', onclick: () => { input.value = x; run(x); } }, x)))));
      return;
    }
    const here = '#/pretraga?' + qs;
    const local = store.searchLocal(q);
    const localTracks = local.tracks.filter(byKind(kind));
    let shown = 0;
    if (['sve', 'izvodjaci'].includes(kind) && local.artists.length) {
      shown++; results.append(section(tr('Izvođači u kolekciji'), grid(local.artists.slice(0, 12).map(artistTile), { round: true })));
    }
    if (['sve', 'albumi'].includes(kind) && local.albums.length) {
      shown++; results.append(section(tr('Albumi u kolekciji'), grid(local.albums.slice(0, 12).map(albumTile))));
    }
    if (['sve', 'pjesme', 'setovi'].includes(kind) && localTracks.length) {
      shown++;
      results.append(section(kind === 'setovi' ? tr('Setovi u kolekciji') : tr('Pjesme u kolekciji'),
        trackList(localTracks.slice(0, 50), { context: { label: tr('Pretraga „{q}”', { q }), href: here } })));
    }
    if (!shown && store.collection.length && kind !== 'radio') {
      results.append(h('p.muted.pad', {}, tr('U tvojoj kolekciji nema ničeg za „{q}”. Rezultati sa interneta stižu ispod.', { q })));
    }
    const online = h('div.online');
    results.append(online);
    clearTimeout(onlineTimer);
    const src = KIND_SOURCES[kind].filter((x) => lastSources.includes(x === 'artists' ? 'audius' : x));
    if (!src.length) {
      online.append(h('p.empty', {}, tr('Uključi bar jedan izvor iznad da tražiš i na internetu.')));
      return;
    }
    onlineTimer = setTimeout(async () => {
      online.replaceChildren(loading(tr('Tražim na internetu…')));
      let data;
      try { data = await api('/api/search?q=' + encodeURIComponent(q) + '&src=' + src.join(',') + '&tip=' + kind); }
      catch (e) { if (my === token) online.replaceChildren(errorBox(tr('Pretraga na internetu nije uspjela: ') + e.message, () => run(q, true))); return; }
      if (my !== token) return;
      online.replaceChildren();
      const ctx = (name) => ({ label: `${name}: „${q}”`, href: here });
      const emptyText = kind === 'setovi'
        ? tr('Nema setova za „{q}”. Probaj dodati „set”, „mix” ili ime festivala.', { q })
        : tr('Nema rezultata.');
      const block = (key, title, render, filter) => {
        const r = data[key];
        if (!r) return;
        if (r.error) { online.append(section(title, errorBox(r.error))); return; }
        const items = filter ? (r.items || []).filter(filter) : r.items || [];
        if (!items.length) { online.append(section(title, h('p.empty', {}, emptyText))); return; }
        online.append(section(title, render(items)));
      };
      const tracksTitle = (name) => (kind === 'setovi' ? tr('{name}: setovi i miksevi', { name }) : kind === 'pjesme' ? tr('{name}: pjesme', { name }) : null);
      block('artists', tr('Izvođači na Audius-u'), (items) => grid((kind === 'sve' ? items.slice(0, 6) : items).map(audiusArtistTile), { round: true }));
      block('audius', tracksTitle('Audius') || tr('Audius: nezavisni izvođači'), (items) => trackList(items, { context: ctx('Audius') }), byKind(kind));
      block('jamendo', tracksTitle('Jamendo') || tr('Jamendo: Creative Commons'), (items) => trackList(items, { context: ctx('Jamendo') }), byKind(kind));
      block('archive', tr('Internet Archive: koncerti i izdanja'), (items) => grid(items.map(archiveTile)));
      block('radio', tr('Radio stanice'), (items) => stationGrid(items));
    }, force ? 0 : 450);
  }
  input.addEventListener('input', () => run(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(onlineTimer); run(input.value, true); } });
  queueMicrotask(() => { input.focus(); run(q0, true); });
  return root;
}

function audiusArtistTile(a) {
  return {
    title: a.name,
    sub: plural(a.followers, ['pratilac', 'pratioca', 'pratilaca'], ['follower', 'followers']),
    href: '#/audius/' + encodeURIComponent(a.id),
    cover: a.cover,
  };
}

// Izvođač sa Audius-a: sve njegove pjesme i setovi.
export function audiusArtist(params, id) {
  id = decodeURIComponent(id);
  const root = h('div.view', {}, loading());
  let sort = 'plays', kind = 'sve';
  const list = h('div');
  let data = null;
  const renderList = () => {
    const tracks = data.tracks.filter(byKind(kind));
    list.replaceChildren(trackList(tracks, {
      context: { label: data.artist.name, href: '#/audius/' + id },
      emptyText: kind === 'setovi' ? tr('Ovaj izvođač nema setova ni mikseva.') : tr('Nema pjesama.'),
    }));
  };
  const load = async () => {
    list.replaceChildren(loading());
    try { data = await api(`/api/audius/user/${encodeURIComponent(id)}?sort=${sort}`); }
    catch (e) { root.replaceChildren(errorBox(tr('Audius ne odgovara: ') + e.message, load)); return; }
    if (!root.querySelector('.hd')) {
      const a = data.artist;
      const sets = data.tracks.filter(isSet).length;
      root.replaceChildren(header({
        title: a.name, big: true,
        kicker: 'Audius',
        meta: [plural(a.followers, ['pratilac', 'pratioca', 'pratilaca'], ['follower', 'followers']), songs(data.tracks.length),
          sets ? plural(sets, ['set', 'seta', 'setova'], ['set', 'sets']) : null].filter(Boolean).join(', '),
        art: cover(a.cover, a.name, 'hd__cv hd__cv--round'),
        actions: [...playButtons(data.tracks, { label: a.name, href: '#/audius/' + id }),
          h('a.btn.btn--ghost', { href: a.link, target: '_blank', rel: 'noopener' }, icon('external', 16), 'audius.co')],
      }));
      if (a.bio) root.append(h('p.desc', {}, a.bio.slice(0, 500)));
      root.append(h('div.toolbar', {},
        chips([{ value: 'sve', label: tr('Sve') }, { value: 'pjesme', label: tr('Pjesme') }, { value: 'setovi', label: tr('Setovi i miksevi') }], kind, (v) => { kind = v; renderList(); }, tr('Kategorija')),
        chips([{ value: 'plays', label: tr('Najpopularnije') }, { value: 'date', label: tr('Najnovije') }], sort, (v) => { sort = v; load(); }, tr('Redoslijed'))),
      list);
    }
    renderList();
  };
  load();
  return root;
}

// ============================================================ Izvođači i albumi
function artistTile(a) {
  return {
    title: a.name, sub: songs(a.tracks.length), href: artistHref(a.name), cover: a.cover,
    play: () => player.playList(a.tracks, -1, { shuffle: true, context: { label: a.name, href: artistHref(a.name) } }),
  };
}

function albumTile(b) {
  return {
    title: b.title, sub: [b.artist, b.year].filter(Boolean).join(', '), href: albumHref(b.key), cover: b.cover,
    play: () => player.playList(b.tracks, 0, { shuffle: false, context: { label: b.title, href: albumHref(b.key) } }),
  };
}

export function artists() {
  const root = h('div.view');
  const all = store.index.artists;
  const body = h('div');
  const render = (f) => {
    const list = f ? all.filter((a) => norm(a.name).includes(norm(f))) : all;
    body.replaceChildren(list.length ? grid(list.map(artistTile), { round: true }) : emptyCollection(tr('Još nema izvođača.')));
  };
  root.append(header({ title: tr('Izvođači'), meta: tr('{n} u kolekciji', { n: plural(all.length, ['izvođač', 'izvođača', 'izvođača'], ['artist', 'artists']) }) }),
    all.length > 8 ? h('div.toolbar', {}, filterInput(tr('Filtriraj izvođače'), render)) : null, body);
  render('');
  return root;
}

export function artist(params, key) {
  const a = store.index.artistMap.get(decodeURIComponent(key));
  if (!a) return notFound(tr('Ovaj izvođač nije u kolekciji.'), '#/izvodjaci');
  const root = h('div.view');
  const albums = [...a.albums].map((k) => store.index.albumMap.get(k)).sort((x, y) => (y.year || 0) - (x.year || 0));
  const tracks = a.tracks.slice().sort((x, y) => (x.album || '').localeCompare(y.album || '') || (x.trackNo || 0) - (y.trackNo || 0));
  const ctx = { label: a.name, href: artistHref(a.name) };
  root.append(header({
    title: a.name, big: true,
    meta: [plural(albums.length, ['album', 'albuma', 'albuma'], ['album', 'albums']), totalMeta(tracks)].join(', '),
    actions: [...playButtons(tracks, ctx),
      h('a.btn.btn--ghost', { href: '#/pretraga?q=' + encodeURIComponent(a.name) }, icon('search', 16), tr('Traži još na internetu'))],
  }));
  if (albums.length) root.append(section(tr('Albumi'), grid(albums.map(albumTile))));
  root.append(section(tr('Sve pjesme'), trackList(tracks, { context: ctx })));
  return root;
}

export function albums() {
  const root = h('div.view');
  const all = store.index.albums;
  const body = h('div');
  let sort = 'artist', filter = '';
  const render = () => {
    let list = filter ? all.filter((b) => norm(`${b.title} ${b.artist}`).includes(norm(filter))) : all.slice();
    if (sort === 'year') list.sort((x, y) => (y.year || 0) - (x.year || 0));
    if (sort === 'added') list.sort((x, y) => Math.max(...y.tracks.map((t) => t.addedAt || 0)) - Math.max(...x.tracks.map((t) => t.addedAt || 0)));
    if (sort === 'title') list.sort((x, y) => x.title.localeCompare(y.title, 'sr'));
    body.replaceChildren(list.length ? grid(list.map(albumTile)) : emptyCollection(tr('Još nema albuma.')));
  };
  root.append(header({ title: tr('Albumi'), meta: tr('{n} u kolekciji', { n: plural(all.length, ['album', 'albuma', 'albuma'], ['album', 'albums']) }) }));
  if (all.length > 1) {
    root.append(h('div.toolbar', {},
      filterInput(tr('Filtriraj albume'), (v) => { filter = v; render(); }),
      chips([{ value: 'artist', label: tr('Po izvođaču') }, { value: 'title', label: tr('Po nazivu') }, { value: 'year', label: tr('Po godini') }, { value: 'added', label: tr('Nedavno dodano') }],
        sort, (v) => { sort = v; render(); }, tr('Redoslijed'))));
  }
  root.append(body);
  render();
  return root;
}

export function album(params, key) {
  const b = store.index.albumMap.get(decodeURIComponent(key));
  if (!b) return notFound(tr('Ovaj album nije u kolekciji.'), '#/albumi');
  const ctx = { label: b.title, href: albumHref(b.key) };
  const root = h('div.view');
  const downloadable = b.tracks.filter((t) => t.download && t.source !== 'local');
  root.append(header({
    title: b.title,
    kicker: h('a', { href: artistHref(b.artist) }, b.artist),
    meta: [b.year, totalMeta(b.tracks)].filter(Boolean).join(', '),
    art: cover(b.cover, b.title, 'hd__cv'),
    actions: [...playButtons(b.tracks, ctx),
      downloadable.length ? h('button.btn.btn--ghost', { type: 'button', onclick: () => saveToLibrary(downloadable) }, icon('download', 16), tr('Sačuvaj na računar')) : null],
  }));
  root.append(trackList(b.tracks, { context: ctx, numbered: true, album: false, coverArt: false }));
  return root;
}

// ============================================================ Pesme
export function tracksView() {
  const root = h('div.view');
  const all = store.collection;
  const body = h('div');
  let sort = 'artist', filter = '', src = 'all', kind = 'sve';
  const render = () => {
    let list = all.filter(byKind(kind));
    if (src === 'local') list = list.filter((t) => t.source === 'local');
    if (src === 'online') list = list.filter((t) => t.source !== 'local');
    if (filter) { const f = norm(filter); list = list.filter((t) => norm(`${t.title} ${t.artist} ${t.album || ''}`).includes(f)); }
    list = list.slice();
    const by = {
      artist: (x, y) => (x.artist || '').localeCompare(y.artist || '', 'sr') || (x.album || '').localeCompare(y.album || '') || (x.trackNo || 0) - (y.trackNo || 0),
      title: (x, y) => x.title.localeCompare(y.title, 'sr'),
      added: (x, y) => (y.addedAt || 0) - (x.addedAt || 0),
      plays: (x, y) => (store.playCounts[y.id] || 0) - (store.playCounts[x.id] || 0),
    }[sort];
    list.sort(by);
    body.replaceChildren(list.length ? trackList(list, { context: { label: tr('Sve pjesme'), href: '#/pesme' } }) : emptyCollection(tr('Nema pjesama za ovaj filter.')));
  };
  root.append(header({ title: tr('Pjesme'), meta: totalMeta(all), actions: playButtons(all, { label: tr('Sve pjesme'), href: '#/pesme' }) }));
  root.append(h('div.toolbar', {},
    filterInput(tr('Filtriraj pjesme'), (v) => { filter = v; render(); }),
    chips([{ value: 'sve', label: tr('Sve') }, { value: 'pjesme', label: tr('Pjesme') }, { value: 'setovi', label: tr('Setovi i miksevi') }], kind, (v) => { kind = v; render(); }, tr('Kategorija')),
    chips([{ value: 'all', label: tr('Svi izvori') }, { value: 'local', label: tr('Na računaru') }, { value: 'online', label: tr('Sa interneta') }], src, (v) => { src = v; render(); }, tr('Izvor')),
    chips([{ value: 'artist', label: tr('Izvođač') }, { value: 'title', label: tr('Naslov') }, { value: 'added', label: tr('Nedavno dodano') }, { value: 'plays', label: tr('Najslušanije') }], sort, (v) => { sort = v; render(); }, tr('Redoslijed'))));
  root.append(body);
  render();
  return root;
}

// ============================================================ Omiljene
export function favorites() {
  const root = h('div.view');
  const list = Object.values(store.favorites).sort((a, b) => b.at - a.at).map((f) => f.track).filter((t) => !t.live);
  const ctx = { label: tr('Omiljene'), href: '#/omiljene' };
  root.append(header({ title: tr('Omiljene'), meta: list.length ? totalMeta(list) : null, actions: playButtons(list, ctx) }));
  root.append(trackList(list, { context: ctx, emptyText: tr('Klikni srce pored bilo koje pjesme (ili pritisni L dok svira) i ona će se pojaviti ovdje.') }));
  return root;
}

// ============================================================ Istorija
export function historyView() {
  const root = h('div.view');
  const hist = store.history.slice().reverse();
  const weekAgo = Date.now() - 7 * 864e5;
  const week = hist.filter((x) => x.at >= weekAgo);
  const weekTime = week.reduce((s, x) => s + (x.track.live ? 0 : x.track.duration || 0), 0);

  root.append(header({
    title: tr('Historija slušanja'),
    meta: hist.length ? tr('Posljednjih 7 dana: {n}', { n: songs(week.length) }) + (weekTime ? ', ' + tr('{d} muzike', { d: fmtDuration(weekTime) }) : '') : null,
    actions: hist.length ? [
      store.settings.hasListenbrainz ? h('a.btn.btn--ghost', { href: 'https://listenbrainz.org/my/listens/', target: '_blank', rel: 'noopener' }, icon('external', 16), tr('Statistike na ListenBrainz-u')) : null,
      h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        if (await ask(tr('Obrisati cijelu historiju slušanja?'), { input: false, confirm: tr('Obriši'), danger: true })) { await store.clearHistory(); toast(tr('Historija je obrisana')); }
      } }, icon('trash', 16), tr('Obriši historiju')),
    ] : [],
  }));
  if (!hist.length) {
    root.append(h('p.empty', {}, tr('Pjesma se upisuje u historiju kad odslušaš bar polovinu (ili 4 minuta). Radio stanice poslije 30 sekundi.')));
    return root;
  }

  // Najslušaniji izvođači u poslednjih 30 dana
  const monthAgo = Date.now() - 30 * 864e5;
  const counts = new Map();
  for (const x of hist) {
    if (x.at < monthAgo || x.track.live) continue;
    const name = x.track.artist || tr('Nepoznat');
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) {
    const max = top[0][1];
    root.append(section(tr('Najslušaniji izvođači u posljednjih 30 dana'), h('ol.rank', {}, top.map(([name, n]) =>
      h('li.rank__item', {},
        store.index.artistMap.has(norm(name)) ? h('a.rank__name', { href: artistHref(name) }, name) : h('span.rank__name', {}, name),
        h('span.rank__bar', { style: { '--w': (n / max * 100).toFixed(1) + '%' }, 'aria-hidden': 'true' }),
        h('span.rank__n', {}, plural(n, ['put', 'puta', 'puta'], ['play', 'plays'])))))));
  }

  // Po danima (prvih 400 slušanja)
  const groups = new Map();
  for (const x of hist.slice(0, 400)) {
    const k = relDay(x.at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  for (const [day, items] of groups) {
    const tracks = items.map((x) => x.track);
    root.append(section(day, trackList(tracks, {
      context: { label: tr('Historija'), href: '#/istorija' },
      leading: (t, i) => new Date(items[i].at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }),
    })));
  }
  return root;
}

// ============================================================ Plejliste
export function playlistView(params, id) {
  const p = store.playlists.find((x) => x.id === id);
  if (!p) return notFound(tr('Ova plejlista više ne postoji.'), '#/');
  const ctx = { label: p.name, href: '#/plejlista/' + p.id };
  const root = h('div.view');
  root.append(header({
    title: p.name,
    kicker: tr('Plejlista'),
    meta: p.tracks.length ? totalMeta(p.tracks) : tr('Prazna'),
    art: collage(p.tracks.map((t) => t.cover), p.name),
    actions: [
      ...playButtons(p.tracks, ctx),
      h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        const name = await ask(tr('Preimenuj plejlistu'), { value: p.name, confirm: tr('Preimenuj') });
        if (name) await store.updatePlaylist(p.id, { name });
      } }, tr('Preimenuj')),
      p.tracks.length ? h('a.btn.btn--ghost', { href: `/api/playlists/${p.id}/m3u`, download: '' }, icon('download', 16), tr('Izvezi M3U')) : null,
      h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        if (await ask(tr('Obrisati plejlistu „{name}”?', { name: p.name }), { input: false, confirm: tr('Obriši'), danger: true })) {
          await store.deletePlaylist(p.id); toast(tr('Plejlista je obrisana')); go('#/');
        }
      } }, icon('trash', 16), tr('Obriši')),
    ],
  }));
  root.append(trackList(p.tracks, {
    context: ctx, playlist: p, sortable: true,
    emptyText: tr('Dodaj pjesme preko menija ⋯ pored bilo koje pjesme, ili desnim klikom na pjesmu.'),
  }));
  if (p.tracks.length > 1) root.append(h('p.muted.pad', {}, tr('Prevuci pjesmu mišem da promijeniš redoslijed.')));
  return root;
}

export function smartView(params, key) {
  const s = SMART.find((x) => x.key === key);
  if (!s) return notFound(tr('Nepoznata pametna plejlista.'), '#/');
  const tracks = store.smart(key);
  const ctx = { label: s.name, href: '#/pametna/' + key };
  const root = h('div.view');
  root.append(header({
    title: s.name, kicker: tr('Pametna plejlista'), meta: [s.desc, tracks.length ? totalMeta(tracks) : null].filter(Boolean).join('. '),
    art: collage(tracks.map((t) => t.cover), s.name),
    actions: [...playButtons(tracks, ctx),
      tracks.length ? h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        const name = await ask(tr('Sačuvaj kao plejlistu'), { value: `${s.name}, ${new Date().toLocaleDateString(locale())}`, confirm: tr('Sačuvaj') });
        if (!name) return;
        const p = await store.createPlaylist(name, tracks);
        toast(tr('Sačuvano kao „{name}”', { name: p.name }), { action: tr('Otvori'), onAction: () => go('#/plejlista/' + p.id) });
      } }, icon('plus', 16), tr('Sačuvaj kao plejlistu')) : null],
  }));
  root.append(trackList(tracks, { context: ctx, emptyText: tr('Ova lista se puni sama dok slušaš i dodaješ muziku.') }));
  return root;
}

// ============================================================ Radio
const RADIO_TAGS = ['pop', 'rock', 'jazz', 'classical', 'electronic', 'chillout', 'lounge', 'hits', '80s', '90s', 'folk', 'news'];
const COUNTRIES = [
  { value: 'RS', label: tr('Srbija') }, { value: 'BA', label: tr('BiH') }, { value: 'HR', label: tr('Hrvatska') },
  { value: 'ME', label: tr('Crna Gora') }, { value: 'SI', label: tr('Slovenija') }, { value: 'MK', label: tr('S. Makedonija') },
];

export function stationGrid(list) {
  return h('div.stations', {}, list.map((s) => {
    const saved = store.isStation(s.id);
    return h('div.station', { class: player.track?.id === s.id ? 'is-playing' : '', dataset: { id: s.id } },
      h('button.station__main', { type: 'button', onclick: () => player.playList([s], 0, { shuffle: false, context: { label: 'Radio', href: '#/radio' } }) },
        cover(s.cover, s.title, 'station__cv'),
        h('span.station__text', {}, h('span.station__name', {}, s.title), h('span.station__sub', {}, s.artist))),
      h('button.station__save', {
        type: 'button', class: saved ? 'is-on' : '', 'aria-pressed': String(saved),
        'aria-label': saved ? 'Ukloni iz mojih stanica' : tr('Sačuvaj stanicu'),
        onclick: async (e) => {
          const b = e.currentTarget;
          const on = await store.toggleStation(s);
          b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
          b.replaceChildren(icon(on ? 'heartFill' : 'heart', 17));
          toast(on ? tr('„{title}” je u tvojim stanicama', { title: s.title }) : tr('Stanica je uklonjena'));
        },
      }, icon(saved ? 'heartFill' : 'heart', 17)));
  }));
}

export function radioView(params) {
  const root = h('div.view');
  const saved = Object.values(store.stations);
  root.append(header({ title: 'Radio', meta: tr('Preko 40.000 internet stanica iz otvorene baze radio-browser.info') }));
  if (saved.length) root.append(section(tr('Moje stanice'), stationGrid(saved)));

  const res = h('div');
  const input = h('input.field.field--filter', { type: 'search', placeholder: tr('Naziv stanice'), 'aria-label': tr('Traži stanicu'), value: params.get('q') || '' });
  let state = { q: params.get('q') || '', tag: '', country: '' };
  let token = 0;
  async function load() {
    const my = ++token;
    res.replaceChildren(loading(tr('Tražim stanice…')));
    try {
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.tag) p.set('tag', state.tag);
      if (state.country) p.set('country', state.country);
      const list = p.toString() ? await api('/api/radio/search?' + p) : await api('/api/radio/top');
      if (my !== token) return;
      res.replaceChildren(list.length ? stationGrid(list) : h('p.empty', {}, tr('Nema stanica za ovaj izbor.')));
    } catch (e) {
      if (my === token) res.replaceChildren(errorBox(tr('Baza radio stanica ne odgovara: ') + e.message, load));
    }
  }
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = input.value.trim(); load(); }, 350); });
  root.append(section(tr('Pronađi stanicu'), h('div', {},
    h('div.toolbar', {}, h('label.filter', {}, icon('search', 16), input)),
    h('div.toolbar', {}, chips([{ value: '', label: tr('Cijeli svijet') }, ...COUNTRIES], '', (v) => { state.country = v; load(); }, tr('Država'))),
    h('div.toolbar', {}, chips([{ value: '', label: tr('Svi žanrovi') }, ...RADIO_TAGS.map((x) => ({ value: x, label: x }))], '', (v) => { state.tag = v; load(); }, tr('Žanr'))),
    res)));
  load();
  return root;
}

// ============================================================ Otkrij
const AUDIUS_GENRES = ['', 'Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'Alternative', 'Rock', 'Pop', 'R&B/Soul', 'Jazz', 'Ambient', 'House', 'Techno', 'Classical', 'Acoustic', 'Experimental'];
const IA_PRESETS = [
  { value: 'collection:etree', label: 'Live Music Archive' },
  { value: 'jazz', label: tr('Džez') },
  { value: 'classical OR symphony', label: tr('Klasika') },
  { value: 'collection:78rpm', label: tr('Ploče na 78 obrtaja') },
  { value: 'collection:netlabels AND (electronic OR ambient)', label: tr('Netlabel elektronika') },
  { value: 'blues', label: tr('Bluz') },
];

export function discover(params) {
  const root = h('div.view');
  const tab = params.get('izvor') || 'audius';
  root.append(header({ title: tr('Otkrij'), meta: tr('Besplatna i legalna muzika: izvođači koji je sami dijele, arhive i Creative Commons.') }));
  const tabs = [
    { value: 'audius', label: 'Audius' },
    { value: 'archive', label: 'Internet Archive' },
    { value: 'jamendo', label: 'Jamendo' },
  ];
  const body = h('div');
  root.append(h('div.tabs', { role: 'tablist' }, tabs.map((t) => h('a.tab', {
    role: 'tab', href: '#/otkrij?izvor=' + t.value, 'aria-selected': String(t.value === tab), class: t.value === tab ? 'is-on' : '',
  }, t.label))), body);

  if (tab === 'audius') {
    const list = h('div');
    let genre = '', time = 'week', kind = 'sve', items = [];
    const show = () => {
      const f = items.filter(byKind(kind));
      list.replaceChildren(trackList(f, { context: { label: 'Audius' + (genre ? ', ' + genre : ''), href: '#/otkrij' },
        emptyText: kind === 'setovi' ? tr('Među popularnim nema setova. Probaj pretragu „set” ili „mix”.') : tr('Nema pjesama.') }));
    };
    const load = async () => {
      list.replaceChildren(loading());
      try {
        items = await api(`/api/audius/trending?genre=${encodeURIComponent(genre)}&time=${time}`);
        show();
      } catch (e) { list.replaceChildren(errorBox(tr('Audius ne odgovara: ') + e.message, load)); }
    };
    body.append(
      h('div.toolbar', {}, chips([{ value: 'sve', label: tr('Sve') }, { value: 'pjesme', label: tr('Pjesme') }, { value: 'setovi', label: tr('Setovi i miksevi') }], 'sve', (v) => { kind = v; show(); }, tr('Kategorija'))),
      h('div.toolbar', {}, chips(AUDIUS_GENRES.map((g) => ({ value: g, label: g || tr('Svi žanrovi') })), '', (v) => { genre = v; load(); }, tr('Žanr'))),
      h('div.toolbar', {}, chips([{ value: 'week', label: tr('Ove sedmice') }, { value: 'month', label: tr('Ovog mjeseca') }, { value: 'year', label: tr('Ove godine') }, { value: 'allTime', label: tr('Svih vremena') }], 'week', (v) => { time = v; load(); }, tr('Period'))),
      list);
    load();
  }

  if (tab === 'archive') {
    const list = h('div');
    const load = async (q) => {
      list.replaceChildren(loading());
      try { const items = await api('/api/archive/search?q=' + encodeURIComponent(q)); list.replaceChildren(items.length ? grid(items.map(archiveTile)) : h('p.empty', {}, tr('Nema rezultata.'))); }
      catch (e) { list.replaceChildren(errorBox(tr('Internet Archive ne odgovara: ') + e.message, () => load(q))); }
    };
    body.append(
      h('p.muted.pad', {}, tr('Koncertni snimci uz dozvolu izvođača, netlabel izdanja i stari snimci u javnom domenu. Sve možeš da sačuvaš na računar.')),
      h('div.toolbar', {}, chips(IA_PRESETS, IA_PRESETS[0].value, load, tr('Kolekcija'))),
      list);
    load(IA_PRESETS[0].value);
  }

  if (tab === 'jamendo') {
    if (!store.settings.hasJamendo) {
      body.append(h('div.note', {},
        h('h2', {}, tr('Uključi Jamendo')),
        h('p', {}, tr('Jamendo ima stotine hiljada pjesama pod Creative Commons licencom, mnoge sa dozvolom za preuzimanje. Za pristup treba besplatan ključ:')),
        h('ol', {},
          h('li', {}, tr('Napravi nalog na '), h('a', { href: 'https://devportal.jamendo.com', target: '_blank', rel: 'noopener' }, 'devportal.jamendo.com'), '.'),
          h('li', {}, tr('Klikni „Create a new app” i kopiraj Client ID.')),
          h('li', {}, tr('Zalijepi ga u Postavke, pod Jamendo.'))),
        h('a.btn', { href: '#/podesavanja' }, tr('Otvori postavke'))));
    } else {
      const list = h('div');
      const load = async (tag) => {
        list.replaceChildren(loading());
        try { list.replaceChildren(trackList(await api('/api/jamendo/popular?tag=' + encodeURIComponent(tag)), { context: { label: 'Jamendo', href: '#/otkrij?izvor=jamendo' } })); }
        catch (e) { list.replaceChildren(errorBox(e.message, () => load(tag))); }
      };
      body.append(h('div.toolbar', {}, chips(['', 'pop', 'rock', 'electronic', 'jazz', 'lounge', 'classical', 'hiphop', 'world', 'soundtrack'].map((x) => ({ value: x, label: x || tr('Sve') })), '', load, tr('Žanr'))), list);
      load('');
    }
  }
  return root;
}

function archiveTile(x) {
  return {
    title: x.title, sub: [x.artist, x.year].filter(Boolean).join(', '),
    href: '#/archive/' + encodeURIComponent(x.identifier), cover: x.cover,
    play: async () => {
      try {
        const d = await api('/api/archive/item/' + encodeURIComponent(x.identifier));
        if (!d.tracks.length) { toast(tr('Ovo izdanje nema snimke koje browser može da pusti'), { error: true }); return; }
        player.playList(d.tracks, 0, { shuffle: false, context: { label: d.album.title, href: '#/archive/' + x.identifier } });
      } catch (e) { toast(e.message, { error: true }); }
    },
  };
}

export function archiveView(params, id) {
  id = decodeURIComponent(id);
  const root = h('div.view', {}, loading(tr('Učitavam izdanje sa Internet Archive-a…')));
  api('/api/archive/item/' + encodeURIComponent(id)).then(({ album: a, tracks }) => {
    const ctx = { label: a.title, href: '#/archive/' + id };
    root.replaceChildren(header({
      title: a.title, kicker: a.artist,
      meta: [a.year, tracks.length ? totalMeta(tracks) : null].filter(Boolean).join(', '),
      art: cover(a.cover, a.title, 'hd__cv'),
      actions: [...playButtons(tracks, ctx),
        tracks.length ? h('button.btn.btn--ghost', { type: 'button', onclick: () => saveToLibrary(tracks) }, icon('download', 16), tr('Sačuvaj album na računar')) : null,
        h('a.btn.btn--ghost', { href: a.link, target: '_blank', rel: 'noopener' }, icon('external', 16), 'archive.org')],
    }));
    if (a.description) root.append(h('p.desc', {}, a.description));
    if (a.license) root.append(h('p.muted.pad', {}, tr('Licenca: '), h('a', { href: a.license, target: '_blank', rel: 'noopener' }, a.license)));
    root.append(trackList(tracks, { context: ctx, numbered: true, album: false, coverArt: false, emptyText: tr('Ovo izdanje nema snimke koje browser može da pusti.') }));
  }).catch((e) => root.replaceChildren(errorBox(tr('Ne mogu da učitam izdanje: ') + e.message, () => go(location.hash))));
  return root;
}

// ============================================================ Podešavanja
export function settingsView() {
  const root = h('div.view.view--narrow');
  root.append(header({ title: tr('Postavke') }));

  // ---- izgled
  const THEMES = [{ value: 'crna', label: tr('Crna'), sw: '#000000' }, { value: 'indigo', label: tr('Noćni indigo'), sw: '#1c1f3a' }];
  const pick = h('div.theme-pick', { role: 'group', 'aria-label': tr('Tema') });
  const renderThemes = () => pick.replaceChildren(...THEMES.map((t) => h('button.theme-opt', {
    type: 'button', 'aria-pressed': String((document.documentElement.dataset.theme || 'crna') === t.value),
    onclick: () => { setTheme(t.value); renderThemes(); },
  }, h('span.theme-opt__sw', { style: { '--sw': t.sw }, 'aria-hidden': 'true' }), t.label)));
  renderThemes();
  const langPick = h('div.theme-pick', { role: 'group', 'aria-label': tr('Jezik') }, [{ value: 'bs', label: 'Bosanski' }, { value: 'en', label: 'English' }].map((l) =>
    h('button.theme-opt', { type: 'button', 'aria-pressed': String(lang === l.value), onclick: () => { if (lang !== l.value) setLang(l.value); } },
      h('span.theme-opt__flag', { 'aria-hidden': 'true' }, l.value.toUpperCase()), l.label)));
  root.append(section(tr('Jezik / Language'), langPick));
  root.append(section(tr('Izgled'), pick));

  // ---- fascikle
  const folders = store.folders.slice();
  const folderList = h('ul.folders');
  const renderFolders = () => folderList.replaceChildren(...folders.map((f, i) => h('li.folders__item', {},
    icon('folder', 16), h('code', {}, f),
    folders.length > 1 ? h('button.ibtn', { type: 'button', 'aria-label': tr('Ukloni folder'), onclick: async () => {
      folders.splice(i, 1); await store.saveSettings({ folders }); renderFolders(); toast(tr('Folder je uklonjen iz biblioteke'));
    } }, icon('close', 16)) : null)));
  renderFolders();
  const newFolder = h('input.field', { type: 'text', placeholder: '/Users/ime/Music/Drugi folder', 'aria-label': tr('Putanja do foldera') });
  root.append(section(tr('Muzika na računaru'), h('div.form', {},
    h('p.muted', {}, tr('{n} u bibliotekama. Nove pjesme se pojavljuju same čim ih ubaciš u folder.', { n: songs(store.library.length) })),
    folderList,
    h('form.row', { onsubmit: async (e) => {
      e.preventDefault();
      const v = newFolder.value.trim();
      if (!v) return;
      folders.push(v); await store.saveSettings({ folders }); newFolder.value = ''; renderFolders(); toast(tr('Folder je dodan, skeniram…'));
    } }, newFolder, h('button.btn', {}, tr('Dodaj folder'))),
    h('button.btn.btn--ghost', { type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const r = await api('/api/library/rescan', { method: 'POST', body: {} });
      await store.reloadLibrary();
      toast(tr('Skenirano: {n}', { n: songs(r.count) }));
      e.target.disabled = false;
    } }, icon('refresh', 16), tr('Skeniraj ponovo')),
    h('p.muted', {}, tr('Savjet: alat '), h('a', { href: 'https://beets.io', target: '_blank', rel: 'noopener' }, 'beets'),
      tr(' sam ispravlja tagove i omote i ređa fajlove po izvođaču i albumu. Komanda: '), h('code', {}, 'beet import ~/Downloads/novi-album')))));

  // ---- ListenBrainz
  const lbInput = h('input.field', { type: 'password', placeholder: store.settings.hasListenbrainz ? 'Token je sačuvan' : tr('Zalijepi token'), 'aria-label': 'ListenBrainz token', autocomplete: 'off' });
  const lbStatus = h('p.muted', {}, store.settings.hasListenbrainz ? 'Povezano: svaka odslušana pjesma se upisuje i na ListenBrainz.' : tr('Nije povezano.'));
  root.append(section(tr('Historija na ListenBrainz-u'), h('div.form', {},
    h('p.muted', {}, tr('Besplatan servis otvorenog koda: čuva cijelu historiju, pravi godišnje preglede i sedmične preporuke. Može da bilježi i ono što slušaš na Spotify-ju, pa imaš jednu historiju za sve.')),
    h('form.row', { onsubmit: async (e) => {
      e.preventDefault();
      const r = await store.saveSettings({ listenbrainzToken: lbInput.value.trim() });
      lbInput.value = '';
      if (r.listenbrainz?.valid) { lbStatus.textContent = tr('Povezano kao {user}.', { user: r.listenbrainz.user }); toast(tr('ListenBrainz je povezan')); }
      else if (r.listenbrainz) { lbStatus.textContent = tr('Token nije prihvaćen. Kopiraj ga ponovo sa stranice ispod.'); toast(tr('ListenBrainz nije prihvatio token'), { error: true }); }
      else { lbStatus.textContent = tr('Nije povezano.'); toast(tr('ListenBrainz je isključen')); }
    } }, lbInput, h('button.btn', {}, tr('Sačuvaj'))),
    lbStatus,
    h('p.muted', {}, tr('Token nađeš na '), h('a', { href: 'https://listenbrainz.org/settings/', target: '_blank', rel: 'noopener' }, 'listenbrainz.org/settings'), tr('. Prazno polje i Sačuvaj isključuje vezu.')))));

  // ---- Jamendo
  const jmInput = h('input.field', { type: 'password', placeholder: store.settings.hasJamendo ? 'Client ID je sačuvan' : 'Jamendo Client ID', 'aria-label': 'Jamendo Client ID', autocomplete: 'off' });
  root.append(section('Jamendo', h('div.form', {},
    h('p.muted', {}, tr('Creative Commons muzika. Besplatan Client ID dobiješ na '), h('a', { href: 'https://devportal.jamendo.com', target: '_blank', rel: 'noopener' }, 'devportal.jamendo.com'), '.'),
    h('form.row', { onsubmit: async (e) => {
      e.preventDefault();
      await store.saveSettings({ jamendoClientId: jmInput.value.trim() });
      jmInput.value = '';
      toast(store.settings.hasJamendo ? 'Jamendo je uključen' : tr('Jamendo je isključen'));
    } }, jmInput, h('button.btn', {}, tr('Sačuvaj'))))));

  // ---- Uvoz sa Spotify-ja
  const importOut = h('div');
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'visually-hidden', id: 'csv' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    importOut.replaceChildren(spotifyImport(await f.text(), f.name.replace(/\.csv$/i, '')));
    file.value = '';
  });
  root.append(section(tr('Uvoz plejliste sa Spotify-ja'), h('div.form', {},
    h('p.muted', {}, tr('Na '), h('a', { href: 'https://exportify.app', target: '_blank', rel: 'noopener' }, 'exportify.app'),
      tr(' (otvoren kod) izvezi plejlistu ili „Liked Songs” u CSV. Tunes pronađe te pjesme u tvojoj biblioteci, napravi plejlistu i pokaže šta ti nedostaje.')),
    file, h('label.btn', { for: 'csv' }, icon('plus', 16), tr('Odaberi CSV fajl')),
    importOut)));

  // ---- rezervna kopija
  root.append(section(tr('Rezervna kopija'), h('div.form', {},
    h('p.muted', {}, tr('Omiljene, plejliste i historija u jednom JSON fajlu.')),
    h('a.btn.btn--ghost', { href: '/api/export', download: '' }, icon('download', 16), tr('Preuzmi kopiju')))));

  // ---- prečice
  const keys = [
    [tr('Razmak'), tr('Pusti / pauziraj')], ['← →', tr('Premotaj 5 sekundi')], ['Shift + ← →', tr('Prethodna / sljedeća pjesma')],
    ['↑ ↓', tr('Jačina zvuka')], ['M', tr('Utišaj')], ['L', tr('Omiljena (srce)')], ['S', tr('Nasumično')], ['R', tr('Ponavljanje')],
    ['/', tr('Pretraga')], ['Q', tr('Red za puštanje')], ['T', tr('Tekst pjesme')], ['E', tr('Ekvalizer')], ['F', tr('Cijeli ekran: sada svira')], ['Esc', tr('Zatvori')],
  ];
  root.append(section(tr('Prečice na tastaturi'), h('dl.keys', {}, keys.flatMap(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)]))));

  root.append(section(tr('Slušanje na mobitelu'), h('div.form', {},
    h('p.muted', {}, tr('Klikni „Slušaj na mobitelu” u lijevom meniju i skeniraj QR kod kamerom telefona. Telefon mora biti na istoj Wi-Fi mreži.')),
    h('button.btn', { type: 'button', onclick: () => document.dispatchEvent(new CustomEvent('open-phone')) }, icon('phone', 16), tr('Slušaj na mobitelu')))));
  return root;
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'crna' ? '#000000' : '#1c1f3a';
  try { localStorage.setItem('sl.theme', JSON.stringify(t)); } catch { /* */ }
}

// Exportify CSV -> plejlista od pesama koje već imaš.
function spotifyImport(text, name) {
  const rows = parseCsv(text);
  const head = rows.shift() || [];
  const col = (re) => head.findIndex((x) => re.test(x));
  const ti = col(/^track name$/i), ai = col(/^artist name/i), bi = col(/^album name$/i);
  if (ti < 0 || ai < 0) return h('p.err', {}, tr('Ovo ne liči na Exportify CSV: nedostaju kolone „Track Name” i „Artist Name(s)”.'));
  const lib = store.library.map((t) => ({ t, title: norm(t.title.replace(/\s*[([].*?[)\]]/g, '')), artist: norm(t.artist) }));
  const found = [], missing = [];
  for (const r of rows) {
    if (!r[ti]) continue;
    const title = norm(r[ti].replace(/\s*[([].*?[)\]]/g, '').replace(/ - .*(remaster|live|version|mix).*$/i, ''));
    const artists = (r[ai] || '').split(/[,;]/).map(norm).filter(Boolean);
    const hit = lib.find((x) => x.title === title && artists.some((a) => x.artist.includes(a) || a.includes(x.artist)))
      || lib.find((x) => x.title === title);
    if (hit) found.push(hit.t); else missing.push({ title: r[ti], artist: r[ai], album: bi >= 0 ? r[bi] : '' });
  }
  const out = h('div.import', {},
    h('p', {}, tr('Pronađeno na računaru: {found} od {total}.', { found: found.length, total: found.length + missing.length })));
  if (found.length) {
    out.append(h('button.btn.btn--primary', { type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const p = await store.createPlaylist(name || tr('Sa Spotify-ja'), found);
      toast(tr('Napravljena plejlista „{name}”', { name: p.name }), { action: tr('Otvori'), onAction: () => go('#/plejlista/' + p.id) });
    } }, icon('plus', 16), tr('Napravi plejlistu „{name}”', { name })));
  }
  if (missing.length) {
    out.append(h('details.missing', {},
      h('summary', {}, tr('Nedostaje {n}: potraži ih na Bandcamp-u, Jamendo-u ili Audius-u', { n: songs(missing.length) })),
      h('ul', {}, missing.slice(0, 500).map((m) => h('li', {},
        h('span', {}, `${m.artist} – ${m.title}`),
        h('a', { href: '#/pretraga?q=' + encodeURIComponent(`${m.artist.split(',')[0]} ${m.title}`) }, tr('Traži')),
        h('a', { href: 'https://bandcamp.com/search?q=' + encodeURIComponent(`${m.artist.split(',')[0]} ${m.title}`), target: '_blank', rel: 'noopener' }, 'Bandcamp'))))));
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
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

// ============================================================ pomoćno
function emptyCollection(text) {
  return h('div.note', {},
    h('p', {}, text, tr(' Kolekciju čine pjesme sa računara i sve što označiš srcem na internetu.')),
    h('div.row', {}, h('a.btn', { href: '#/otkrij' }, icon('compass', 16), tr('Otkrij muziku')), h('a.btn.btn--ghost', { href: '#/podesavanja' }, icon('folder', 16), tr('Folderi'))));
}

function notFound(text, back) {
  return h('div.view', {}, h('div.note', {}, h('p', {}, text), h('a.btn', { href: back }, tr('Nazad'))));
}

export { EQ_PRESETS, addToPlaylist, toggleFav, sourceTag, fmtTime };

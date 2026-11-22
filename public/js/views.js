// All app screens. Each view returns a DOM element.
import { h, icon, cover, fmtTime, fmtDuration, songs, plural, relDay, sourceTag, toast, ask, norm, SOURCES, isSet, tr } from './ui.js';
import { lang, setLang, locale, LANGUAGES } from './i18n.js';
import { renderOfflineSettings } from './offline.js';
import { findSoundCloudUrl } from './soundcloud.js';
import { store, api, SMART } from './store.js';
import { player, EQ_PRESETS } from './player.js';
import {
  go, artistHref, albumHref, trackList, grid, collage, header, playButtons, totalMeta, section,
  filterInput, chips, loading, errorBox, saveToLibrary, addToPlaylist, toggleFav,
} from './components.js';

// ============================================================ Home
export function home() {
  const hour = new Date().getHours();
  const hello = hour < 5 ? tr('Good night') : hour < 11 ? tr('Good morning') : hour < 18 ? tr('Good afternoon') : tr('Good evening');
  const lib = store.library;
  const idx = store.index;
  const root = h('div.view');
  root.append(header({
    title: hello,
    meta: lib.length
      ? tr('On this computer: {a}, {b}, {c}', { a: songs(lib.length), b: plural(idx.artists.length, 'artist', 'artists'), c: plural(idx.albums.length, 'album', 'albums') })
      : tr('Your local library is empty, but internet radio, Audius and Internet Archive work right away.'),
    big: true,
  }));

  if (!lib.length) {
    root.append(h('div.note', {},
      h('h2', {}, tr('Add your music')),
      h('p', {}, tr('Put MP3, FLAC or M4A files in the folder '), h('code', {}, store.folders[0] || '~/Music/Tunes'),
        tr('. Tunes picks them up in seconds and sorts them by artist and album.')),
      h('a.btn', { href: '#/settings' }, icon('folder', 16), tr('Set up folders'))));
  }

  // Recently played: unique tracks, newest first.
  const seen = new Set();
  const recent = [];
  for (let i = store.history.length - 1; i >= 0 && recent.length < 8; i--) {
    const t = store.history[i].track;
    if (!seen.has(t.id)) { seen.add(t.id); recent.push(t); }
  }
  if (recent.length) {
    root.append(section(tr('Recently played'), trackList(recent, { context: { label: tr('Recently played'), href: '#/history' }, album: false }), { href: '#/history', label: tr('Full history') }));
  }

  const smartTiles = SMART.map((s) => ({ s, tracks: store.smart(s.key) })).filter((x) => x.tracks.length);
  if (smartTiles.length) {
    root.append(section(tr('Smart playlists'), grid(smartTiles.map(({ s, tracks }) => ({
      title: tr(s.name), sub: tr(s.desc), href: '#/smart/' + s.key,
      collage: tracks.map((t) => t.cover),
      play: () => player.playList(tracks, 0, { shuffle: false, context: { label: tr(s.name), href: '#/smart/' + s.key } }),
    })))));
  }

  const stations = Object.values(store.stations);
  if (stations.length) root.append(section(tr('My stations'), stationGrid(stations), { href: '#/radio', label: tr('All radio') }));

  const trend = h('div', {}, loading(tr('Loading what\'s popular on Audius…')));
  root.append(section(tr('Popular this week on Audius'), trend, { href: '#/discover', label: tr('Discover more') }));
  api('/api/audius/trending').then((list) => {
    trend.replaceChildren(trackList(list.slice(0, 10), { context: { label: tr('Audius, popular'), href: '#/discover' } }));
  }).catch((e) => trend.replaceChildren(errorBox(tr('Audius isn\'t responding: ') + e.message)));

  return root;
}

// ============================================================ Search
let lastSources = ['audius', 'archive', 'radio', 'jamendo'];
const KINDS = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'sets', label: 'Sets & mixes' },
  { value: 'albums', label: 'Albums & concerts' },
  { value: 'artists', label: 'Artists' },
  { value: 'radio', label: 'Radio stations' },
];
// Which online sources each category needs.
const KIND_SOURCES = {
  all: ['audius', 'artists', 'archive', 'radio', 'jamendo'],
  songs: ['audius', 'jamendo'],
  sets: ['audius', 'jamendo'],
  albums: ['archive'],
  artists: ['artists'],
  radio: ['radio'],
};
const byKind = (kind) => (x) => (kind === 'songs' ? !isSet(x) : kind === 'sets' ? isSet(x) : true);

export function search(params) {
  const q0 = params.get('q') || '';
  let kind = KINDS.some((k) => k.value === params.get('type')) ? params.get('type') : 'all';
  const root = h('div.view');
  const input = h('input.field.field--search', { type: 'search', value: q0, placeholder: tr('Song, set, artist, album, station…'), 'aria-label': tr('Search'), autofocus: true });
  const results = h('div.results');
  root.append(h('div.searchbar', {}, icon('search', 22), input));
  root.append(h('div.searchsrc', {}, h('span.muted', {}, tr('Show:')),
    chips(KINDS, kind, (v) => { kind = v; run(input.value, true); }, tr('Category'))));

  const onlineSrc = ['audius', 'archive', 'radio'].concat(store.settings.hasJamendo ? ['jamendo'] : []);
  const srcChips = h('div.chips', { role: 'group', 'aria-label': tr('Online sources') }, onlineSrc.map((s) => {
    const on = lastSources.includes(s);
    const b = h('button.chip', { type: 'button', class: (on ? 'is-on ' : '') + 'chip--' + s, 'aria-pressed': String(on), onclick: () => {
      lastSources = lastSources.includes(s) ? lastSources.filter((x) => x !== s) : [...lastSources, s];
      b.classList.toggle('is-on'); b.setAttribute('aria-pressed', String(lastSources.includes(s)));
      run(input.value, true);
    } }, tr(SOURCES[s].name));
    return b;
  }));
  root.append(h('div.searchsrc', {}, h('span.muted', {}, tr('Also search:')), srcChips), results);

  let token = 0;
  let onlineTimer;
  function run(q, force) {
    q = q.trim();
    const my = ++token;
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (kind !== 'all') qs.set('type', kind);
    history.replaceState(null, '', '#/search' + (qs.toString() ? '?' + qs : ''));
    results.replaceChildren();
    if (!q) {
      results.append(h('div.hints', {},
        h('p.muted', {}, tr('Try one of these:')),
        h('div.chips', {}, ['lofi', 'jazz', 'techno set', 'boiler room', 'Grateful Dead', 'ambient', 'Sarajevo radio'].map((x) =>
          h('button.chip', { type: 'button', onclick: () => { input.value = x; run(x); } }, x))),
        h('p.muted', {}, tr('You can also paste a SoundCloud link to a song, set or artist.'))));
      return;
    }
    const here = '#/search?' + qs;
    const scUrl = findSoundCloudUrl(q);
    if (scUrl) { results.append(soundCloudResult(scUrl, here, () => my === token)); return; }
    const local = store.searchLocal(q);
    const localTracks = local.tracks.filter(byKind(kind));
    let shown = 0;
    if (['all', 'artists'].includes(kind) && local.artists.length) {
      shown++; results.append(section(tr('Artists in your collection'), grid(local.artists.slice(0, 12).map(artistTile), { round: true })));
    }
    if (['all', 'albums'].includes(kind) && local.albums.length) {
      shown++; results.append(section(tr('Albums in your collection'), grid(local.albums.slice(0, 12).map(albumTile))));
    }
    if (['all', 'songs', 'sets'].includes(kind) && localTracks.length) {
      shown++;
      results.append(section(kind === 'sets' ? tr('Sets in your collection') : tr('Songs in your collection'),
        trackList(localTracks.slice(0, 50), { context: { label: tr('Search “{q}”', { q }), href: here } })));
    }
    if (!shown && store.collection.length && kind !== 'radio') {
      results.append(h('p.muted.pad', {}, tr('Nothing in your collection for “{q}”. Online results are coming below.', { q })));
    }
    const online = h('div.online');
    results.append(online);
    // SoundCloud can't be searched without a paid API key: search on their site, paste the link here.
    if (kind !== 'radio') {
      results.append(h('p.muted.pad.scsearch', {}, icon('cloud', 16), tr('Looking for something on SoundCloud? '),
        h('a', { href: 'https://soundcloud.com/search?q=' + encodeURIComponent(q), target: '_blank', rel: 'noopener' }, tr('Search on SoundCloud')),
        tr(', copy the link of a song, set or artist and paste it here.')));
    }
    clearTimeout(onlineTimer);
    const src = KIND_SOURCES[kind].filter((x) => lastSources.includes(x === 'artists' ? 'audius' : x));
    if (!src.length) {
      online.append(h('p.empty', {}, tr('Turn on at least one source above to search online.')));
      return;
    }
    onlineTimer = setTimeout(async () => {
      online.replaceChildren(loading(tr('Searching online…')));
      let data;
      try { data = await api('/api/search?q=' + encodeURIComponent(q) + '&src=' + src.join(',') + '&type=' + kind); }
      catch (e) { if (my === token) online.replaceChildren(errorBox(tr('Online search failed: ') + e.message, () => run(q, true))); return; }
      if (my !== token) return;
      online.replaceChildren();
      const ctx = (name) => ({ label: `${name}: „${q}”`, href: here });
      const emptyText = kind === 'sets'
        ? tr('No sets for “{q}”. Try adding “set”, “mix” or a festival name.', { q })
        : tr('No results.');
      const block = (key, title, render, filter) => {
        const r = data[key];
        if (!r) return;
        if (r.error) { online.append(section(title, errorBox(r.error))); return; }
        const items = filter ? (r.items || []).filter(filter) : r.items || [];
        if (!items.length) { online.append(section(title, h('p.empty', {}, emptyText))); return; }
        online.append(section(title, render(items)));
      };
      const tracksTitle = (name) => (kind === 'sets' ? tr('{name}: sets & mixes', { name }) : kind === 'songs' ? tr('{name}: songs', { name }) : null);
      block('artists', tr('Artists on Audius'), (items) => grid((kind === 'all' ? items.slice(0, 6) : items).map(audiusArtistTile), { round: true }));
      block('audius', tracksTitle('Audius') || tr('Audius: independent artists'), (items) => trackList(items, { context: ctx('Audius') }), byKind(kind));
      block('jamendo', tracksTitle('Jamendo') || tr('Jamendo: Creative Commons'), (items) => trackList(items, { context: ctx('Jamendo') }), byKind(kind));
      block('archive', tr('Internet Archive: concerts and releases'), (items) => grid(items.map(archiveTile)));
      block('radio', tr('Radio stations'), (items) => stationGrid(items));
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
    sub: plural(a.followers, 'follower', 'followers'),
    href: '#/audius/' + encodeURIComponent(a.id),
    cover: a.cover,
  };
}

// An Audius artist: all their tracks and sets.
export function audiusArtist(params, id) {
  id = decodeURIComponent(id);
  const root = h('div.view', {}, loading());
  let sort = 'plays', kind = 'all';
  const list = h('div');
  let data = null;
  const renderList = () => {
    const tracks = data.tracks.filter(byKind(kind));
    list.replaceChildren(trackList(tracks, {
      context: { label: data.artist.name, href: '#/audius/' + id },
      emptyText: kind === 'sets' ? tr('This artist has no sets or mixes.') : tr('No songs.'),
    }));
  };
  const load = async () => {
    list.replaceChildren(loading());
    try { data = await api(`/api/audius/user/${encodeURIComponent(id)}?sort=${sort}`); }
    catch (e) { root.replaceChildren(errorBox(tr('Audius isn\'t responding: ') + e.message, load)); return; }
    if (!root.querySelector('.hd')) {
      const a = data.artist;
      const sets = data.tracks.filter(isSet).length;
      root.replaceChildren(header({
        title: a.name, big: true,
        kicker: 'Audius',
        meta: [plural(a.followers, 'follower', 'followers'), songs(data.tracks.length),
          sets ? plural(sets, 'set', 'sets') : null].filter(Boolean).join(', '),
        art: cover(a.cover, a.name, 'hd__cv hd__cv--round'),
        actions: [...playButtons(data.tracks, { label: a.name, href: '#/audius/' + id }),
          h('a.btn.btn--ghost', { href: a.link, target: '_blank', rel: 'noopener' }, icon('external', 16), 'audius.co')],
      }));
      if (a.bio) root.append(h('p.desc', {}, a.bio.slice(0, 500)));
      root.append(h('div.toolbar', {},
        chips([{ value: 'all', label: tr('All') }, { value: 'songs', label: tr('Songs') }, { value: 'sets', label: tr('Sets & mixes') }], kind, (v) => { kind = v; renderList(); }, tr('Category')),
        chips([{ value: 'plays', label: tr('Most popular') }, { value: 'date', label: tr('Newest') }], sort, (v) => { sort = v; load(); }, tr('Sort'))),
      list);
    }
    renderList();
  };
  load();
  return root;
}

// ============================================================ Artists and albums
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
    body.replaceChildren(list.length ? grid(list.map(artistTile), { round: true }) : emptyCollection(tr('No artists yet.')));
  };
  root.append(header({ title: tr('Artists'), meta: tr('{n} in your collection', { n: plural(all.length, 'artist', 'artists') }) }),
    ...(all.length > 8 ? [h('div.toolbar', {}, filterInput(tr('Filter artists'), render))] : []), body);
  render('');
  return root;
}

export function artist(params, key) {
  const a = store.index.artistMap.get(decodeURIComponent(key));
  if (!a) return notFound(tr('This artist isn\'t in your collection.'), '#/artists');
  const root = h('div.view');
  const albums = [...a.albums].map((k) => store.index.albumMap.get(k)).sort((x, y) => (y.year || 0) - (x.year || 0));
  const tracks = a.tracks.slice().sort((x, y) => (x.album || '').localeCompare(y.album || '') || (x.trackNo || 0) - (y.trackNo || 0));
  const ctx = { label: a.name, href: artistHref(a.name) };
  root.append(header({
    title: a.name, big: true,
    meta: [plural(albums.length, 'album', 'albums'), totalMeta(tracks)].join(', '),
    actions: [...playButtons(tracks, ctx),
      h('a.btn.btn--ghost', { href: '#/search?q=' + encodeURIComponent(a.name) }, icon('search', 16), tr('Find more online'))],
  }));
  if (albums.length) root.append(section(tr('Albums'), grid(albums.map(albumTile))));
  root.append(section(tr('All songs'), trackList(tracks, { context: ctx })));
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
    body.replaceChildren(list.length ? grid(list.map(albumTile)) : emptyCollection(tr('No albums yet.')));
  };
  root.append(header({ title: tr('Albums'), meta: tr('{n} in your collection', { n: plural(all.length, 'album', 'albums') }) }));
  if (all.length > 1) {
    root.append(h('div.toolbar', {},
      filterInput(tr('Filter albums'), (v) => { filter = v; render(); }),
      chips([{ value: 'artist', label: tr('By artist') }, { value: 'title', label: tr('By title') }, { value: 'year', label: tr('By year') }, { value: 'added', label: tr('Recently added') }],
        sort, (v) => { sort = v; render(); }, tr('Sort'))));
  }
  root.append(body);
  render();
  return root;
}

export function album(params, key) {
  const b = store.index.albumMap.get(decodeURIComponent(key));
  if (!b) return notFound(tr('This album isn\'t in your collection.'), '#/albums');
  const ctx = { label: b.title, href: albumHref(b.key) };
  const root = h('div.view');
  const downloadable = b.tracks.filter((t) => t.download && t.source !== 'local');
  root.append(header({
    title: b.title,
    kicker: h('a', { href: artistHref(b.artist) }, b.artist),
    meta: [b.year, totalMeta(b.tracks)].filter(Boolean).join(', '),
    art: cover(b.cover, b.title, 'hd__cv'),
    actions: [...playButtons(b.tracks, ctx),
      downloadable.length ? h('button.btn.btn--ghost', { type: 'button', onclick: () => saveToLibrary(downloadable) }, icon('download', 16), tr('Save to computer')) : null],
  }));
  root.append(trackList(b.tracks, { context: ctx, numbered: true, album: false, coverArt: false }));
  return root;
}

// ============================================================ Tracks
export function tracksView() {
  const root = h('div.view');
  const all = store.collection;
  const body = h('div');
  let sort = 'artist', filter = '', src = 'all', kind = 'all';
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
    body.replaceChildren(list.length ? trackList(list, { context: { label: tr('All songs'), href: '#/songs' } }) : emptyCollection(tr('No songs match this filter.')));
  };
  root.append(header({ title: tr('Songs'), meta: totalMeta(all), actions: playButtons(all, { label: tr('All songs'), href: '#/songs' }) }));
  root.append(h('div.toolbar', {},
    filterInput(tr('Filter songs'), (v) => { filter = v; render(); }),
    chips([{ value: 'all', label: tr('All') }, { value: 'songs', label: tr('Songs') }, { value: 'sets', label: tr('Sets & mixes') }], kind, (v) => { kind = v; render(); }, tr('Category')),
    chips([{ value: 'all', label: tr('All sources') }, { value: 'local', label: tr('On this computer') }, { value: 'online', label: tr('Online') }], src, (v) => { src = v; render(); }, tr('Source')),
    chips([{ value: 'artist', label: tr('Artist') }, { value: 'title', label: tr('Title') }, { value: 'added', label: tr('Recently added') }, { value: 'plays', label: tr('Most played') }], sort, (v) => { sort = v; render(); }, tr('Sort'))));
  root.append(body);
  render();
  return root;
}

// ============================================================ Favorites
export function favorites() {
  const root = h('div.view');
  const list = Object.values(store.favorites).sort((a, b) => b.at - a.at).map((f) => f.track).filter((t) => !t.live);
  const ctx = { label: tr('Favorites'), href: '#/favorites' };
  root.append(header({ title: tr('Favorites'), meta: list.length ? totalMeta(list) : null, actions: playButtons(list, ctx) }));
  root.append(trackList(list, { context: ctx, emptyText: tr('Click the heart next to any song (or press L while it plays) and it will show up here.') }));
  return root;
}

// ============================================================ History
export function historyView() {
  const root = h('div.view');
  const hist = store.history.slice().reverse();
  const weekAgo = Date.now() - 7 * 864e5;
  const week = hist.filter((x) => x.at >= weekAgo);
  const weekTime = week.reduce((s, x) => s + (x.track.live ? 0 : x.track.duration || 0), 0);

  root.append(header({
    title: tr('Listening history'),
    meta: hist.length ? tr('Last 7 days: {n}', { n: songs(week.length) }) + (weekTime ? ', ' + tr('{d} of music', { d: fmtDuration(weekTime) }) : '') : null,
    actions: hist.length ? [
      store.settings.hasListenbrainz ? h('a.btn.btn--ghost', { href: 'https://listenbrainz.org/my/listens/', target: '_blank', rel: 'noopener' }, icon('external', 16), tr('Stats on ListenBrainz')) : null,
      h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        if (await ask(tr('Delete your whole listening history?'), { input: false, confirm: tr('Delete'), danger: true })) { await store.clearHistory(); toast(tr('History deleted')); }
      } }, icon('trash', 16), tr('Delete history')),
    ] : [],
  }));
  if (!hist.length) {
    root.append(h('p.empty', {}, tr('A song is added to history once you\'ve heard at least half of it (or 4 minutes). Radio stations after 30 seconds.')));
    return root;
  }

  // Most played artists in the last 30 days
  const monthAgo = Date.now() - 30 * 864e5;
  const counts = new Map();
  for (const x of hist) {
    if (x.at < monthAgo || x.track.live) continue;
    const name = x.track.artist || tr('Unknown');
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) {
    const max = top[0][1];
    root.append(section(tr('Top artists in the last 30 days'), h('ol.rank', {}, top.map(([name, n]) =>
      h('li.rank__item', {},
        store.index.artistMap.has(norm(name)) ? h('a.rank__name', { href: artistHref(name) }, name) : h('span.rank__name', {}, name),
        h('span.rank__bar', { style: { '--w': (n / max * 100).toFixed(1) + '%' }, 'aria-hidden': 'true' }),
        h('span.rank__n', {}, plural(n, 'play', 'plays')))))));
  }

  // By day (first 400 plays)
  const groups = new Map();
  for (const x of hist.slice(0, 400)) {
    const k = relDay(x.at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  // Like YouTube: a song appears once per day (at its latest play), with the number of plays.
  for (const [day, all] of groups) {
    const items = [];
    const byId = new Map();
    for (const x of all) {
      const seen = byId.get(x.track.id);
      if (seen) { seen.n++; continue; }
      const item = { ...x, n: 1 };
      byId.set(x.track.id, item);
      items.push(item);
    }
    root.append(section(day, trackList(items.map((x) => x.track), {
      context: { label: tr('History'), href: '#/history' },
      leading: (t, i) => {
        const time = new Date(items[i].at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
        const n = items[i].n;
        return n > 1 ? h('span.hist__lead', { title: tr('Played {n} times this day', { n }) }, time, h('small.hist__n', {}, n + '×')) : time;
      },
    })));
  }
  return root;
}

// ============================================================ Playlists
export function playlistView(params, id) {
  const p = store.playlists.find((x) => x.id === id);
  if (!p) return notFound(tr('This playlist no longer exists.'), '#/');
  const ctx = { label: p.name, href: '#/playlist/' + p.id };
  const root = h('div.view');
  root.append(header({
    title: p.name,
    kicker: tr('Playlist'),
    meta: p.tracks.length ? totalMeta(p.tracks) : tr('Empty'),
    art: collage(p.tracks.map((t) => t.cover), p.name),
    actions: [
      ...playButtons(p.tracks, ctx),
      h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        const name = await ask(tr('Rename playlist'), { value: p.name, confirm: tr('Rename') });
        if (name) await store.updatePlaylist(p.id, { name });
      } }, tr('Rename')),
      p.tracks.length ? h('a.btn.btn--ghost', { href: `/api/playlists/${p.id}/m3u`, download: '' }, icon('download', 16), tr('Export M3U')) : null,
      h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        if (await ask(tr('Delete playlist “{name}”?', { name: p.name }), { input: false, confirm: tr('Delete'), danger: true })) {
          await store.deletePlaylist(p.id); toast(tr('Playlist deleted')); go('#/');
        }
      } }, icon('trash', 16), tr('Delete')),
    ],
  }));
  root.append(trackList(p.tracks, {
    context: ctx, playlist: p, sortable: true,
    emptyText: tr('Add songs with the ⋯ menu next to any song, or by right-clicking a song.'),
  }));
  if (p.tracks.length > 1) root.append(h('p.muted.pad', {}, tr('Drag a song to change the order.')));
  return root;
}

export function smartView(params, key) {
  const s = SMART.find((x) => x.key === key);
  if (!s) return notFound(tr('Unknown smart playlist.'), '#/');
  const tracks = store.smart(key);
  const ctx = { label: tr(s.name), href: '#/smart/' + key };
  const root = h('div.view');
  root.append(header({
    title: tr(s.name), kicker: tr('Smart playlist'), meta: [tr(s.desc), tracks.length ? totalMeta(tracks) : null].filter(Boolean).join('. '),
    art: collage(tracks.map((t) => t.cover), tr(s.name)),
    actions: [...playButtons(tracks, ctx),
      tracks.length ? h('button.btn.btn--ghost', { type: 'button', onclick: async () => {
        const name = await ask(tr('Save as playlist'), { value: `${tr(s.name)}, ${new Date().toLocaleDateString(locale())}`, confirm: tr('Save') });
        if (!name) return;
        const p = await store.createPlaylist(name, tracks);
        toast(tr('Saved as “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go('#/playlist/' + p.id) });
      } }, icon('plus', 16), tr('Save as playlist')) : null],
  }));
  root.append(trackList(tracks, { context: ctx, emptyText: tr('This list fills itself as you listen and add music.') }));
  return root;
}

// ============================================================ Radio
const RADIO_TAGS = ['pop', 'rock', 'jazz', 'classical', 'electronic', 'chillout', 'lounge', 'hits', '80s', '90s', 'folk', 'news'];
const COUNTRIES = [
  { value: 'RS', label: 'Serbia' }, { value: 'BA', label: 'Bosnia and Herzegovina' }, { value: 'HR', label: 'Croatia' },
  { value: 'ME', label: 'Montenegro' }, { value: 'SI', label: 'Slovenia' }, { value: 'MK', label: 'North Macedonia' },
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
        'aria-label': saved ? tr('Remove from my stations') : tr('Save station'),
        onclick: async (e) => {
          const b = e.currentTarget;
          const on = await store.toggleStation(s);
          b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
          b.replaceChildren(icon(on ? 'heartFill' : 'heart', 17));
          toast(on ? tr('“{title}” is in your stations', { title: s.title }) : tr('Station removed'));
        },
      }, icon(saved ? 'heartFill' : 'heart', 17)));
  }));
}

export function radioView(params) {
  const root = h('div.view');
  const saved = Object.values(store.stations);
  root.append(header({ title: 'Radio', meta: tr('Over 40,000 internet stations from the open radio-browser.info database') }));
  if (saved.length) root.append(section(tr('My stations'), stationGrid(saved)));

  const res = h('div');
  const input = h('input.field.field--filter', { type: 'search', placeholder: tr('Station name'), 'aria-label': tr('Find a station'), value: params.get('q') || '' });
  let state = { q: params.get('q') || '', tag: '', country: '' };
  let token = 0;
  async function load() {
    const my = ++token;
    res.replaceChildren(loading(tr('Searching stations…')));
    try {
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.tag) p.set('tag', state.tag);
      if (state.country) p.set('country', state.country);
      const list = p.toString() ? await api('/api/radio/search?' + p) : await api('/api/radio/top');
      if (my !== token) return;
      res.replaceChildren(list.length ? stationGrid(list) : h('p.empty', {}, tr('No stations for this selection.')));
    } catch (e) {
      if (my === token) res.replaceChildren(errorBox(tr('The radio database isn\'t responding: ') + e.message, load));
    }
  }
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = input.value.trim(); load(); }, 350); });
  root.append(section(tr('Find a station'), h('div', {},
    h('div.toolbar', {}, h('label.filter', {}, icon('search', 16), input)),
    h('div.toolbar', {}, chips([{ value: '', label: tr('Whole world') }, ...COUNTRIES], '', (v) => { state.country = v; load(); }, tr('Country'))),
    h('div.toolbar', {}, chips([{ value: '', label: tr('All genres') }, ...RADIO_TAGS.map((x) => ({ value: x, label: x }))], '', (v) => { state.tag = v; load(); }, tr('Genre'))),
    res)));
  load();
  return root;
}

// ============================================================ Discover
const AUDIUS_GENRES = ['', 'Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'Alternative', 'Rock', 'Pop', 'R&B/Soul', 'Jazz', 'Ambient', 'House', 'Techno', 'Classical', 'Acoustic', 'Experimental'];
const IA_PRESETS = [
  { value: 'collection:etree', label: 'Live Music Archive' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'classical OR symphony', label: 'Classical' },
  { value: 'collection:78rpm', label: '78 rpm records' },
  { value: 'collection:netlabels AND (electronic OR ambient)', label: 'Netlabel electronic' },
  { value: 'blues', label: 'Blues' },
];

export function discover(params) {
  const root = h('div.view');
  const tab = params.get('source') || 'audius';
  root.append(header({ title: tr('Discover'), meta: tr('Free and legal music: artists who share it themselves, archives and Creative Commons.') }));
  const tabs = [
    { value: 'audius', label: 'Audius' },
    { value: 'archive', label: 'Internet Archive' },
    { value: 'jamendo', label: 'Jamendo' },
  ];
  const body = h('div');
  root.append(h('div.tabs', { role: 'tablist' }, tabs.map((t) => h('a.tab', {
    role: 'tab', href: '#/discover?source=' + t.value, 'aria-selected': String(t.value === tab), class: t.value === tab ? 'is-on' : '',
  }, t.label))), body);

  if (tab === 'audius') {
    const list = h('div');
    let genre = '', time = 'week', kind = 'all', items = [];
    const show = () => {
      const f = items.filter(byKind(kind));
      list.replaceChildren(trackList(f, { context: { label: 'Audius' + (genre ? ', ' + genre : ''), href: '#/discover' },
        emptyText: kind === 'sets' ? tr('No sets among the popular tracks. Try searching “set” or “mix”.') : tr('No songs.') }));
    };
    const load = async () => {
      list.replaceChildren(loading());
      try {
        items = await api(`/api/audius/trending?genre=${encodeURIComponent(genre)}&time=${time}`);
        show();
      } catch (e) { list.replaceChildren(errorBox(tr('Audius isn\'t responding: ') + e.message, load)); }
    };
    body.append(
      h('div.toolbar', {}, chips([{ value: 'all', label: tr('All') }, { value: 'songs', label: tr('Songs') }, { value: 'sets', label: tr('Sets & mixes') }], 'all', (v) => { kind = v; show(); }, tr('Category'))),
      h('div.toolbar', {}, chips(AUDIUS_GENRES.map((g) => ({ value: g, label: g || tr('All genres') })), '', (v) => { genre = v; load(); }, tr('Genre'))),
      h('div.toolbar', {}, chips([{ value: 'week', label: tr('This week') }, { value: 'month', label: tr('This month') }, { value: 'year', label: tr('This year') }, { value: 'allTime', label: tr('All time') }], 'week', (v) => { time = v; load(); }, tr('Period'))),
      list);
    load();
  }

  if (tab === 'archive') {
    const list = h('div');
    const load = async (q) => {
      list.replaceChildren(loading());
      try { const items = await api('/api/archive/search?q=' + encodeURIComponent(q)); list.replaceChildren(items.length ? grid(items.map(archiveTile)) : h('p.empty', {}, tr('No results.'))); }
      catch (e) { list.replaceChildren(errorBox(tr('Internet Archive isn\'t responding: ') + e.message, () => load(q))); }
    };
    body.append(
      h('p.muted.pad', {}, tr('Concert recordings shared with the artists\' permission, netlabel releases and old public-domain recordings. You can save all of it to your computer.')),
      h('div.toolbar', {}, chips(IA_PRESETS, IA_PRESETS[0].value, load, tr('Collection'))),
      list);
    load(IA_PRESETS[0].value);
  }

  if (tab === 'jamendo') {
    if (!store.settings.hasJamendo) {
      body.append(h('div.note', {},
        h('h2', {}, tr('Turn on Jamendo')),
        h('p', {}, tr('Jamendo has hundreds of thousands of Creative Commons songs, many of them downloadable. You need a free key:')),
        h('ol', {},
          h('li', {}, tr('Create an account at '), h('a', { href: 'https://devportal.jamendo.com', target: '_blank', rel: 'noopener' }, 'devportal.jamendo.com'), '.'),
          h('li', {}, tr('Click “Create a new app” and copy the Client ID.')),
          h('li', {}, tr('Paste it in Settings, under Jamendo.'))),
        h('a.btn', { href: '#/settings' }, tr('Open settings'))));
    } else {
      const list = h('div');
      const load = async (tag) => {
        list.replaceChildren(loading());
        try { list.replaceChildren(trackList(await api('/api/jamendo/popular?tag=' + encodeURIComponent(tag)), { context: { label: 'Jamendo', href: '#/discover?source=jamendo' } })); }
        catch (e) { list.replaceChildren(errorBox(e.message, () => load(tag))); }
      };
      body.append(h('div.toolbar', {}, chips(['', 'pop', 'rock', 'electronic', 'jazz', 'lounge', 'classical', 'hiphop', 'world', 'soundtrack'].map((x) => ({ value: x, label: x || tr('All') })), '', load, tr('Genre'))), list);
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
        if (!d.tracks.length) { toast(tr('This release has no recordings your browser can play'), { error: true }); return; }
        player.playList(d.tracks, 0, { shuffle: false, context: { label: d.album.title, href: '#/archive/' + x.identifier } });
      } catch (e) { toast(e.message, { error: true }); }
    },
  };
}

export function archiveView(params, id) {
  id = decodeURIComponent(id);
  const root = h('div.view', {}, loading(tr('Loading release from Internet Archive…')));
  api('/api/archive/item/' + encodeURIComponent(id)).then(({ album: a, tracks }) => {
    const ctx = { label: a.title, href: '#/archive/' + id };
    root.replaceChildren(header({
      title: a.title, kicker: a.artist,
      meta: [a.year, tracks.length ? totalMeta(tracks) : null].filter(Boolean).join(', '),
      art: cover(a.cover, a.title, 'hd__cv'),
      actions: [...playButtons(tracks, ctx),
        tracks.length ? h('button.btn.btn--ghost', { type: 'button', onclick: () => saveToLibrary(tracks) }, icon('download', 16), tr('Save album to computer')) : null,
        h('a.btn.btn--ghost', { href: a.link, target: '_blank', rel: 'noopener' }, icon('external', 16), 'archive.org')],
    }));
    if (a.description) root.append(h('p.desc', {}, a.description));
    if (a.license) root.append(h('p.muted.pad', {}, tr('License: '), h('a', { href: a.license, target: '_blank', rel: 'noopener' }, a.license)));
    root.append(trackList(tracks, { context: ctx, numbered: true, album: false, coverArt: false, emptyText: tr('This release has no recordings your browser can play.') }));
  }).catch((e) => root.replaceChildren(errorBox(tr('Can\'t load this release: ') + e.message, () => go(location.hash))));
  return root;
}

// A pasted SoundCloud link: one result that plays through SoundCloud's own player.
function soundCloudResult(url, here, current) {
  const box = h('div', {}, loading(tr('Opening the SoundCloud link…')));
  api('/api/soundcloud/resolve?u=' + encodeURIComponent(url)).then(({ track }) => {
    if (!current()) return;
    const what = { track: tr('Song'), set: tr('Set or playlist'), artist: tr('Artist page: plays their songs') }[track.kind] || '';
    box.replaceChildren(
      trackList([track], { context: { label: 'SoundCloud', href: here } }),
      h('div.row', { style: { marginTop: '14px', gap: '10px', flexWrap: 'wrap' } },
        h('button.btn.btn--primary', { type: 'button', onclick: () => player.playList([track], 0, { shuffle: false, context: { label: 'SoundCloud', href: here } }) }, icon('play', 16), tr('Play')),
        h('a.btn', { href: track.link, target: '_blank', rel: 'noopener' }, icon('external', 16), 'soundcloud.com')),
      h('p.muted', { style: { marginTop: '14px', maxWidth: '68ch' } }, [what, tr('It plays in SoundCloud\'s own player, so the equalizer, spectrum and offline playback don\'t work for it, and SoundCloud may show ads.')].filter(Boolean).join('. ')),
    );
  }).catch((e) => { if (current()) box.replaceChildren(errorBox(e.message)); });
  return section(tr('From SoundCloud'), box);
}

// ============================================================ Settings
export function settingsView() {
  const root = h('div.view.view--narrow');
  root.append(header({ title: tr('Settings') }));

  // ---- appearance
  const THEMES = [{ value: 'black', label: tr('Black'), sw: '#000000' }, { value: 'indigo', label: tr('Night indigo'), sw: '#1c1f3a' }, { value: 'light', label: tr('Light'), sw: '#f4f4f6' }];
  const pick = h('div.theme-pick', { role: 'group', 'aria-label': tr('Theme') });
  const renderThemes = () => pick.replaceChildren(...THEMES.map((t) => h('button.theme-opt', {
    type: 'button', 'aria-pressed': String((document.documentElement.dataset.theme || 'black') === t.value),
    onclick: () => { setTheme(t.value); renderThemes(); },
  }, h('span.theme-opt__sw', { style: { '--sw': t.sw }, 'aria-hidden': 'true' }), t.label)));
  renderThemes();
  const langPick = h('div.theme-pick', { role: 'group', 'aria-label': tr('Language') }, LANGUAGES.map((l) => {
    const name = tr(l.name);
    return h('button.theme-opt.lang-opt', { type: 'button', lang: l.code, 'aria-pressed': String(lang === l.code), onclick: () => { if (lang !== l.code) setLang(l.code); } },
      h('span.lang-opt__flag', { 'aria-hidden': 'true' }, l.flag),
      h('span.lang-opt__text', {}, h('span', {}, name), name !== l.native ? h('span.lang-opt__native', {}, l.native) : null));
  }));
  root.append(section(tr('Language'), langPick));
  // App icon: stored on the server, so the computer and the phone show the same one.
  const ICON_OPTS = [{ value: 'dial', label: tr('Dial') }, { value: 'night', label: tr('Dial on black') }, { value: 'vinyl', label: tr('Vinyl') }, { value: 'bars', label: tr('Spectrum') }];
  const iconPick = h('div.theme-pick', { role: 'group', 'aria-label': tr('App icon') });
  const renderIcons = () => {
    if (!iconPick.isConnected && iconPick.childElementCount) { store.removeEventListener('settings', renderIcons); return; }
    const cur = store.settings.icon || 'dial';
    iconPick.replaceChildren(...ICON_OPTS.map((o) => h('button.theme-opt', {
      type: 'button', 'aria-pressed': String(cur === o.value),
      onclick: async () => {
        if (cur === o.value) return;
        try { await store.saveSettings({ icon: o.value }); toast(tr('App icon changed')); } catch (e) { toast(e.message, { error: true }); }
      },
    }, h('img.theme-opt__icon', { src: `/icons/${o.value}/icon.svg`, alt: '', width: 34, height: 34 }), o.label)));
  };
  store.addEventListener('settings', renderIcons);
  renderIcons();
  root.append(section(tr('Appearance'), h('div.form', {},
    pick,
    h('h3.form__label', {}, tr('App icon')),
    iconPick,
    h('p.muted', {}, tr('The icon changes on all your devices. A shortcut already on a home screen keeps its old icon until you add it again.')),
  )));

  // ---- folders
  const folders = store.folders.slice();
  const folderList = h('ul.folders');
  const renderFolders = () => folderList.replaceChildren(...folders.map((f, i) => h('li.folders__item', {},
    icon('folder', 16), h('code', {}, f),
    folders.length > 1 ? h('button.ibtn', { type: 'button', 'aria-label': tr('Remove folder'), onclick: async () => {
      folders.splice(i, 1); await store.saveSettings({ folders }); renderFolders(); toast(tr('Folder removed from library'));
    } }, icon('close', 16)) : null)));
  renderFolders();
  const newFolder = h('input.field', { type: 'text', placeholder: '~/Music/Another folder', 'aria-label': tr('Folder path') });
  root.append(section(tr('Music on this computer'), h('div.form', {},
    h('p.muted', {}, tr('{n} in your libraries. New songs appear on their own as soon as you drop them in the folder.', { n: songs(store.library.length) })),
    folderList,
    h('form.row', { onsubmit: async (e) => {
      e.preventDefault();
      const v = newFolder.value.trim();
      if (!v) return;
      folders.push(v); await store.saveSettings({ folders }); newFolder.value = ''; renderFolders(); toast(tr('Folder added, scanning…'));
    } }, newFolder, h('button.btn', {}, tr('Add folder'))),
    h('button.btn.btn--ghost', { type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const r = await api('/api/library/rescan', { method: 'POST', body: {} });
      await store.reloadLibrary();
      toast(tr('Scanned: {n}', { n: songs(r.count) }));
      e.target.disabled = false;
    } }, icon('refresh', 16), tr('Rescan')),
    h('p.muted', {}, tr('Tip: the '), h('a', { href: 'https://beets.io', target: '_blank', rel: 'noopener' }, 'beets'),
      tr(' tool fixes tags and covers and sorts files by artist and album. Command: '), h('code', {}, 'beet import ~/Downloads/new-album')))));

  // ---- ListenBrainz
  const lbInput = h('input.field', { type: 'password', placeholder: store.settings.hasListenbrainz ? tr('Token saved') : tr('Paste token'), 'aria-label': 'ListenBrainz token', autocomplete: 'off' });
  const lbStatus = h('p.muted', {}, store.settings.hasListenbrainz ? tr('Connected: every song you finish is also logged on ListenBrainz.') : tr('Not connected.'));
  root.append(section(tr('History on ListenBrainz'), h('div.form', {},
    h('p.muted', {}, tr('A free, open-source service: it keeps your full history, makes yearly reviews and weekly recommendations. It can also log what you play on Spotify, so you have one history for everything.')),
    h('form.row', { onsubmit: async (e) => {
      e.preventDefault();
      const r = await store.saveSettings({ listenbrainzToken: lbInput.value.trim() });
      lbInput.value = '';
      if (r.listenbrainz?.valid) { lbStatus.textContent = tr('Connected as {user}.', { user: r.listenbrainz.user }); toast(tr('ListenBrainz connected')); }
      else if (r.listenbrainz) { lbStatus.textContent = tr('The token wasn\'t accepted. Copy it again from the page below.'); toast(tr('ListenBrainz rejected the token'), { error: true }); }
      else { lbStatus.textContent = tr('Not connected.'); toast(tr('ListenBrainz disconnected')); }
    } }, lbInput, h('button.btn', {}, tr('Save'))),
    lbStatus,
    h('p.muted', {}, tr('Find your token at '), h('a', { href: 'https://listenbrainz.org/settings/', target: '_blank', rel: 'noopener' }, 'listenbrainz.org/settings'), tr('. Saving an empty field disconnects it.')))));

  // ---- Jamendo
  const jmInput = h('input.field', { type: 'password', placeholder: store.settings.hasJamendo ? tr('Client ID saved') : 'Jamendo Client ID', 'aria-label': 'Jamendo Client ID', autocomplete: 'off' });
  root.append(section('Jamendo', h('div.form', {},
    h('p.muted', {}, tr('Creative Commons music. Get a free Client ID at '), h('a', { href: 'https://devportal.jamendo.com', target: '_blank', rel: 'noopener' }, 'devportal.jamendo.com'), '.'),
    h('form.row', { onsubmit: async (e) => {
      e.preventDefault();
      await store.saveSettings({ jamendoClientId: jmInput.value.trim() });
      jmInput.value = '';
      toast(store.settings.hasJamendo ? tr('Jamendo turned on') : tr('Jamendo turned off'));
    } }, jmInput, h('button.btn', {}, tr('Save'))))));

  // ---- Spotify import
  const importOut = h('div');
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'visually-hidden', id: 'csv' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    importOut.replaceChildren(spotifyImport(await f.text(), f.name.replace(/\.csv$/i, '')));
    file.value = '';
  });
  root.append(section(tr('Import a playlist from Spotify'), h('div.form', {},
    h('p.muted', {}, tr('At '), h('a', { href: 'https://exportify.app', target: '_blank', rel: 'noopener' }, 'exportify.app'),
      tr(' (open source), export a playlist or “Liked Songs” to CSV. Tunes finds those songs in your library, builds a playlist and shows what you\'re missing.')),
    file, h('label.btn', { for: 'csv' }, icon('plus', 16), tr('Choose CSV file')),
    importOut)));

  // ---- backup
  root.append(section(tr('Offline playback'), renderOfflineSettings()));
  root.append(section(tr('Backup'), h('div.form', {},
    h('p.muted', {}, tr('Favorites, playlists and history in one JSON file.')),
    h('a.btn.btn--ghost', { href: '/api/export', download: '' }, icon('download', 16), tr('Download backup')))));

  // ---- shortcuts
  const keys = [
    [tr('Space'), tr('Play / pause')], ['← →', tr('Skip 5 seconds')], ['Shift + ← →', tr('Previous / next song')],
    ['↑ ↓', tr('Volume')], ['M', tr('Mute')], ['L', tr('Favorite (heart)')], ['S', tr('Shuffle')], ['R', tr('Repeat')],
    ['/', tr('Search')], ['Q', tr('Play queue')], ['T', tr('Lyrics')], ['E', tr('Equalizer')], ['F', tr('Full screen: now playing')], ['Esc', tr('Close')],
  ];
  root.append(section(tr('Keyboard shortcuts'), h('dl.keys', {}, keys.flatMap(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)]))));

  root.append(section(tr('Listening on your phone'), h('div.form', {},
    h('p.muted', {}, tr('Click “Listen on phone” in the left menu and scan the QR code with your phone camera. The phone must be on the same Wi-Fi network.')),
    h('button.btn', { type: 'button', onclick: () => document.dispatchEvent(new CustomEvent('open-phone')) }, icon('phone', 16), tr('Listen on phone')))));
  return root;
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'black' ? '#000000' : t === 'light' ? '#f4f4f6' : '#1c1f3a';
  try { localStorage.setItem('tunes.theme', JSON.stringify(t)); } catch { /* */ }
}

// Exportify CSV -> a playlist of the tracks you already have.
function spotifyImport(text, name) {
  const rows = parseCsv(text);
  const head = rows.shift() || [];
  const col = (re) => head.findIndex((x) => re.test(x));
  const ti = col(/^track name$/i), ai = col(/^artist name/i), bi = col(/^album name$/i);
  if (ti < 0 || ai < 0) return h('p.err', {}, tr('This doesn\'t look like an Exportify CSV: the “Track Name” and “Artist Name(s)” columns are missing.'));
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
    h('p', {}, tr('Found on this computer: {found} of {total}.', { found: found.length, total: found.length + missing.length })));
  if (found.length) {
    out.append(h('button.btn.btn--primary', { type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const p = await store.createPlaylist(name || tr('From Spotify'), found);
      toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go('#/playlist/' + p.id) });
    } }, icon('plus', 16), tr('Create playlist “{name}”', { name })));
  }
  if (missing.length) {
    out.append(h('details.missing', {},
      h('summary', {}, tr('Missing {n}: look for them on Bandcamp, Jamendo or Audius', { n: songs(missing.length) })),
      h('ul', {}, missing.slice(0, 500).map((m) => h('li', {},
        h('span', {}, `${m.artist} – ${m.title}`),
        h('a', { href: '#/search?q=' + encodeURIComponent(`${m.artist.split(',')[0]} ${m.title}`) }, tr('Find')),
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

// ============================================================ helpers
function emptyCollection(text) {
  return h('div.note', {},
    h('p', {}, text, tr(' Your collection is the songs on this computer plus everything you heart online.')),
    h('div.row', {}, h('a.btn', { href: '#/discover' }, icon('compass', 16), tr('Discover music')), h('a.btn.btn--ghost', { href: '#/settings' }, icon('folder', 16), tr('Folders'))));
}

function notFound(text, back) {
  return h('div.view', {}, h('div.note', {}, h('p', {}, text), h('a.btn', { href: back }, tr('Back'))));
}

export { EQ_PRESETS, addToPlaylist, toggleFav, sourceTag, fmtTime };

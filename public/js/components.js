// Reusable UI pieces: track list, cover grid, page header,
// track menu.
import { h, icon, iconBtn, cover, fmtTime, fmtDuration, songs, sourceTag, toast, openMenu, ask, norm, tr } from './ui.js';
import { store, api } from './store.js';
import { player } from './player.js';

export const go = (hash) => { location.hash = hash; };
export const artistHref = (name) => '#/artist/' + encodeURIComponent(norm(name));
export const albumHref = (key) => '#/album/' + encodeURIComponent(key);

// ------------------------------------------------------------ track menu
export function trackMenu(track, { playlist, index, list } = {}) {
  const items = [];
  if (!track.live) {
    items.push({ label: tr('Play next'), icon: 'next', action: () => { player.playNext(track); toast(tr('“{title}” plays next', { title: track.title })); } });
    items.push({ label: tr('Add to queue'), icon: 'queue', action: () => { player.addToQueue(track); toast(tr('Added to queue')); } });
    items.push({
      label: tr('Add to playlist'),
      items: [
        { label: tr('New playlist…'), icon: 'plus', action: async () => {
          const name = await ask(tr('New playlist'), { placeholder: tr('Playlist name'), confirm: tr('Create') });
          if (!name) return;
          const p = await store.createPlaylist(name, [track]);
          toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go('#/playlist/' + p.id) });
        } },
        store.playlists.length ? '-' : null,
        ...store.playlists.map((p) => ({ label: p.name, action: () => addToPlaylist(p, [track]) })),
      ],
    });
    items.push('-');
  }
  items.push({
    label: store.isFav(track.id) ? tr('Remove from favorites') : tr('Add to favorites'),
    icon: store.isFav(track.id) ? 'heartFill' : 'heart',
    action: () => toggleFav(track),
  });
  if (track.live) {
    items.push({ label: store.isStation(track.id) ? tr('Remove from my stations') : tr('Save station'), icon: 'radio', action: () => store.toggleStation(track) });
  } else {
    if (track.artist) items.push({ label: tr('Go to artist'), icon: 'artist', action: () => openArtist(track) });
    if (track.album) items.push({ label: tr('Go to album'), icon: 'album', action: () => openAlbum(track) });
  }
  if (track.download) items.push({ label: tr('Save to computer'), icon: 'download', action: () => saveToLibrary([track]) });
  if (track.link) items.push({ label: tr('Open on source website'), icon: 'external', action: () => window.open(track.link, '_blank', 'noopener') });
  if (playlist) {
    items.push('-');
    items.push({ label: tr('Remove from this playlist'), icon: 'trash', action: async () => {
      const tracks = playlist.tracks.slice();
      tracks.splice(index, 1);
      await store.updatePlaylist(playlist.id, { tracks });
      toast(tr('Removed from playlist'));
    } });
  }
  if (list && !playlist && list.length > 1 && !track.live) {
    items.push('-');
    items.push({ label: tr('Add whole list to playlist…'), icon: 'plus', action: () => addAllToPlaylist(list) });
  }
  return items;
}

export async function toggleFav(track) {
  try {
    const fav = await store.toggleFav(track);
    toast(fav ? tr('“{title}” added to favorites', { title: track.title }) : tr('Removed from favorites'));
  } catch (e) { toast(e.message, { error: true }); }
}

export async function addToPlaylist(p, tracks) {
  const have = new Set(p.tracks.map((t) => t.id));
  const fresh = tracks.filter((t) => !have.has(t.id) && !t.live);
  if (!fresh.length) { toast(tr('Already in playlist “{name}”', { name: p.name })); return; }
  await store.updatePlaylist(p.id, { add: fresh });
  toast(fresh.length === 1 ? tr('Added to “{name}”', { name: p.name }) : tr('{n} added to “{name}”', { n: songs(fresh.length), name: p.name }));
}

export async function addAllToPlaylist(tracks) {
  const options = store.playlists.map((p) => p.name).join(', ');
  const name = await ask(tr('Add to playlist'), { placeholder: options ? tr('Existing ({list}) or new', { list: options }) : tr('New playlist name'), confirm: tr('Add') });
  if (!name) return;
  const existing = store.playlists.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return addToPlaylist(existing, tracks);
  const p = await store.createPlaylist(name, tracks.filter((t) => !t.live));
  toast(tr('Created playlist “{name}”', { name: p.name }), { action: tr('Open'), onAction: () => go('#/playlist/' + p.id) });
}

function openArtist(track) {
  if (track.artistRef?.startsWith('audius:') && !store.index.artistMap.has(norm(track.artist))) {
    go('#/audius/' + encodeURIComponent(track.artistRef.slice(7)));
    return;
  }
  const key = norm(track.albumArtist || track.artist);
  if (store.index.artistMap.has(key)) go(artistHref(track.albumArtist || track.artist));
  else if (store.index.artistMap.has(norm(track.artist))) go(artistHref(track.artist));
  else go('#/search?q=' + encodeURIComponent(track.artist));
}

function openAlbum(track) {
  if (track.source === 'archive') { go('#/archive/' + encodeURIComponent(track.id.slice(3).split('/')[0])); return; }
  const key = norm(track.albumArtist || track.artist || tr('Unknown artist')) + '|' + norm(track.album);
  if (store.index.albumMap.has(key)) go(albumHref(key));
  else go('#/search?q=' + encodeURIComponent(track.album));
}

export async function saveToLibrary(tracks) {
  const list = tracks.filter((t) => t.download);
  if (!list.length) { toast(tr('The source doesn\'t allow downloading these songs'), { error: true }); return; }
  toast(list.length === 1 ? tr('Saving “{title}” to your computer…', { title: list[0].title }) : tr('Saving {n} to your computer…', { n: songs(list.length) }));
  let ok = 0;
  for (const t of list) {
    try { await api('/api/download', { method: 'POST', body: { track: t } }); ok++; }
    catch (e) { toast(`„${t.title}”: ${e.message}`, { error: true }); }
  }
  if (ok) toast(ok === 1 ? tr('Saved to library') : tr('{n} saved to library', { n: songs(ok) }), { action: tr('View'), onAction: () => go('#/songs') });
}

// ------------------------------------------------------------ track list
// Large lists render in chunks as you scroll, so even 20,000 tracks stay smooth.
export function trackList(tracks, { context = null, numbered = false, album = true, coverArt = true, playlist = null, leading = null, sortable = false, emptyText = tr('No songs.') } = {}) {
  if (!tracks.length) return h('p.empty', {}, emptyText);
  const wrap = h('div.tl', { role: 'list', class: [album ? '' : 'tl--noalbum', coverArt ? '' : 'tl--nocover'].join(' ') });
  const CHUNK = 200;
  let rendered = 0;

  const play = (i) => player.playList(tracks, i, { shuffle: false, context });

  const row = (t, i) => {
    const fav = store.isFav(t.id);
    const lead = leading ? leading(t, i) : numbered ? (t.trackNo || i + 1) : i + 1;
    const r = h('div.tr', {
      role: 'listitem', tabindex: '0', dataset: { id: t.id, i: String(i) },
      'aria-label': `${t.title}, ${t.artist || ''}`,
      ondblclick: () => play(i),
      onkeydown: (e) => {
        if (e.key === 'Enter') { play(i); e.preventDefault(); }
        if (e.key === 'ArrowDown') { r.nextElementSibling?.focus(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { r.previousElementSibling?.focus(); e.preventDefault(); }
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const b = r.getBoundingClientRect(); openMenu(b.left + 40, b.bottom, trackMenu(t, { playlist, index: i, list: tracks })); e.preventDefault(); }
      },
      oncontextmenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, trackMenu(t, { playlist, index: i, list: tracks })); },
    },
    h('div.tr__lead', {},
      h('span.tr__num', {}, lead instanceof Node ? lead : String(lead)),
      h('button.tr__play', { type: 'button', 'aria-label': tr('Play ') + t.title, onclick: (e) => { e.stopPropagation(); play(i); } }, icon('play', 16))),
    coverArt ? cover(t.cover, t.title, 'tr__cv') : null,
    h('div.tr__main', {},
      h('span.tr__title', {}, t.title),
      h('span.tr__artist', {}, t.artist || '')),
    album ? h('span.tr__album', {}, t.album || '') : null,
    h('span.tr__src', {}, sourceTag(t.source)),
    h('button.tr__fav', {
      type: 'button', class: fav ? 'is-on' : '', 'aria-pressed': String(fav), 'aria-label': fav ? tr('Remove from favorites') : tr('Add to favorites'),
      onclick: (e) => { e.stopPropagation(); toggleFav(t); },
    }, icon(fav ? 'heartFill' : 'heart', 17)),
    h('span.tr__dur', {}, t.live ? tr('live') : fmtTime(t.duration)),
    h('button.tr__more', {
      type: 'button', 'aria-label': tr('More options'),
      onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left - 180, b.bottom + 4, trackMenu(t, { playlist, index: i, list: tracks })); },
    }, icon('more', 18)));
    if (player.track?.id === t.id) r.classList.add('is-playing');
    if (sortable) {
      r.draggable = true;
      r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-index', String(i)); e.dataTransfer.effectAllowed = 'move'; r.classList.add('is-drag'); });
      r.addEventListener('dragend', () => r.classList.remove('is-drag'));
      r.addEventListener('dragover', (e) => { e.preventDefault(); r.classList.add('is-over'); });
      r.addEventListener('dragleave', () => r.classList.remove('is-over'));
      r.addEventListener('drop', (e) => {
        e.preventDefault();
        r.classList.remove('is-over');
        const from = Number(e.dataTransfer.getData('text/x-index'));
        if (Number.isNaN(from) || from === i) return;
        const list = playlist.tracks.slice();
        const [x] = list.splice(from, 1);
        list.splice(i, 0, x);
        store.updatePlaylist(playlist.id, { tracks: list });
      });
    }
    return r;
  };

  const sentinel = h('div.tl__more', { 'aria-hidden': 'true' });
  const more = () => {
    const end = Math.min(tracks.length, rendered + CHUNK);
    const frag = document.createDocumentFragment();
    for (let i = rendered; i < end; i++) frag.append(row(tracks[i], i));
    sentinel.before(frag);
    rendered = end;
    if (rendered >= tracks.length) io.disconnect(), sentinel.remove();
  };
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) more(); }, { rootMargin: '600px' });
  wrap.append(sentinel);
  more();
  if (rendered < tracks.length) io.observe(sentinel);
  return wrap;
}

// ------------------------------------------------------------ cover grid
export function grid(items, { round = false } = {}) {
  return h('div.grid', { class: round ? 'grid--round' : '' }, items.map((it) =>
    h('div.tile', {},
      h('a.tile__link', { href: it.href, 'aria-label': it.title },
        it.collage ? collage(it.collage, it.title) : cover(it.cover, it.title, 'tile__cv')),
      it.play ? h('button.tile__play', { type: 'button', 'aria-label': tr('Play ') + it.title, onclick: it.play }, icon('play', 18)) : null,
      h('a.tile__title', { href: it.href, tabindex: '-1' }, it.title),
      it.sub ? h('span.tile__sub', {}, it.sub) : null)));
}

export function collage(covers, label) {
  const list = [...new Set(covers.filter(Boolean))].slice(0, 4);
  if (list.length < 4) return cover(list[0], label, 'tile__cv');
  return h('div.cv.cv--collage.tile__cv', {}, list.map((c) => h('img', { src: c, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.visibility = 'hidden'; } })));
}

// ------------------------------------------------------------ page header
export function header({ title, kicker, meta, art, actions = [], big = false }) {
  return h('header.hd', { class: (art ? 'hd--art ' : '') + (big ? 'hd--big' : '') },
    art || null,
    h('div.hd__text', {},
      kicker ? h('p.hd__kicker', {}, kicker) : null,
      h('h1.hd__title', {}, title),
      meta ? h('p.hd__meta', {}, meta) : null,
      actions.length ? h('div.hd__actions', {}, actions) : null));
}

export function playButtons(tracks, context) {
  if (!tracks.length) return [];
  return [
    h('button.btn.btn--primary', { type: 'button', onclick: () => player.playList(tracks, 0, { shuffle: false, context }) }, icon('play', 18), tr('Play')),
    h('button.btn', { type: 'button', onclick: () => player.playList(tracks, -1, { shuffle: true, context }) }, icon('shuffle', 18), tr('Shuffle')),
  ];
}

export function totalMeta(tracks) {
  const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return dur ? `${songs(tracks.length)}, ${fmtDuration(dur)}` : songs(tracks.length);
}

export function section(title, content, link) {
  return h('section.sec', {},
    h('div.sec__head', {}, h('h2.sec__title', {}, title), link ? h('a.sec__link', { href: link.href }, link.label) : null),
    content);
}

export function filterInput(placeholder, onInput) {
  const inp = h('input.field.field--filter', { type: 'search', placeholder, 'aria-label': placeholder });
  let t;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onInput(inp.value), 120); });
  return h('label.filter', {}, icon('search', 16), inp);
}

export function chips(options, active, onPick, label) {
  const box = h('div.chips', { role: 'group', 'aria-label': label });
  const render = (cur) => {
    box.replaceChildren(...options.map((o) => h('button.chip', {
      type: 'button', 'aria-pressed': String(o.value === cur), class: o.value === cur ? 'is-on' : '',
      onclick: () => { render(o.value); onPick(o.value); },
    }, tr(o.label))));
  };
  render(active);
  return box;
}

export function loading(text = tr('Loading…')) {
  return h('p.loading', { role: 'status' }, h('span.loading__dot'), text);
}

export function errorBox(msg, retry) {
  return h('div.err', { role: 'alert' }, h('p', {}, msg), retry ? h('button.btn', { type: 'button', onclick: retry }, icon('refresh', 16), tr('Try again')) : null);
}

export { iconBtn };

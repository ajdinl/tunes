// Delovi interfejsa koji se ponavljaju: lista pesama, mreža omota, zaglavlje,
// meni za pesmu.
import { h, icon, iconBtn, cover, fmtTime, fmtDuration, songs, sourceTag, toast, openMenu, ask, norm, tr } from './ui.js';
import { store, api } from './store.js';
import { player } from './player.js';

export const go = (hash) => { location.hash = hash; };
export const artistHref = (name) => '#/izvodjac/' + encodeURIComponent(norm(name));
export const albumHref = (key) => '#/album/' + encodeURIComponent(key);

// ------------------------------------------------------------ meni za pesmu
export function trackMenu(track, { playlist, index, list } = {}) {
  const items = [];
  if (!track.live) {
    items.push({ label: tr('Pusti sljedeće'), icon: 'next', action: () => { player.playNext(track); toast(tr('„{title}” ide sljedeća', { title: track.title })); } });
    items.push({ label: tr('Dodaj u red'), icon: 'queue', action: () => { player.addToQueue(track); toast(tr('Dodano u red')); } });
    items.push({
      label: tr('Dodaj u plejlistu'),
      items: [
        { label: tr('Nova plejlista…'), icon: 'plus', action: async () => {
          const name = await ask(tr('Nova plejlista'), { placeholder: tr('Naziv plejliste'), confirm: tr('Napravi') });
          if (!name) return;
          const p = await store.createPlaylist(name, [track]);
          toast(tr('Napravljena plejlista „{name}”', { name: p.name }), { action: tr('Otvori'), onAction: () => go('#/plejlista/' + p.id) });
        } },
        store.playlists.length ? '-' : null,
        ...store.playlists.map((p) => ({ label: p.name, action: () => addToPlaylist(p, [track]) })),
      ],
    });
    items.push('-');
  }
  items.push({
    label: store.isFav(track.id) ? 'Ukloni iz omiljenih' : tr('Dodaj u omiljene'),
    icon: store.isFav(track.id) ? 'heartFill' : 'heart',
    action: () => toggleFav(track),
  });
  if (track.live) {
    items.push({ label: store.isStation(track.id) ? 'Ukloni iz mojih stanica' : tr('Sačuvaj stanicu'), icon: 'radio', action: () => store.toggleStation(track) });
  } else {
    if (track.artist) items.push({ label: tr('Idi na izvođača'), icon: 'artist', action: () => openArtist(track) });
    if (track.album) items.push({ label: tr('Idi na album'), icon: 'album', action: () => openAlbum(track) });
  }
  if (track.download) items.push({ label: tr('Sačuvaj na računar'), icon: 'download', action: () => saveToLibrary([track]) });
  if (track.link) items.push({ label: tr('Otvori na sajtu izvora'), icon: 'external', action: () => window.open(track.link, '_blank', 'noopener') });
  if (playlist) {
    items.push('-');
    items.push({ label: tr('Ukloni iz ove plejliste'), icon: 'trash', action: async () => {
      const tracks = playlist.tracks.slice();
      tracks.splice(index, 1);
      await store.updatePlaylist(playlist.id, { tracks });
      toast(tr('Uklonjeno iz plejliste'));
    } });
  }
  if (list && !playlist && list.length > 1 && !track.live) {
    items.push('-');
    items.push({ label: tr('Dodaj cijelu listu u plejlistu…'), icon: 'plus', action: () => addAllToPlaylist(list) });
  }
  return items;
}

export async function toggleFav(track) {
  try {
    const fav = await store.toggleFav(track);
    toast(fav ? tr('„{title}” je u omiljenim', { title: track.title }) : tr('Uklonjeno iz omiljenih'));
  } catch (e) { toast(e.message, { error: true }); }
}

export async function addToPlaylist(p, tracks) {
  const have = new Set(p.tracks.map((t) => t.id));
  const fresh = tracks.filter((t) => !have.has(t.id) && !t.live);
  if (!fresh.length) { toast(tr('Već je u plejlisti „{name}”', { name: p.name })); return; }
  await store.updatePlaylist(p.id, { add: fresh });
  toast(fresh.length === 1 ? tr('Dodano u „{name}”', { name: p.name }) : tr('{n} dodano u „{name}”', { n: songs(fresh.length), name: p.name }));
}

export async function addAllToPlaylist(tracks) {
  const options = store.playlists.map((p) => p.name).join(', ');
  const name = await ask(tr('Dodaj u plejlistu'), { placeholder: options ? tr('Postojeća ({list}) ili nova', { list: options }) : tr('Naziv nove plejliste'), confirm: tr('Dodaj') });
  if (!name) return;
  const existing = store.playlists.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return addToPlaylist(existing, tracks);
  const p = await store.createPlaylist(name, tracks.filter((t) => !t.live));
  toast(tr('Napravljena plejlista „{name}”', { name: p.name }), { action: tr('Otvori'), onAction: () => go('#/plejlista/' + p.id) });
}

function openArtist(track) {
  if (track.artistRef?.startsWith('audius:') && !store.index.artistMap.has(norm(track.artist))) {
    go('#/audius/' + encodeURIComponent(track.artistRef.slice(7)));
    return;
  }
  const key = norm(track.albumArtist || track.artist);
  if (store.index.artistMap.has(key)) go(artistHref(track.albumArtist || track.artist));
  else if (store.index.artistMap.has(norm(track.artist))) go(artistHref(track.artist));
  else go('#/pretraga?q=' + encodeURIComponent(track.artist));
}

function openAlbum(track) {
  if (track.source === 'archive') { go('#/archive/' + encodeURIComponent(track.id.slice(3).split('/')[0])); return; }
  const key = norm(track.albumArtist || track.artist || tr('Nepoznat izvođač')) + '|' + norm(track.album);
  if (store.index.albumMap.has(key)) go(albumHref(key));
  else go('#/pretraga?q=' + encodeURIComponent(track.album));
}

export async function saveToLibrary(tracks) {
  const list = tracks.filter((t) => t.download);
  if (!list.length) { toast(tr('Izvor ne dozvoljava preuzimanje ovih pjesama'), { error: true }); return; }
  toast(list.length === 1 ? tr('Čuvam „{title}” na računar…', { title: list[0].title }) : tr('Čuvam {n} na računar…', { n: songs(list.length) }));
  let ok = 0;
  for (const t of list) {
    try { await api('/api/download', { method: 'POST', body: { track: t } }); ok++; }
    catch (e) { toast(`„${t.title}”: ${e.message}`, { error: true }); }
  }
  if (ok) toast(ok === 1 ? 'Sačuvano u biblioteku' : tr('{n} sačuvano u biblioteku', { n: songs(ok) }), { action: tr('Pogledaj'), onAction: () => go('#/pesme') });
}

// ------------------------------------------------------------ lista pesama
// Velike liste se crtaju u delovima dok skroluješ, pa i 20.000 pesama radi glatko.
export function trackList(tracks, { context = null, numbered = false, album = true, coverArt = true, playlist = null, leading = null, sortable = false, emptyText = tr('Nema pjesama.') } = {}) {
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
      h('span.tr__num', {}, String(lead)),
      h('button.tr__play', { type: 'button', 'aria-label': tr('Pusti ') + t.title, onclick: (e) => { e.stopPropagation(); play(i); } }, icon('play', 16))),
    coverArt ? cover(t.cover, t.title, 'tr__cv') : null,
    h('div.tr__main', {},
      h('span.tr__title', {}, t.title),
      h('span.tr__artist', {}, t.artist || '')),
    album ? h('span.tr__album', {}, t.album || '') : null,
    h('span.tr__src', {}, sourceTag(t.source)),
    h('button.tr__fav', {
      type: 'button', class: fav ? 'is-on' : '', 'aria-pressed': String(fav), 'aria-label': fav ? 'Ukloni iz omiljenih' : tr('Dodaj u omiljene'),
      onclick: (e) => { e.stopPropagation(); toggleFav(t); },
    }, icon(fav ? 'heartFill' : 'heart', 17)),
    h('span.tr__dur', {}, t.live ? 'uživo' : fmtTime(t.duration)),
    h('button.tr__more', {
      type: 'button', 'aria-label': tr('Još opcija'),
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

// ------------------------------------------------------------ mreža omota
export function grid(items, { round = false } = {}) {
  return h('div.grid', { class: round ? 'grid--round' : '' }, items.map((it) =>
    h('div.tile', {},
      h('a.tile__link', { href: it.href, 'aria-label': it.title },
        it.collage ? collage(it.collage, it.title) : cover(it.cover, it.title, 'tile__cv')),
      it.play ? h('button.tile__play', { type: 'button', 'aria-label': tr('Pusti ') + it.title, onclick: it.play }, icon('play', 18)) : null,
      h('a.tile__title', { href: it.href, tabindex: '-1' }, it.title),
      it.sub ? h('span.tile__sub', {}, it.sub) : null)));
}

export function collage(covers, label) {
  const list = [...new Set(covers.filter(Boolean))].slice(0, 4);
  if (list.length < 4) return cover(list[0], label, 'tile__cv');
  return h('div.cv.cv--collage.tile__cv', {}, list.map((c) => h('img', { src: c, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.visibility = 'hidden'; } })));
}

// ------------------------------------------------------------ zaglavlje stranice
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
    h('button.btn.btn--primary', { type: 'button', onclick: () => player.playList(tracks, 0, { shuffle: false, context }) }, icon('play', 18), tr('Pusti')),
    h('button.btn', { type: 'button', onclick: () => player.playList(tracks, -1, { shuffle: true, context }) }, icon('shuffle', 18), tr('Nasumično')),
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
    }, o.label)));
  };
  render(active);
  return box;
}

export function loading(text = tr('Učitavam…')) {
  return h('p.loading', { role: 'status' }, h('span.loading__dot'), text);
}

export function errorBox(msg, retry) {
  return h('div.err', { role: 'alert' }, h('p', {}, msg), retry ? h('button.btn', { type: 'button', onclick: retry }, icon('refresh', 16), tr('Pokušaj ponovo')) : null);
}

export { iconBtn };

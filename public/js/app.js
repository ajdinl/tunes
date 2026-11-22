// App startup: navigation, player bar, panels, shortcuts.
import { h, icon, iconBtn, cover, fmtTime, toast, openMenu, ask, songs, sourceTag, norm, tr } from './ui.js';
import { api } from './store.js';
import { store } from './store.js';
import { player, EQ_FREQS, EQ_PRESETS } from './player.js';
import { Dial, stationFreq } from './dial.js';
import { lyricsView } from './lyrics.js';
import * as V from './views.js';
import { trackMenu, toggleFav, go, artistHref } from './components.js';

const $ = (id) => document.getElementById(id);
const main = $('main');

// ============================================================ router
const ROUTES = {
  '': V.home, search: V.search, discover: V.discover, radio: V.radioView,
  artists: V.artists, artist: V.artist, albums: V.albums, album: V.album,
  songs: V.tracksView, favorites: V.favorites, history: V.historyView,
  playlist: V.playlistView, smart: V.smartView, archive: V.archiveView, settings: V.settingsView,
  audius: V.audiusArtist,
};
// Which views re-render when the data changes.
const DEPS = {
  library: ['', 'artists', 'artist', 'albums', 'album', 'songs', 'smart', 'settings'],
  favorites: ['favorites', 'artists', 'artist', 'albums', 'album', 'songs'],
  playlists: ['playlist'],
  history: ['history'],
  stations: [''],
};

// Old Bosnian routes from earlier versions keep working.
const LEGACY_ROUTES = {
  pretraga: 'search', otkrij: 'discover', izvodjaci: 'artists', izvodjac: 'artist', albumi: 'albums',
  pesme: 'songs', omiljene: 'favorites', istorija: 'history', plejlista: 'playlist', pametna: 'smart', podesavanja: 'settings',
};

function parseHash() {
  const legacy = /^#\/([a-z]+)/.exec(location.hash);
  if (legacy && LEGACY_ROUTES[legacy[1]]) {
    history.replaceState(null, '', '#/' + LEGACY_ROUTES[legacy[1]] + location.hash.slice(legacy[0].length));
  }
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [name, ...rest] = path.split('/');
  return { name: name || '', arg: rest.join('/'), params: new URLSearchParams(query) };
}

let currentRoute = null;
function render({ keepScroll = false } = {}) {
  const r = parseHash();
  const view = ROUTES[r.name] || V.home;
  const scroll = main.scrollTop;
  const sameRoute = currentRoute && currentRoute.name === r.name && currentRoute.arg === r.arg;
  currentRoute = r;
  let el;
  try { el = view(r.params, r.arg); }
  catch (e) { console.error(e); el = h('div.view', {}, h('div.err', {}, h('p', {}, tr('This screen failed to load: ') + e.message))); }
  main.replaceChildren(el);
  if (keepScroll && sameRoute) main.scrollTop = scroll;
  else {
    main.scrollTop = 0;
    if (r.name !== 'search') main.querySelector('h1')?.setAttribute('tabindex', '-1');
  }
  markPlaying();
  updateNav();
  document.body.classList.remove('nav-open');
  $('navToggle').setAttribute('aria-expanded', 'false');
}

window.addEventListener('hashchange', () => {
  // Search updates the URL itself while you type, so it is not re-rendered.
  const r = parseHash();
  if (currentRoute?.name === 'search' && r.name === 'search' && document.activeElement?.type === 'search') return;
  render();
  if (r.name !== 'search') main.querySelector('h1')?.focus({ preventScroll: true });
});

for (const [evt, names] of Object.entries(DEPS)) {
  store.addEventListener(evt, () => {
    if (evt === 'playlists' || evt === 'library') renderNav();
    if (currentRoute && names.includes(currentRoute.name)) render({ keepScroll: true });
  });
}

// ============================================================ sidebar
const NAV = [
  { href: '#/', name: '', label: 'Home', icon: 'home' },
  { href: '#/search', name: 'search', label: 'Search', icon: 'search' },
  { href: '#/discover', name: 'discover', label: 'Discover', icon: 'compass' },
  { href: '#/radio', name: 'radio', label: 'Radio', icon: 'radio' },
];
const NAV_LIB = [
  { href: '#/artists', name: 'artists', alt: ['artist'], label: 'Artists', icon: 'artist' },
  { href: '#/albums', name: 'albums', alt: ['album'], label: 'Albums', icon: 'album' },
  { href: '#/songs', name: 'songs', label: 'Songs', icon: 'song' },
  { href: '#/favorites', name: 'favorites', label: 'Favorites', icon: 'heart' },
  { href: '#/history', name: 'history', label: 'History', icon: 'history' },
];

function navLink(n) {
  return h('a.nav__link', { href: n.href, dataset: { route: n.name, alt: (n.alt || []).join(',') } }, icon(n.icon, 19), h('span', {}, tr(n.label)));
}

function renderNav() {
  const side = $('side');
  side.replaceChildren(
    h('a.brand', { href: '#/' }, h('span.brand__mark', { 'aria-hidden': 'true' }), 'Tunes'),
    h('div.nav', {}, NAV.map(navLink)),
    h('div.nav', {}, h('p.nav__label', {}, tr('Collection')), NAV_LIB.map(navLink)),
    h('div.nav.nav--lists', {},
      h('div.nav__head', {},
        h('p.nav__label', {}, tr('Playlists')),
        iconBtn('plus', tr('New playlist'), async () => {
          const name = await ask(tr('New playlist'), { placeholder: tr('Playlist name'), confirm: tr('Create') });
          if (!name) return;
          const p = await store.createPlaylist(name);
          go('#/playlist/' + p.id);
        }, { size: 17 })),
      store.playlists.length
        ? h('div.nav__scroll', {}, store.playlists.map((p) => h('a.nav__link.nav__link--pl', {
          href: '#/playlist/' + p.id, dataset: { route: 'playlist', arg: p.id },
          ondragover: (e) => e.preventDefault(),
        }, h('span', {}, p.name), h('span.nav__count', {}, String(p.tracks.length)))))
        : h('p.nav__hint', {}, tr('Create your first playlist with the + button'))),
    h('div.nav.nav--foot', {},
      IS_LOCAL ? h('button.nav__link.nav__phone', { type: 'button', onclick: openPhone, class: store.settings.phoneOn ? 'is-live' : '' },
        icon('phone', 19), h('span', {}, tr('Listen on phone')), store.settings.phoneOn ? h('span.nav__dot', { title: tr('On') }) : null) : null,
      !IS_LOCAL && !IS_STANDALONE ? h('button.nav__link.nav__phone', { type: 'button', onclick: openInstall },
        icon('plus', 19), h('span', {}, tr('Add to Home Screen'))) : null,
      navLink({ href: '#/settings', name: 'settings', label: tr('Settings'), icon: 'settings' })));
  updateNav();
}

function updateNav() {
  const r = currentRoute || parseHash();
  for (const a of document.querySelectorAll('.nav__link')) {
    const alt = (a.dataset.alt || '').split(',').filter(Boolean);
    const on = (a.dataset.route === r.name && (!a.dataset.arg || a.dataset.arg === r.arg)) || alt.includes(r.name);
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// ============================================================ player bar
const deck = $('deck');
const els = {};

function buildDeck() {
  els.cover = h('button.deck__cv', { type: 'button', 'aria-label': tr('Open “Now playing”'), onclick: () => openNow() });
  els.title = h('a.deck__title', { href: '#/' });
  els.artist = h('span.deck__artist');
  els.fav = h('button.ibtn.deck__fav', { type: 'button', 'aria-label': tr('Add to favorites'), onclick: () => player.track && toggleFav(player.track) });
  els.shuffle = iconBtn('shuffle', tr('Shuffle (S)'), () => player.toggleShuffle());
  els.prev = iconBtn('prev', tr('Previous (Shift + ←)'), () => player.prev());
  els.play = h('button.play', { type: 'button', 'aria-label': tr('Play (space)'), onclick: () => player.toggle() });
  els.next = iconBtn('next', tr('Next (Shift + →)'), () => player.next());
  els.repeat = iconBtn('repeat', tr('Repeat (R)'), () => player.cycleRepeat());
  els.t0 = h('span.deck__time');
  els.t1 = h('span.deck__time.deck__time--end');
  els.canvas = h('canvas.dial__cv', { 'aria-hidden': 'true' });
  els.tip = h('span.dial__tip', { hidden: true });
  els.dialBox = h('div.dial', { role: 'slider', tabindex: '0', 'aria-label': tr('Position in song'), 'aria-valuemin': '0' }, els.canvas, els.tip);
  els.lyrics = iconBtn('lyrics', tr('Lyrics (T)'), () => togglePanel('lyrics'));
  els.queue = iconBtn('queue', tr('Play queue (Q)'), () => togglePanel('queue'));
  els.eq = iconBtn('eq', tr('Equalizer (E)'), () => toggleEq());
  els.sleep = iconBtn('moon', tr('Sleep timer'), (e) => sleepMenu(e.currentTarget));
  els.mute = iconBtn('volume', tr('Mute (M)'), () => player.toggleMute());
  els.vol = h('input.vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(player.volume), 'aria-label': tr('Volume') });
  els.vol.addEventListener('input', () => player.setVolume(Number(els.vol.value)));
  els.vol.addEventListener('wheel', (e) => { e.preventDefault(); player.setVolume(player.volume - Math.sign(e.deltaY) * 0.05); }, { passive: false });
  els.full = iconBtn('expand', tr('Full screen (F)'), () => openNow());

  deck.replaceChildren(
    h('div.deck__now', {}, els.cover, h('div.deck__meta', {}, els.title, els.artist), els.fav),
    h('div.deck__center', {},
      h('div.deck__ctrls', {}, els.shuffle, els.prev, els.play, els.next, els.repeat),
      h('div.deck__dial', {}, els.t0, els.dialBox, els.t1)),
    h('div.deck__tools', {}, els.lyrics, els.queue, els.eq, els.sleep, h('div.volbox', {}, els.mute, els.vol), els.full));

  els.dial?.destroy();
  els.dial = new Dial(els.canvas);
  bindDial(els.dialBox, els.dial, els.tip);
}

function bindDial(box, dial, tip) {
  // Mouse: press and drag seeks right away. Touch: a tap or a sideways drag seeks, but a
  // vertical swipe (closing the app from the iPhone home bar, scrolling) is ignored.
  let dragging = false;
  let touch = null; // { x, y } where a touch started, until we know which way it goes
  const show = (e) => {
    if (!player.track || player.track.live) return;
    dial.hoverX = dial.xAt(e.clientX);
    tip.hidden = false;
    tip.textContent = fmtTime(dial.timeAt(e.clientX));
    tip.style.left = dial.hoverX + 'px';
  };
  const hide = () => { dial.hoverX = null; tip.hidden = true; };
  box.addEventListener('pointermove', (e) => {
    if (touch && !dragging) {
      const dx = Math.abs(e.clientX - touch.x);
      const dy = Math.abs(e.clientY - touch.y);
      if (dy > 10 && dy > dx) { touch = null; hide(); return; }
      if (dx > 8) dragging = true; else return;
    }
    if (e.pointerType !== 'mouse' && !dragging) return;
    show(e);
    if (dragging) player.seek(dial.timeAt(e.clientX));
  });
  box.addEventListener('pointerleave', () => { if (!dragging) hide(); });
  box.addEventListener('pointerdown', (e) => {
    if (!player.track || player.track.live) return;
    box.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') {
      dragging = true;
      player.seek(dial.timeAt(e.clientX));
    } else {
      touch = { x: e.clientX, y: e.clientY };
    }
  });
  box.addEventListener('pointerup', (e) => {
    if (touch && !dragging) player.seek(dial.timeAt(e.clientX)); // a plain tap
    if (e.pointerType !== 'mouse') hide();
    dragging = false;
    touch = null;
  });
  box.addEventListener('pointercancel', () => { dragging = false; touch = null; hide(); });
  box.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') { player.seek(player.time + step); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowLeft') { player.seek(player.time - step); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'Home') { player.seek(0); e.preventDefault(); }
  });
}

function updateTrack() {
  const t = player.track;
  els.cover.replaceChildren(cover(t?.cover, t?.title || '♪'));
  if (!t) {
    els.title.textContent = tr('Nothing playing');
    els.title.removeAttribute('href');
    els.artist.textContent = tr('Pick a song, album or station');
    document.title = 'Tunes';
  } else {
    els.title.textContent = t.title;
    els.title.href = player.context?.href || '#/';
    els.title.title = player.context ? tr('Playing from: ') + player.context.label : '';
    els.artist.replaceChildren(sourceTag(t.source), ' ', t.live ? (player.icyTitle || t.artist) : t.artist || '');
    document.title = `${player.icyTitle || t.title} · Tunes`;
  }
  updateFav();
  updateTime();
  markPlaying();
  els.dialBox.classList.toggle('is-live', Boolean(t?.live));
}

function updateFav() {
  const t = player.track;
  const on = Boolean(t && store.isFav(t.id));
  els.fav.replaceChildren(icon(on ? 'heartFill' : 'heart', 19));
  els.fav.classList.toggle('is-on', on);
  els.fav.setAttribute('aria-pressed', String(on));
  els.fav.setAttribute('aria-label', on ? tr('Remove from favorites (L)') : tr('Add to favorites (L)'));
  els.fav.disabled = !t;
}

function updateState() {
  const playing = player.playing;
  els.play.replaceChildren(icon(playing ? 'pause' : 'play', 22));
  els.play.setAttribute('aria-label', playing ? tr('Pause (space)') : tr('Play (space)'));
  els.play.classList.toggle('is-loading', player.loading);
  document.body.classList.toggle('is-playing', playing);
  const nowPlay = document.querySelector('.now .play');
  if (nowPlay) { nowPlay.replaceChildren(icon(playing ? 'pause' : 'play', 28)); nowPlay.setAttribute('aria-label', playing ? tr('Pause') : tr('Play')); }
}

function updateMode() {
  els.shuffle.classList.toggle('is-on', player.shuffle);
  els.shuffle.setAttribute('aria-pressed', String(player.shuffle));
  els.repeat.replaceChildren(icon(player.repeat === 'one' ? 'repeat1' : 'repeat', 20));
  els.repeat.classList.toggle('is-on', player.repeat !== 'off');
  els.repeat.setAttribute('aria-label', { off: tr('Repeat off (R)'), all: tr('Repeating the queue (R)'), one: tr('Repeating this song (R)') }[player.repeat]);
  els.repeat.title = els.repeat.getAttribute('aria-label');
}

function updateTime() {
  const t = player.track;
  if (t?.live) {
    els.t0.textContent = tr('live');
    els.t1.textContent = stationFreq(t) + ' MHz';
    els.dialBox.setAttribute('aria-valuetext', tr('Live'));
    return;
  }
  const d = player.duration;
  els.t0.textContent = fmtTime(player.time);
  els.t1.textContent = fmtTime(d);
  els.dialBox.setAttribute('aria-valuemax', String(Math.round(d || 0)));
  els.dialBox.setAttribute('aria-valuenow', String(Math.round(player.time)));
  els.dialBox.setAttribute('aria-valuetext', tr('{a} of {b}', { a: fmtTime(player.time), b: fmtTime(d) }));
  const nt = document.querySelectorAll('.now [data-time]');
  if (nt.length) { nt[0].textContent = fmtTime(player.time); nt[1].textContent = fmtTime(d); }
}

function updateVolume() {
  const v = player.muted ? 0 : player.volume;
  els.vol.value = String(v);
  els.vol.style.setProperty('--v', (v * 100).toFixed(0) + '%');
  els.mute.replaceChildren(icon(v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume', 20));
}

function markPlaying() {
  const id = player.track?.id;
  for (const n of document.querySelectorAll('.tr.is-playing, .station.is-playing')) n.classList.remove('is-playing');
  if (!id) return;
  for (const n of document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) n.classList.add('is-playing');
}

function updateHearts({ detail }) {
  for (const row of document.querySelectorAll(`.tr[data-id="${CSS.escape(detail.id)}"] .tr__fav`)) {
    row.classList.toggle('is-on', detail.favorite);
    row.setAttribute('aria-pressed', String(detail.favorite));
    row.replaceChildren(icon(detail.favorite ? 'heartFill' : 'heart', 17));
  }
  updateFav();
}

function sleepMenu(btn) {
  const b = btn.getBoundingClientRect();
  const opts = [15, 30, 45, 60, 90].map((m) => ({ label: tr('In {m} minutes', { m }), action: () => { player.setSleep(m); toast(tr('Music stops in {m} minutes', { m })); } }));
  openMenu(b.left - 120, b.top - 260, [
    ...opts,
    { label: tr('At the end of this song'), action: () => { player.setSleep('end'); toast(tr('Music stops at the end of this song')); } },
    player.sleep ? '-' : null,
    player.sleep ? { label: tr('Turn off timer'), action: () => { player.clearSleep(); toast(tr('Timer off')); } } : null,
  ]);
}

function updateSleep() {
  els.sleep.classList.toggle('is-on', Boolean(player.sleep));
  clearInterval(updateSleep.iv);
  const label = () => {
    const s = player.sleep;
    if (!s) { els.sleep.title = tr('Sleep timer'); els.sleep.removeAttribute('data-badge'); return; }
    if (s.mode === 'end') { els.sleep.title = tr('Stops at the end of the song'); els.sleep.dataset.badge = '♪'; return; }
    const min = Math.max(0, Math.ceil((s.until - Date.now()) / 60000));
    els.sleep.title = tr('Stops in {m} min', { m: min });
    els.sleep.dataset.badge = String(min);
  };
  label();
  if (player.sleep?.until) updateSleep.iv = setInterval(label, 15000);
}

// ============================================================ side panel (queue / lyrics)
const panel = $('panel');
let panelTab = null;
let lyricsEl = null;

function togglePanel(tab) {
  if (panelTab === tab) { panelTab = null; panel.hidden = true; document.body.classList.remove('has-panel'); }
  else { panelTab = tab; panel.hidden = false; document.body.classList.add('has-panel'); renderPanel(); }
  els.queue.classList.toggle('is-on', panelTab === 'queue');
  els.lyrics.classList.toggle('is-on', panelTab === 'lyrics');
}

function renderPanel() {
  if (!panelTab) return;
  const head = h('div.panel__head', {},
    h('div.tabs.tabs--small', { role: 'tablist' },
      h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(panelTab === 'queue'), class: panelTab === 'queue' ? 'is-on' : '', onclick: () => { panelTab = 'queue'; renderPanel(); togglePanelBtns(); } }, tr('Queue')),
      h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(panelTab === 'lyrics'), class: panelTab === 'lyrics' ? 'is-on' : '', onclick: () => { panelTab = 'lyrics'; renderPanel(); togglePanelBtns(); } }, tr('Lyrics'))),
    iconBtn('close', tr('Close panel'), () => togglePanel(panelTab), { size: 18 }));
  if (panelTab === 'lyrics') {
    lyricsEl ||= lyricsView();
    panel.replaceChildren(head, lyricsEl);
    return;
  }
  const q = player.queue;
  const i = player.index;
  const body = h('div.queue');
  if (!q.length) body.append(h('p.empty', {}, tr('The queue is empty. Play an album, playlist or station.')));
  else {
    const cur = q[i];
    body.append(h('p.queue__label', {}, tr('Now playing')), queueRow(cur, i, true));
    const upcoming = q.slice(i + 1);
    body.append(h('div.queue__bar', {},
      h('p.queue__label', {}, upcoming.length ? tr('Up next ({n})', { n: songs(upcoming.length) }) : tr('No more songs in the queue')),
      upcoming.length ? h('button.link', { type: 'button', onclick: () => player.clearUpcoming() }, tr('Clear')) : null));
    if (player.context) body.append(h('p.queue__ctx', {}, tr('From: '), h('a', { href: player.context.href }, player.context.label)));
    const list = h('ol.queue__list');
    upcoming.slice(0, 300).forEach((t, k) => list.append(queueRow(t, i + 1 + k, false)));
    body.append(list);
    if (i > 0) {
      body.append(h('details.queue__prev', {}, h('summary', {}, tr('Already played ({n})', { n: i })),
        h('ol.queue__list', {}, q.slice(Math.max(0, i - 50), i).map((t, k) => queueRow(t, Math.max(0, i - 50) + k, false)))));
    }
  }
  panel.replaceChildren(head, body);
}

function togglePanelBtns() {
  els.queue.classList.toggle('is-on', panelTab === 'queue');
  els.lyrics.classList.toggle('is-on', panelTab === 'lyrics');
}

function queueRow(t, idx, current) {
  const li = h('li.qr', {
    class: current ? 'is-current' : '', draggable: current ? undefined : 'true', dataset: { i: String(idx) },
    oncontextmenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, trackMenu(t)); },
  },
  cover(t.cover, t.title, 'qr__cv'),
  h('button.qr__main', { type: 'button', onclick: () => player.jump(idx), 'aria-label': tr('Play ') + t.title },
    h('span.qr__title', {}, t.title), h('span.qr__artist', {}, t.artist || '')),
  current ? null : iconBtn('close', tr('Remove from queue'), () => player.removeAt(idx), { size: 16 }));
  if (!current) {
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-q', String(idx)); li.classList.add('is-drag'); });
    li.addEventListener('dragend', () => li.classList.remove('is-drag'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('is-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('is-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault(); li.classList.remove('is-over');
      const from = Number(e.dataTransfer.getData('text/x-q'));
      if (!Number.isNaN(from)) player.move(from, idx);
    });
  }
  return li;
}

// ============================================================ equalizer
const eqBox = $('eq');
function toggleEq(force) {
  const open = force ?? eqBox.hidden;
  eqBox.hidden = !open;
  els.eq.classList.toggle('is-on', open || player.eq.enabled);
  if (open) { renderEq(); eqBox.querySelector('input, button')?.focus(); }
}

function renderEq() {
  const eq = player.eq;
  const sliders = EQ_FREQS.map((f, i) => {
    const val = h('output.eq__val', {}, fmtDb(eq.gains[i]));
    const input = h('input.eq__range', {
      type: 'range', min: '-12', max: '12', step: '1', value: String(eq.gains[i] || 0),
      'aria-label': `${fmtFreq(f)} Hz`, 'aria-valuetext': fmtDb(eq.gains[i]) + ' dB', disabled: !eq.enabled,
    });
    input.addEventListener('input', () => {
      const gains = player.eq.gains.slice();
      gains[i] = Number(input.value);
      val.textContent = fmtDb(gains[i]);
      input.setAttribute('aria-valuetext', fmtDb(gains[i]) + ' dB');
      player.setEq({ gains, preset: tr('Custom') });
      eqBox.querySelectorAll('.eq__presets .chip').forEach((c) => { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
    });
    return h('div.eq__band', {}, val, input, h('span.eq__f', {}, fmtFreq(f)));
  });
  const onOff = h('button.switch', {
    type: 'button', role: 'switch', 'aria-checked': String(eq.enabled), 'aria-label': tr('Equalizer on'),
    onclick: () => { player.setEq({ enabled: !player.eq.enabled }); renderEq(); els.eq.classList.add('is-on'); },
  }, h('span.switch__knob'));
  eqBox.replaceChildren(
    h('div.eq__head', {}, h('h2.eq__title', {}, tr('Equalizer')), onOff, iconBtn('close', tr('Close equalizer'), () => toggleEq(false), { size: 18 })),
    h('div.eq__presets.chips', { role: 'group', 'aria-label': tr('Sound presets') }, Object.keys(EQ_PRESETS).map((name) =>
      h('button.chip', {
        type: 'button', disabled: !eq.enabled, class: eq.preset === name ? 'is-on' : '', 'aria-pressed': String(eq.preset === name),
        onclick: () => { player.setEq({ preset: name, gains: EQ_PRESETS[name].slice() }); renderEq(); },
      }, tr(name)))),
    h('div.eq__bands', { class: eq.enabled ? '' : 'is-off' }, sliders),
    ...(player.mobile ? [h('p.eq__note', {}, tr('On phones the equalizer is off so music keeps playing when the screen is locked.'))]
      : !player.analysing && player.track?.live ? [h('p.eq__note', {}, tr('This station plays directly, so the equalizer doesn\'t affect it.'))] : []));
}
const fmtDb = (v) => (v > 0 ? '+' : '') + (v || 0);
const fmtFreq = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));

// ============================================================ "Now Playing" full screen
const now = $('now');
let nowDial = null;
let nowLyrics = null;
let lastFocus = null;

function openNow() {
  if (!player.track) return;
  lastFocus = document.activeElement;
  now.hidden = false;
  document.body.classList.add('now-open');
  renderNow();
  now.querySelector('.now__close')?.focus();
}

function closeNow() {
  now.hidden = true;
  document.body.classList.remove('now-open');
  lastFocus?.focus?.();
}

function renderNow() {
  if (now.hidden) return;
  const t = player.track;
  if (!t) { closeNow(); return; }
  const canvas = h('canvas.dial__cv', { 'aria-hidden': 'true' });
  const tip = h('span.dial__tip', { hidden: true });
  const dialBox = h('div.dial.dial--big', { role: 'slider', tabindex: '0', 'aria-label': tr('Position in song'), class: t.live ? 'is-live' : '' }, canvas, tip);
  nowLyrics ||= lyricsView({ big: true });
  const artistLink = !t.live && store.index.artistMap.has(norm(t.albumArtist || t.artist));
  now.replaceChildren(
    h('div.now__bg', { style: t.cover ? { backgroundImage: `url("${t.cover}")` } : {} }),
    h('div.now__top', {},
      player.context ? h('p.now__ctx', {}, tr('Playing from: '), h('a', { href: player.context.href, onclick: closeNow }, player.context.label)) : h('span'),
      iconBtn('collapse', tr('Close (Esc)'), closeNow, { class: 'ibtn now__close' })),
    h('div.now__body', {},
      h('div.now__art', {},
        cover(t.cover, t.title, 'now__cv'),
        h('div.now__meta', {},
          h('h2.now__title', {}, t.live && player.icyTitle ? player.icyTitle : t.title),
          h('p.now__artist', {},
            t.live ? t.title : artistLink ? h('a', { href: artistHref(t.albumArtist || t.artist), onclick: closeNow }, t.artist) : t.artist || '',
            t.album && !t.live ? h('span.now__album', {}, t.album) : null))),
      h('div.now__lyrics', {}, nowLyrics)),
    h('div.now__deck', {},
      h('div.deck__dial', {}, h('span.deck__time', { dataset: { time: '0' } }, t.live ? tr('live') : fmtTime(player.time)), dialBox,
        h('span.deck__time.deck__time--end', { dataset: { time: '1' } }, t.live ? stationFreq(t) + ' MHz' : fmtTime(player.duration))),
      h('div.deck__ctrls.deck__ctrls--big', {},
        iconBtn('shuffle', tr('Shuffle'), () => player.toggleShuffle(), { class: 'ibtn' + (player.shuffle ? ' is-on' : '') }),
        iconBtn('prev', tr('Previous'), () => player.prev(), { size: 24 }),
        h('button.play.play--big', { type: 'button', 'aria-label': player.playing ? tr('Pause') : tr('Play'), onclick: () => player.toggle() }, icon(player.playing ? 'pause' : 'play', 28)),
        iconBtn('next', tr('Next'), () => player.next(), { size: 24 }),
        h('button.ibtn', { type: 'button', class: store.isFav(t.id) ? 'is-on' : '', 'aria-label': tr('Favorite'), onclick: async () => { await toggleFav(t); renderNow(); } }, icon(store.isFav(t.id) ? 'heartFill' : 'heart', 22)))));
  nowDial?.destroy();
  nowDial = new Dial(canvas, { big: true });
  bindDial(dialBox, nowDial, tip);
}

now.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    const f = [...now.querySelectorAll('a, button, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { f.at(-1).focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { f[0].focus(); e.preventDefault(); }
  }
});

// ============================================================ listening on a phone
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

async function openPhone() {
  const body = h('div.dlg__body');
  const dlg = h('dialog.dlg.dlg--phone', { 'aria-label': tr('Listen on phone') }, body);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  let tab = 'wifi';

  const head = () => h('div.dlg__head', {}, h('h2.dlg__title', {}, tr('Listen on phone')),
    iconBtn('close', tr('Close'), () => dlg.close(), { size: 18 }));
  const render = (st, err) => {
    store.settings.phoneOn = st.enabled;
    renderNav();
    const parts = [head()];
    if (err) parts.push(h('p.err', {}, err));
    if (!st.enabled) {
      parts.push(h('p.muted', {}, tr('Phone access is off. Once you turn it on, your music, playlists and favorites are the same as on this computer.')),
        h('div.dlg__actions', {}, h('button.btn.btn--primary', { type: 'button', onclick: () => toggle(true) }, icon('phone', 16), tr('Turn on'))));
      body.replaceChildren(...parts);
      return;
    }
    parts.push(h('div.tabs.tabs--small.phone__tabs', { role: 'tablist' },
      [['wifi', tr('At home (Wi-Fi)')], ['tailscale', tr('Away from home (Tailscale)')]].map(([k, label]) =>
        h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'is-on' : '', onclick: () => { tab = k; render(st); } }, label))));
    const cur = tab === 'wifi' ? st.wifi : st.tailscale;
    if (cur.qr) {
      parts.push(h('div.phone__qr', { html: cur.qr, role: 'img', 'aria-label': tr('QR code to open on your phone') }));
      parts.push(tab === 'wifi'
        ? h('ol.phone__steps', {},
          h('li', {}, tr('Open the camera on your phone and point it at the code.')),
          h('li', {}, tr('Tap the link that appears. Tunes opens in the browser.')),
          h('li', {}, tr('The phone must be on the same Wi-Fi network as this computer.')))
        : h('ol.phone__steps', {},
          h('li', {}, tr('On your phone, turn on the Tailscale app, signed in to the same account as this computer.')),
          h('li', {}, tr('Scan the code with your camera and tap the link.')),
          h('li', {}, tr('Works anywhere: at home, at work or on mobile data. The computer has to stay on.'))));
      parts.push(h('p.phone__url', {}, cur.url));
    } else if (tab === 'tailscale') {
      parts.push(h('p', {}, st.tailscale.running ? tr('Tailscale is running, but this computer doesn\'t have an address yet. Try again in a few seconds.')
        : tr('Tailscale isn\'t running on this computer. Start the Tailscale app (icon in the menu bar) and try again.')),
      h('p.muted', {}, tr('Tailscale is free for personal devices: '), h('a', { href: 'https://tailscale.com/download', target: '_blank', rel: 'noopener' }, 'tailscale.com/download')));
    } else {
      parts.push(h('p', {}, tr('This computer isn\'t connected to a network. Connect to Wi-Fi and try again.')));
    }
    parts.push(h('p.muted.phone__note', {}, tr('If macOS asks whether “node” may accept connections, click Allow.')),
      h('div.dlg__actions', {},
        h('button.btn.btn--ghost', { type: 'button', onclick: () => toggle(false) }, tr('Turn off access')),
        h('button.btn', { type: 'button', onclick: () => api('/api/phone').then((x) => render(x)) }, icon('refresh', 16), tr('Refresh')),
        h('button.btn.btn--primary', { type: 'button', onclick: () => dlg.close() }, tr('Done'))));
    body.replaceChildren(...parts);
  };
  const toggle = async (on) => {
    body.replaceChildren(head(), loading());
    try {
      const st = await api('/api/phone', { method: 'POST', body: { enabled: on } });
      render(st);
      if (!on) toast(tr('Phone access is off. The old link no longer works.'));
    } catch (e) { render({ enabled: false }, e.message); }
  };
  body.append(head(), loading());
  try {
    const st = await api('/api/phone');
    // One click: if it is off, turn it on and show the QR code right away.
    if (!st.enabled) await toggle(true); else render(st);
  } catch (e) { render({ enabled: false }, e.message); }
}
document.addEventListener('open-phone', openPhone);

// ============================================================ add to Home Screen (phone)
const IS_STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const ON_TAILSCALE = location.hostname.endsWith('.ts.net') || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(location.hostname);
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

async function openInstall() {
  const body = h('div.dlg__body');
  const dlg = h('dialog.dlg.dlg--phone', { 'aria-label': tr('Add to Home Screen') }, body);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  const head = h('div.dlg__head', {}, h('h2.dlg__title', {}, tr('Add to Home Screen')),
    iconBtn('close', tr('Close'), () => dlg.close(), { size: 18 }));
  const steps = IS_IOS
    ? h('ol.phone__steps', {},
      h('li', {}, tr('Open this page in Safari.')),
      h('li', {}, tr('Tap the Share button (the square with an arrow pointing up).')),
      h('li', {}, tr('Choose “Add to Home Screen”, then “Add”.')))
    : installPrompt
      ? h('div.dlg__actions', {}, h('button.btn.btn--primary', { type: 'button', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; dlg.close(); } }, icon('plus', 16), tr('Install app')))
      : h('ol.phone__steps', {},
        h('li', {}, tr('Open this page in Chrome.')),
        h('li', {}, tr('Tap the ⋮ menu in the top right.')),
        h('li', {}, tr('Choose “Add to Home screen” or “Install app”.')));
  const ts = h('div.install__ts', {}, h('p.loading', {}, h('span.loading__dot'), tr('Loading…')));
  body.append(head,
    h('p.muted', {}, tr('Tunes will open like a real app, full screen and with its own icon.')),
    steps,
    h('h3.install__h', {}, tr('Listening away from home (Tailscale)')),
    ts);
  const tsSteps = (link) => h('div', {},
    h('ol.phone__steps', {},
      h('li', {}, tr('Install Tailscale on your phone: '),
        h('a', { href: IS_IOS ? 'https://apps.apple.com/app/tailscale/id1470499037' : 'https://play.google.com/store/apps/details?id=com.tailscale.ipn', target: '_blank', rel: 'noopener' }, IS_IOS ? 'App Store' : 'Google Play'),
        tr(', and sign in with the same account as on your computer.')),
      h('li', {}, tr('Open the Tailscale version with the button below.')),
      h('li', {}, tr('Add that one to your Home Screen. It works both at home and away.'))),
    link ? h('a.btn.btn--primary', { href: link }, icon('external', 16), tr('Open Tailscale version')) : null);
  if (ON_TAILSCALE) {
    ts.replaceChildren(h('p', {}, tr('This version runs over Tailscale, so it works both at home and away. Add this one to your Home Screen.')));
    return;
  }
  try {
    const links = await api('/api/phone/links');
    if (links.tailscale) ts.replaceChildren(tsSteps(links.tailscale));
    else ts.replaceChildren(h('p.muted', {}, tr('Tailscale isn\'t running on the computer. Start it there, then open this window again.')), tsSteps(null));
  } catch { ts.replaceChildren(tsSteps(null)); }
}

// First visit on a phone: a short reminder that Tunes can be added to the Home Screen.
function maybeShowInstallHint() {
  if (IS_LOCAL || IS_STANDALONE) return;
  try { if (localStorage.getItem('tunes.installHint')) return; localStorage.setItem('tunes.installHint', '1'); } catch { return; }
  setTimeout(() => toast(tr('Add Tunes to your Home Screen so it opens like an app.'), { action: tr('How?'), onAction: openInstall, timeout: 9000 }), 1500);
}

function loading() {
  return h('p.loading', { role: 'status' }, h('span.loading__dot'), tr('Loading…'));
}

// ============================================================ continue on another device
const DEVICE_ID = (() => {
  let id = null;
  try { id = localStorage.getItem('tunes.device'); } catch { /* */ }
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('tunes.device', id); } catch { /* */ }
  }
  return id;
})();
// Send the device type; the device that displays it translates the name.
const DEVICE_KIND = player.mobile ? 'mobile' : 'computer';
const deviceName = (kind) => (kind === 'mobile' ? tr('Phone') : tr('Computer'));
let activeHere = false;   // whether something was played on this device this session
let lastReport = 0;
let remote = null;        // what is playing on another device
let dismissedFor = null;

function reportSession(force = false) {
  const t = player.track;
  if (!t || !activeHere) return;
  // Playback just started here: take it over first, or the server would tell us to yield.
  if (player.playing && !ownsPlayback) { claimPlayback().then(() => reportSession(true)); return; }
  const now = Date.now();
  if (!force && now - lastReport < 5000) return;
  lastReport = now;
  const start = Math.max(0, player.index - 20);
  api('/api/session', { method: 'POST', body: {
    deviceId: DEVICE_ID, device: DEVICE_KIND, track: t, time: player.track.live ? 0 : player.time,
    playing: player.playing, index: player.index - start, queue: player.queue.slice(start, start + 500), context: player.context,
  } }).then((r) => { if (r?.yield) yieldTo(r.yield); }).catch(() => {});
}

// Another device started playing: stop here, so music never plays on two devices at once.
function yieldTo(device) {
  ownsPlayback = false;
  if (!player.playing) return;
  player.pause();
  toast(tr('Music continues on: {d}', { d: deviceName(device) }));
}

// Tell the server (and through it every other device) that playback moved here.
let ownsPlayback = false; // this device has told the others that playback is here
function claimPlayback() {
  ownsPlayback = true;
  return api('/api/session/takeover', { method: 'POST', body: { deviceId: DEVICE_ID, device: DEVICE_KIND } }).catch(() => {});
}

const handoff = h('div.handoff', { hidden: true, role: 'region' });
document.body.append(handoff);

function remoteTime() {
  if (!remote || remote.track.live) return 0;
  const t = remote.time + (remote.playing ? (Date.now() - remote.at) / 1000 : 0);
  return remote.track.duration ? Math.min(t, remote.track.duration - 1) : t;
}

function renderHandoff() {
  const r = remote;
  const show = r && r.deviceId !== DEVICE_ID && dismissedFor !== r.track.id + r.deviceId
    && (r.playing || Date.now() - r.at < 6 * 3600e3)
    && !(player.playing && player.track?.id === r.track.id);
  handoff.hidden = !show;
  if (!show) return;
  handoff.setAttribute('aria-label', tr('Continue listening'));
  const when = r.track.live ? tr('live') : fmtTime(remoteTime());
  handoff.replaceChildren(
    cover(r.track.cover, r.track.title, 'handoff__cv'),
    h('div.handoff__text', {},
      h('span.handoff__label', {}, r.playing ? tr('Playing on: {d}', { d: deviceName(r.device) }) : tr('Paused on: {d}', { d: deviceName(r.device) })),
      h('span.handoff__title', {}, h('span.handoff__name', {}, r.track.title), h('span.handoff__time', {}, when))),
    h('button.btn.btn--primary', { type: 'button', onclick: takeOver }, icon('play', 16), tr('Continue here')),
    iconBtn('close', tr('Hide'), () => { dismissedFor = r.track.id + r.deviceId; renderHandoff(); }, { size: 18 }));
}

async function takeOver() {
  try {
    const { session } = await api('/api/session');
    if (!session) return;
    remote = session;
    const time = remoteTime();
    player.resumeAt(session.queue, session.index, time, session.context);
    activeHere = true;
    claimPlayback(); // also sent when playback starts; here in case autoplay is blocked
    handoff.hidden = true;
    toast(session.track.live ? tr('Continued here') : tr('Continued here from {t}', { t: fmtTime(time) }));
  } catch (e) { toast(e.message, { error: true }); }
}

player.addEventListener('state', () => {
  if (!player.playing) ownsPlayback = false; // the next play claims again
  if (player.playing && !activeHere) activeHere = true;
  reportSession(true); // claims first if playback just started
  renderHandoff();
});
player.addEventListener('track', () => reportSession(true));
player.addEventListener('time', () => reportSession(false));
setInterval(() => { if (!handoff.hidden) renderHandoff(); }, 1000);
new ResizeObserver(() => document.documentElement.style.setProperty('--deck-h', deck.offsetHeight + 'px')).observe(deck);

// ============================================================ shortcuts
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (!eqBox.hidden) { toggleEq(false); return; }
    if (!now.hidden) { closeNow(); return; }
    if (document.body.classList.contains('nav-open')) { setNav(false); return; }
    if (typing) e.target.blur();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); go('#/search'); }
    return;
  }
  if (e.target.closest?.('.dial') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
  const k = e.key;
  const handled = {
    ' ': () => { if (tag === 'BUTTON' || tag === 'A') return false; player.toggle(); },
    ArrowRight: () => (e.shiftKey ? player.next() : player.seek(player.time + 5)),
    ArrowLeft: () => (e.shiftKey ? player.prev() : player.seek(player.time - 5)),
    ArrowUp: () => { if (e.target.closest('.tl, .menu')) return false; player.setVolume(player.volume + 0.05); },
    ArrowDown: () => { if (e.target.closest('.tl, .menu')) return false; player.setVolume(player.volume - 0.05); },
    m: () => player.toggleMute(),
    l: () => player.track && toggleFav(player.track),
    s: () => player.toggleShuffle(),
    r: () => player.cycleRepeat(),
    q: () => togglePanel('queue'),
    t: () => togglePanel('lyrics'),
    e: () => toggleEq(),
    f: () => (now.hidden ? openNow() : closeNow()),
    '/': () => go('#/search'),
  }[k.length === 1 ? k.toLowerCase() : k];
  if (handled && handled() !== false) e.preventDefault();
});

// ============================================================ events
player.addEventListener('track', () => { updateTrack(); renderPanel(); renderNow(); });
player.addEventListener('state', updateState);
player.addEventListener('time', updateTime);
player.addEventListener('mode', () => { updateMode(); renderPanel(); });
player.addEventListener('queue', renderPanel);
player.addEventListener('volume', updateVolume);
player.addEventListener('sleep', updateSleep);
player.addEventListener('eq', () => els.eq.classList.toggle('is-on', player.eq.enabled || !eqBox.hidden));
player.addEventListener('icy', () => { updateTrack(); renderNow(); });
player.addEventListener('error', (e) => toast(e.detail, { error: true }));
store.addEventListener('favorites', updateHearts);

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('library', async (e) => {
    await store.reloadLibrary();
    const d = JSON.parse(e.data);
    if (d.changed) toast(tr('Library updated: {n}', { n: songs(d.count) }));
  });
  es.addEventListener('icy', (e) => { const d = JSON.parse(e.data); player.setIcy(d.sid, d.title); });
  es.addEventListener('icon', (e) => store.setIcon(JSON.parse(e.data).icon));
  es.addEventListener('session', (e) => { remote = JSON.parse(e.data); renderHandoff(); });
  es.addEventListener('takeover', (e) => {
    const d = JSON.parse(e.data);
    if (d.deviceId !== DEVICE_ID) yieldTo(d.device);
  });
}

// Mobile menu
$('navToggle').append(icon('menu', 22));
$('topSearch').append(icon('search', 20));
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('navToggle').setAttribute('aria-expanded', String(open));
}
$('navToggle').addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
// Tapping anywhere outside the open menu closes it.
$('navScrim').addEventListener('click', () => setNav(false));

// iOS scrolls the whole page when the keyboard opens and sometimes leaves it there,
// which pushes the top bar under the status bar. The page itself never scrolls (only .main does).
const unshift = () => { if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0); };
window.addEventListener('scroll', unshift, { passive: true });
document.addEventListener('focusout', () => setTimeout(unshift, 100));
window.visualViewport?.addEventListener('resize', () => setTimeout(unshift, 100));

// ============================================================ language
function applyStaticTexts() {
  document.querySelector('.skip').textContent = tr('Skip to content');
  $('navToggle').setAttribute('aria-label', tr('Menu'));
  $('topSearch').setAttribute('aria-label', tr('Search'));
  $('side').setAttribute('aria-label', tr('Main menu'));
  $('panel').setAttribute('aria-label', tr('Side panel'));
  $('deck').setAttribute('aria-label', tr('Player'));
  $('now').setAttribute('aria-label', tr('Now playing'));
  $('eq').setAttribute('aria-label', tr('Equalizer'));
}

// Re-render everything in the new language. The audio element is untouched,
// so whatever is playing keeps playing.
window.addEventListener('langchange', () => {
  applyStaticTexts();
  buildDeck();
  updateTrack(); updateState(); updateMode(); updateVolume(); updateSleep();
  renderNav();
  render({ keepScroll: true });
  lyricsEl = null;
  nowLyrics = null;
  renderPanel();
  togglePanelBtns();
  renderNow();
  if (!eqBox.hidden) renderEq();
  renderHandoff();
});

// ============================================================ start
async function boot() {
  applyStaticTexts();
  buildDeck();
  updateTrack(); updateState(); updateMode(); updateVolume(); updateSleep();
  try { await store.load(); }
  catch (e) { toast(tr('The server isn\'t responding. Is Tunes running?'), { error: true, timeout: 10000 }); }
  renderNav();
  render();
  updateTrack();
  connectEvents();
  maybeShowInstallHint();
  api('/api/session').then(({ session }) => { remote = session; renderHandoff(); }).catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();

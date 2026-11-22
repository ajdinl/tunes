// Pokretanje aplikacije: navigacija, player traka, paneli, prečice.
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

// ============================================================ ruter
const ROUTES = {
  '': V.home, pretraga: V.search, otkrij: V.discover, radio: V.radioView,
  izvodjaci: V.artists, izvodjac: V.artist, albumi: V.albums, album: V.album,
  pesme: V.tracksView, omiljene: V.favorites, istorija: V.historyView,
  plejlista: V.playlistView, pametna: V.smartView, archive: V.archiveView, podesavanja: V.settingsView,
  audius: V.audiusArtist,
};
// Koji prikazi se osvežavaju kad se promene podaci.
const DEPS = {
  library: ['', 'izvodjaci', 'izvodjac', 'albumi', 'album', 'pesme', 'pametna', 'podesavanja'],
  favorites: ['omiljene', 'izvodjaci', 'izvodjac', 'albumi', 'album', 'pesme'],
  playlists: ['plejlista'],
  history: ['istorija'],
  stations: [''],
};

function parseHash() {
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
  catch (e) { console.error(e); el = h('div.view', {}, h('div.err', {}, h('p', {}, tr('Ovaj ekran se nije uspio učitati: ') + e.message))); }
  main.replaceChildren(el);
  if (keepScroll && sameRoute) main.scrollTop = scroll;
  else {
    main.scrollTop = 0;
    if (r.name !== 'pretraga') main.querySelector('h1')?.setAttribute('tabindex', '-1');
  }
  markPlaying();
  updateNav();
  document.body.classList.remove('nav-open');
  $('navToggle').setAttribute('aria-expanded', 'false');
}

window.addEventListener('hashchange', () => {
  // Pretraga sama menja adresu dok kucaš, pa je ne crtamo ponovo.
  const r = parseHash();
  if (currentRoute?.name === 'pretraga' && r.name === 'pretraga' && document.activeElement?.type === 'search') return;
  render();
  if (r.name !== 'pretraga') main.querySelector('h1')?.focus({ preventScroll: true });
});

for (const [evt, names] of Object.entries(DEPS)) {
  store.addEventListener(evt, () => {
    if (evt === 'playlists' || evt === 'library') renderNav();
    if (currentRoute && names.includes(currentRoute.name)) render({ keepScroll: true });
  });
}

// ============================================================ bočni meni
const NAV = [
  { href: '#/', name: '', label: tr('Početna'), icon: 'home' },
  { href: '#/pretraga', name: 'pretraga', label: tr('Pretraga'), icon: 'search' },
  { href: '#/otkrij', name: 'otkrij', label: tr('Otkrij'), icon: 'compass' },
  { href: '#/radio', name: 'radio', label: 'Radio', icon: 'radio' },
];
const NAV_LIB = [
  { href: '#/izvodjaci', name: 'izvodjaci', alt: ['izvodjac'], label: tr('Izvođači'), icon: 'artist' },
  { href: '#/albumi', name: 'albumi', alt: ['album'], label: tr('Albumi'), icon: 'album' },
  { href: '#/pesme', name: 'pesme', label: tr('Pjesme'), icon: 'song' },
  { href: '#/omiljene', name: 'omiljene', label: tr('Omiljene'), icon: 'heart' },
  { href: '#/istorija', name: 'istorija', label: tr('Historija'), icon: 'history' },
];

function navLink(n) {
  return h('a.nav__link', { href: n.href, dataset: { route: n.name, alt: (n.alt || []).join(',') } }, icon(n.icon, 19), h('span', {}, n.label));
}

function renderNav() {
  const side = $('side');
  side.replaceChildren(
    h('a.brand', { href: '#/' }, h('span.brand__mark', { 'aria-hidden': 'true' }), 'Tunes'),
    h('div.nav', {}, NAV.map(navLink)),
    h('div.nav', {}, h('p.nav__label', {}, tr('Kolekcija')), NAV_LIB.map(navLink)),
    h('div.nav.nav--lists', {},
      h('div.nav__head', {},
        h('p.nav__label', {}, tr('Plejliste')),
        iconBtn('plus', tr('Nova plejlista'), async () => {
          const name = await ask(tr('Nova plejlista'), { placeholder: tr('Naziv plejliste'), confirm: tr('Napravi') });
          if (!name) return;
          const p = await store.createPlaylist(name);
          go('#/plejlista/' + p.id);
        }, { size: 17 })),
      store.playlists.length
        ? h('div.nav__scroll', {}, store.playlists.map((p) => h('a.nav__link.nav__link--pl', {
          href: '#/plejlista/' + p.id, dataset: { route: 'plejlista', arg: p.id },
          ondragover: (e) => e.preventDefault(),
        }, h('span', {}, p.name), h('span.nav__count', {}, String(p.tracks.length)))))
        : h('p.nav__hint', {}, tr('Napravi prvu plejlistu dugmetom +'))),
    h('div.nav.nav--foot', {},
      IS_LOCAL ? h('button.nav__link.nav__phone', { type: 'button', onclick: openPhone, class: store.settings.phoneOn ? 'is-live' : '' },
        icon('phone', 19), h('span', {}, tr('Slušaj na mobitelu')), store.settings.phoneOn ? h('span.nav__dot', { title: tr('Uključeno') }) : null) : null,
      navLink({ href: '#/podesavanja', name: 'podesavanja', label: tr('Postavke'), icon: 'settings' })));
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

// ============================================================ player traka
const deck = $('deck');
const els = {};

function buildDeck() {
  els.cover = h('button.deck__cv', { type: 'button', 'aria-label': tr('Otvori „Sada svira”'), onclick: () => openNow() });
  els.title = h('a.deck__title', { href: '#/' });
  els.artist = h('span.deck__artist');
  els.fav = h('button.ibtn.deck__fav', { type: 'button', 'aria-label': tr('Dodaj u omiljene'), onclick: () => player.track && toggleFav(player.track) });
  els.shuffle = iconBtn('shuffle', tr('Nasumično (S)'), () => player.toggleShuffle());
  els.prev = iconBtn('prev', tr('Prethodna (Shift + ←)'), () => player.prev());
  els.play = h('button.play', { type: 'button', 'aria-label': tr('Pusti (razmak)'), onclick: () => player.toggle() });
  els.next = iconBtn('next', tr('Sljedeća (Shift + →)'), () => player.next());
  els.repeat = iconBtn('repeat', tr('Ponavljanje (R)'), () => player.cycleRepeat());
  els.t0 = h('span.deck__time');
  els.t1 = h('span.deck__time.deck__time--end');
  els.canvas = h('canvas.dial__cv', { 'aria-hidden': 'true' });
  els.tip = h('span.dial__tip', { hidden: true });
  els.dialBox = h('div.dial', { role: 'slider', tabindex: '0', 'aria-label': tr('Pozicija u pjesmi'), 'aria-valuemin': '0' }, els.canvas, els.tip);
  els.lyrics = iconBtn('lyrics', tr('Tekst pjesme (T)'), () => togglePanel('tekst'));
  els.queue = iconBtn('queue', tr('Red za puštanje (Q)'), () => togglePanel('red'));
  els.eq = iconBtn('eq', tr('Ekvalizer (E)'), () => toggleEq());
  els.sleep = iconBtn('moon', tr('Tajmer za spavanje'), (e) => sleepMenu(e.currentTarget));
  els.mute = iconBtn('volume', tr('Utišaj (M)'), () => player.toggleMute());
  els.vol = h('input.vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(player.volume), 'aria-label': tr('Jačina zvuka') });
  els.vol.addEventListener('input', () => player.setVolume(Number(els.vol.value)));
  els.vol.addEventListener('wheel', (e) => { e.preventDefault(); player.setVolume(player.volume - Math.sign(e.deltaY) * 0.05); }, { passive: false });
  els.full = iconBtn('expand', tr('Cijeli ekran (F)'), () => openNow());

  deck.replaceChildren(
    h('div.deck__now', {}, els.cover, h('div.deck__meta', {}, els.title, els.artist), els.fav),
    h('div.deck__center', {},
      h('div.deck__ctrls', {}, els.shuffle, els.prev, els.play, els.next, els.repeat),
      h('div.deck__dial', {}, els.t0, els.dialBox, els.t1)),
    h('div.deck__tools', {}, els.lyrics, els.queue, els.eq, els.sleep, h('div.volbox', {}, els.mute, els.vol), els.full));

  els.dial = new Dial(els.canvas);
  bindDial(els.dialBox, els.dial, els.tip);
}

function bindDial(box, dial, tip) {
  let dragging = false;
  const show = (e) => {
    if (!player.track || player.track.live) return;
    dial.hoverX = dial.xAt(e.clientX);
    tip.hidden = false;
    tip.textContent = fmtTime(dial.timeAt(e.clientX));
    tip.style.left = dial.hoverX + 'px';
  };
  box.addEventListener('pointermove', (e) => { show(e); if (dragging) player.seek(dial.timeAt(e.clientX)); });
  box.addEventListener('pointerleave', () => { if (!dragging) { dial.hoverX = null; tip.hidden = true; } });
  box.addEventListener('pointerdown', (e) => {
    if (!player.track || player.track.live) return;
    dragging = true;
    box.setPointerCapture(e.pointerId);
    player.seek(dial.timeAt(e.clientX));
  });
  box.addEventListener('pointerup', () => { dragging = false; });
  box.addEventListener('pointercancel', () => { dragging = false; dial.hoverX = null; tip.hidden = true; });
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
    els.title.textContent = tr('Ništa ne svira');
    els.title.removeAttribute('href');
    els.artist.textContent = tr('Odaberi pjesmu, album ili stanicu');
    document.title = 'Tunes';
  } else {
    els.title.textContent = t.title;
    els.title.href = player.context?.href || '#/';
    els.title.title = player.context ? tr('Pušteno iz: ') + player.context.label : '';
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
  els.fav.setAttribute('aria-label', on ? 'Ukloni iz omiljenih (L)' : tr('Dodaj u omiljene (L)'));
  els.fav.disabled = !t;
}

function updateState() {
  const playing = player.playing;
  els.play.replaceChildren(icon(playing ? 'pause' : 'play', 22));
  els.play.setAttribute('aria-label', playing ? 'Pauziraj (razmak)' : tr('Pusti (razmak)'));
  els.play.classList.toggle('is-loading', player.loading);
  document.body.classList.toggle('is-playing', playing);
  const nowPlay = document.querySelector('.now .play');
  if (nowPlay) { nowPlay.replaceChildren(icon(playing ? 'pause' : 'play', 28)); nowPlay.setAttribute('aria-label', playing ? 'Pauziraj' : tr('Pusti')); }
}

function updateMode() {
  els.shuffle.classList.toggle('is-on', player.shuffle);
  els.shuffle.setAttribute('aria-pressed', String(player.shuffle));
  els.repeat.replaceChildren(icon(player.repeat === 'one' ? 'repeat1' : 'repeat', 20));
  els.repeat.classList.toggle('is-on', player.repeat !== 'off');
  els.repeat.setAttribute('aria-label', { off: tr('Ponavljanje isključeno (R)'), all: tr('Ponavlja se cijeli red (R)'), one: tr('Ponavlja se ova pjesma (R)') }[player.repeat]);
  els.repeat.title = els.repeat.getAttribute('aria-label');
}

function updateTime() {
  const t = player.track;
  if (t?.live) {
    els.t0.textContent = tr('uživo');
    els.t1.textContent = stationFreq(t) + ' MHz';
    els.dialBox.setAttribute('aria-valuetext', tr('Uživo'));
    return;
  }
  const d = player.duration;
  els.t0.textContent = fmtTime(player.time);
  els.t1.textContent = fmtTime(d);
  els.dialBox.setAttribute('aria-valuemax', String(Math.round(d || 0)));
  els.dialBox.setAttribute('aria-valuenow', String(Math.round(player.time)));
  els.dialBox.setAttribute('aria-valuetext', tr('{a} od {b}', { a: fmtTime(player.time), b: fmtTime(d) }));
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
  const opts = [15, 30, 45, 60, 90].map((m) => ({ label: tr('Za {m} minuta', { m }), action: () => { player.setSleep(m); toast(tr('Muzika staje za {m} minuta', { m })); } }));
  openMenu(b.left - 120, b.top - 260, [
    ...opts,
    { label: tr('Na kraju ove pjesme'), action: () => { player.setSleep('end'); toast(tr('Muzika staje na kraju ove pjesme')); } },
    player.sleep ? '-' : null,
    player.sleep ? { label: tr('Isključi tajmer'), action: () => { player.clearSleep(); toast(tr('Tajmer je isključen')); } } : null,
  ]);
}

function updateSleep() {
  els.sleep.classList.toggle('is-on', Boolean(player.sleep));
  clearInterval(updateSleep.iv);
  const label = () => {
    const s = player.sleep;
    if (!s) { els.sleep.title = tr('Tajmer za spavanje'); els.sleep.removeAttribute('data-badge'); return; }
    if (s.mode === 'end') { els.sleep.title = tr('Staje na kraju pjesme'); els.sleep.dataset.badge = '♪'; return; }
    const min = Math.max(0, Math.ceil((s.until - Date.now()) / 60000));
    els.sleep.title = tr('Staje za {m} min', { m: min });
    els.sleep.dataset.badge = String(min);
  };
  label();
  if (player.sleep?.until) updateSleep.iv = setInterval(label, 15000);
}

// ============================================================ bočni panel (red / tekst)
const panel = $('panel');
let panelTab = null;
let lyricsEl = null;

function togglePanel(tab) {
  if (panelTab === tab) { panelTab = null; panel.hidden = true; document.body.classList.remove('has-panel'); }
  else { panelTab = tab; panel.hidden = false; document.body.classList.add('has-panel'); renderPanel(); }
  els.queue.classList.toggle('is-on', panelTab === 'red');
  els.lyrics.classList.toggle('is-on', panelTab === 'tekst');
}

function renderPanel() {
  if (!panelTab) return;
  const head = h('div.panel__head', {},
    h('div.tabs.tabs--small', { role: 'tablist' },
      h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(panelTab === 'red'), class: panelTab === 'red' ? 'is-on' : '', onclick: () => { panelTab = 'red'; renderPanel(); togglePanelBtns(); } }, tr('Red')),
      h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(panelTab === 'tekst'), class: panelTab === 'tekst' ? 'is-on' : '', onclick: () => { panelTab = 'tekst'; renderPanel(); togglePanelBtns(); } }, tr('Tekst'))),
    iconBtn('close', tr('Zatvori panel'), () => togglePanel(panelTab), { size: 18 }));
  if (panelTab === 'tekst') {
    lyricsEl ||= lyricsView();
    panel.replaceChildren(head, lyricsEl);
    return;
  }
  const q = player.queue;
  const i = player.index;
  const body = h('div.queue');
  if (!q.length) body.append(h('p.empty', {}, tr('Red je prazan. Pusti album, plejlistu ili stanicu.')));
  else {
    const cur = q[i];
    body.append(h('p.queue__label', {}, tr('Sada svira')), queueRow(cur, i, true));
    const upcoming = q.slice(i + 1);
    body.append(h('div.queue__bar', {},
      h('p.queue__label', {}, upcoming.length ? tr('Sljedeće ({n})', { n: songs(upcoming.length) }) : tr('Nema više pjesama u redu')),
      upcoming.length ? h('button.link', { type: 'button', onclick: () => player.clearUpcoming() }, tr('Očisti')) : null));
    if (player.context) body.append(h('p.queue__ctx', {}, tr('Iz: '), h('a', { href: player.context.href }, player.context.label)));
    const list = h('ol.queue__list');
    upcoming.slice(0, 300).forEach((t, k) => list.append(queueRow(t, i + 1 + k, false)));
    body.append(list);
    if (i > 0) {
      body.append(h('details.queue__prev', {}, h('summary', {}, tr('Već pušteno ({n})', { n: i })),
        h('ol.queue__list', {}, q.slice(Math.max(0, i - 50), i).map((t, k) => queueRow(t, Math.max(0, i - 50) + k, false)))));
    }
  }
  panel.replaceChildren(head, body);
}

function togglePanelBtns() {
  els.queue.classList.toggle('is-on', panelTab === 'red');
  els.lyrics.classList.toggle('is-on', panelTab === 'tekst');
}

function queueRow(t, idx, current) {
  const li = h('li.qr', {
    class: current ? 'is-current' : '', draggable: current ? undefined : 'true', dataset: { i: String(idx) },
    oncontextmenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, trackMenu(t)); },
  },
  cover(t.cover, t.title, 'qr__cv'),
  h('button.qr__main', { type: 'button', onclick: () => player.jump(idx), 'aria-label': tr('Pusti ') + t.title },
    h('span.qr__title', {}, t.title), h('span.qr__artist', {}, t.artist || '')),
  current ? null : iconBtn('close', tr('Ukloni iz reda'), () => player.removeAt(idx), { size: 16 }));
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

// ============================================================ ekvalizer
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
      player.setEq({ gains, preset: tr('Prilagođeno') });
      eqBox.querySelectorAll('.eq__presets .chip').forEach((c) => { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
    });
    return h('div.eq__band', {}, val, input, h('span.eq__f', {}, fmtFreq(f)));
  });
  const onOff = h('button.switch', {
    type: 'button', role: 'switch', 'aria-checked': String(eq.enabled), 'aria-label': tr('Ekvalizer uključen'),
    onclick: () => { player.setEq({ enabled: !player.eq.enabled }); renderEq(); els.eq.classList.add('is-on'); },
  }, h('span.switch__knob'));
  eqBox.replaceChildren(
    h('div.eq__head', {}, h('h2.eq__title', {}, tr('Ekvalizer')), onOff, iconBtn('close', tr('Zatvori ekvalizer'), () => toggleEq(false), { size: 18 })),
    h('div.eq__presets.chips', { role: 'group', 'aria-label': tr('Postavke zvuka') }, Object.keys(EQ_PRESETS).map((name) =>
      h('button.chip', {
        type: 'button', disabled: !eq.enabled, class: eq.preset === name ? 'is-on' : '', 'aria-pressed': String(eq.preset === name),
        onclick: () => { player.setEq({ preset: name, gains: EQ_PRESETS[name].slice() }); renderEq(); },
      }, tr(name)))),
    h('div.eq__bands', { class: eq.enabled ? '' : 'is-off' }, sliders),
    ...(player.mobile ? [h('p.eq__note', {}, tr('Na mobitelu je ekvalizer isključen da bi muzika svirala i kad zaključaš ekran.'))]
      : !player.analysing && player.track?.live ? [h('p.eq__note', {}, tr('Ova stanica se pušta direktno, pa ekvalizer na nju ne djeluje.'))] : []));
}
const fmtDb = (v) => (v > 0 ? '+' : '') + (v || 0);
const fmtFreq = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));

// ============================================================ "Sada svira" ceo ekran
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
  const dialBox = h('div.dial.dial--big', { role: 'slider', tabindex: '0', 'aria-label': tr('Pozicija u pjesmi'), class: t.live ? 'is-live' : '' }, canvas, tip);
  nowLyrics ||= lyricsView({ big: true });
  const artistLink = !t.live && store.index.artistMap.has(norm(t.albumArtist || t.artist));
  now.replaceChildren(
    h('div.now__bg', { style: t.cover ? { backgroundImage: `url("${t.cover}")` } : {} }),
    h('div.now__top', {},
      player.context ? h('p.now__ctx', {}, tr('Pušteno iz: '), h('a', { href: player.context.href, onclick: closeNow }, player.context.label)) : h('span'),
      iconBtn('collapse', tr('Zatvori (Esc)'), closeNow, { class: 'ibtn now__close' })),
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
      h('div.deck__dial', {}, h('span.deck__time', { dataset: { time: '0' } }, t.live ? 'uživo' : fmtTime(player.time)), dialBox,
        h('span.deck__time.deck__time--end', { dataset: { time: '1' } }, t.live ? stationFreq(t) + ' MHz' : fmtTime(player.duration))),
      h('div.deck__ctrls.deck__ctrls--big', {},
        iconBtn('shuffle', tr('Nasumično'), () => player.toggleShuffle(), { class: 'ibtn' + (player.shuffle ? ' is-on' : '') }),
        iconBtn('prev', tr('Prethodna'), () => player.prev(), { size: 24 }),
        h('button.play.play--big', { type: 'button', 'aria-label': player.playing ? 'Pauziraj' : tr('Pusti'), onclick: () => player.toggle() }, icon(player.playing ? 'pause' : 'play', 28)),
        iconBtn('next', tr('Sljedeća'), () => player.next(), { size: 24 }),
        h('button.ibtn', { type: 'button', class: store.isFav(t.id) ? 'is-on' : '', 'aria-label': tr('Omiljena'), onclick: async () => { await toggleFav(t); renderNow(); } }, icon(store.isFav(t.id) ? 'heartFill' : 'heart', 22)))));
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

// ============================================================ slušanje na mobitelu
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

async function openPhone() {
  const body = h('div.dlg__body');
  const dlg = h('dialog.dlg.dlg--phone', { 'aria-label': tr('Slušaj na mobitelu') }, body);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  let tab = 'wifi';

  const head = () => h('div.dlg__head', {}, h('h2.dlg__title', {}, tr('Slušaj na mobitelu')),
    iconBtn('close', tr('Zatvori'), () => dlg.close(), { size: 18 }));
  const render = (st, err) => {
    store.settings.phoneOn = st.enabled;
    renderNav();
    const parts = [head()];
    if (err) parts.push(h('p.err', {}, err));
    if (!st.enabled) {
      parts.push(h('p.muted', {}, tr('Pristup sa telefona je isključen. Kad ga uključiš, muzika, plejliste i omiljene su iste kao na računaru.')),
        h('div.dlg__actions', {}, h('button.btn.btn--primary', { type: 'button', onclick: () => toggle(true) }, icon('phone', 16), tr('Uključi'))));
      body.replaceChildren(...parts);
      return;
    }
    parts.push(h('div.tabs.tabs--small.phone__tabs', { role: 'tablist' },
      [['wifi', tr('Kod kuće (Wi-Fi)')], ['tailscale', tr('Van kuće (Tailscale)')]].map(([k, label]) =>
        h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'is-on' : '', onclick: () => { tab = k; render(st); } }, label))));
    const cur = tab === 'wifi' ? st.wifi : st.tailscale;
    if (cur.qr) {
      parts.push(h('div.phone__qr', { html: cur.qr, role: 'img', 'aria-label': tr('QR kod za otvaranje na telefonu') }));
      parts.push(tab === 'wifi'
        ? h('ol.phone__steps', {},
          h('li', {}, tr('Otvori kameru na telefonu i usmjeri je na kod.')),
          h('li', {}, tr('Dodirni link koji se pojavi. Tunes se otvara u browseru.')),
          h('li', {}, tr('Telefon mora biti na istoj Wi-Fi mreži kao ovaj računar.')))
        : h('ol.phone__steps', {},
          h('li', {}, tr('Na telefonu uključi Tailscale aplikaciju, prijavljenu na isti nalog kao ovaj računar.')),
          h('li', {}, tr('Skeniraj kod kamerom i dodirni link.')),
          h('li', {}, tr('Radi bilo gdje: kod kuće, na poslu ili na mobilnim podacima. Računar mora ostati upaljen.'))));
      parts.push(h('p.phone__url', {}, cur.url));
    } else if (tab === 'tailscale') {
      parts.push(h('p', {}, st.tailscale.running ? tr('Tailscale radi, ali računar još nema adresu u mreži. Pokušaj ponovo za par sekundi.')
        : tr('Tailscale nije pokrenut na ovom računaru. Pokreni Tailscale aplikaciju (ikonica gore u traci menija) pa pokušaj ponovo.')),
      h('p.muted', {}, tr('Tailscale je besplatan za lične uređaje: '), h('a', { href: 'https://tailscale.com/download', target: '_blank', rel: 'noopener' }, 'tailscale.com/download')));
    } else {
      parts.push(h('p', {}, tr('Računar nije spojen ni na jednu mrežu. Spoji se na Wi-Fi pa pokušaj ponovo.')));
    }
    parts.push(h('p.muted.phone__note', {}, tr('Ako macOS pita da li „node” smije primati veze, klikni Allow.')),
      h('div.dlg__actions', {},
        h('button.btn.btn--ghost', { type: 'button', onclick: () => toggle(false) }, tr('Isključi pristup')),
        h('button.btn', { type: 'button', onclick: () => api('/api/phone').then((x) => render(x)) }, icon('refresh', 16), tr('Osvježi')),
        h('button.btn.btn--primary', { type: 'button', onclick: () => dlg.close() }, tr('Gotovo'))));
    body.replaceChildren(...parts);
  };
  const toggle = async (on) => {
    body.replaceChildren(head(), loading());
    try {
      const st = await api('/api/phone', { method: 'POST', body: { enabled: on } });
      render(st);
      if (!on) toast(tr('Pristup sa telefona je isključen. Stari link više ne radi.'));
    } catch (e) { render({ enabled: false }, e.message); }
  };
  body.append(head(), loading());
  try {
    const st = await api('/api/phone');
    // Jedan klik: ako je isključeno, odmah uključi i pokaži QR kod.
    if (!st.enabled) await toggle(true); else render(st);
  } catch (e) { render({ enabled: false }, e.message); }
}
document.addEventListener('open-phone', openPhone);

function loading() {
  return h('p.loading', { role: 'status' }, h('span.loading__dot'), tr('Učitavam…'));
}

// ============================================================ nastavak na drugom uređaju
const DEVICE_ID = (() => {
  let id = null;
  try { id = localStorage.getItem('sl.device'); } catch { /* */ }
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('sl.device', id); } catch { /* */ }
  }
  return id;
})();
const DEVICE_NAME = player.mobile ? tr('Mobitel') : tr('Računar');
let activeHere = false;   // da li je na ovom uređaju puštano u ovoj sesiji
let lastReport = 0;
let remote = null;        // šta svira na drugom uređaju
let dismissedFor = null;

function reportSession(force = false) {
  const t = player.track;
  if (!t || !activeHere) return;
  const now = Date.now();
  if (!force && now - lastReport < 5000) return;
  lastReport = now;
  const start = Math.max(0, player.index - 20);
  api('/api/session', { method: 'POST', body: {
    deviceId: DEVICE_ID, device: DEVICE_NAME, track: t, time: player.track.live ? 0 : player.time,
    playing: player.playing, index: player.index - start, queue: player.queue.slice(start, start + 500), context: player.context,
  } }).catch(() => {});
}

const handoff = h('div.handoff', { hidden: true, role: 'region', 'aria-label': tr('Nastavi slušanje') });
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
  const when = r.track.live ? tr('uživo') : fmtTime(remoteTime());
  handoff.replaceChildren(
    cover(r.track.cover, r.track.title, 'handoff__cv'),
    h('div.handoff__text', {},
      h('span.handoff__label', {}, r.playing ? tr('Svira na uređaju: {d}', { d: r.device }) : tr('Pauzirano na uređaju: {d}', { d: r.device })),
      h('span.handoff__title', {}, h('span.handoff__name', {}, r.track.title), h('span.handoff__time', {}, when))),
    h('button.btn.btn--primary', { type: 'button', onclick: takeOver }, icon('play', 16), tr('Nastavi ovdje')),
    iconBtn('close', tr('Sakrij'), () => { dismissedFor = r.track.id + r.deviceId; renderHandoff(); }, { size: 18 }));
}

async function takeOver() {
  try {
    const { session } = await api('/api/session');
    if (!session) return;
    remote = session;
    const time = remoteTime();
    player.resumeAt(session.queue, session.index, time, session.context);
    activeHere = true;
    api('/api/session/takeover', { method: 'POST', body: { deviceId: DEVICE_ID, device: DEVICE_NAME } }).catch(() => {});
    handoff.hidden = true;
    toast(session.track.live ? tr('Nastavljeno ovdje') : tr('Nastavljeno ovdje od {t}', { t: fmtTime(time) }));
  } catch (e) { toast(e.message, { error: true }); }
}

player.addEventListener('state', () => {
  if (player.playing && !activeHere) activeHere = true;
  reportSession(true);
  renderHandoff();
});
player.addEventListener('track', () => reportSession(true));
player.addEventListener('time', () => reportSession(false));
setInterval(() => { if (!handoff.hidden) renderHandoff(); }, 1000);
new ResizeObserver(() => document.documentElement.style.setProperty('--deck-h', deck.offsetHeight + 'px')).observe(deck);

// ============================================================ prečice
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (!eqBox.hidden) { toggleEq(false); return; }
    if (!now.hidden) { closeNow(); return; }
    if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); return; }
    if (typing) e.target.blur();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); go('#/pretraga'); }
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
    q: () => togglePanel('red'),
    t: () => togglePanel('tekst'),
    e: () => toggleEq(),
    f: () => (now.hidden ? openNow() : closeNow()),
    '/': () => go('#/pretraga'),
  }[k.length === 1 ? k.toLowerCase() : k];
  if (handled && handled() !== false) e.preventDefault();
});

// ============================================================ događaji
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
    if (d.changed) toast(tr('Biblioteka je osvježena: {n}', { n: songs(d.count) }));
  });
  es.addEventListener('icy', (e) => { const d = JSON.parse(e.data); player.setIcy(d.sid, d.title); });
  es.addEventListener('session', (e) => { remote = JSON.parse(e.data); renderHandoff(); });
  es.addEventListener('takeover', (e) => {
    const d = JSON.parse(e.data);
    if (d.deviceId === DEVICE_ID) return;
    if (player.playing) {
      player.pause();
      toast(tr('Muzika se nastavlja na uređaju: {d}', { d: d.device }));
    }
  });
}

// Mobilni meni
$('navToggle').append(icon('menu', 22));
$('topSearch').append(icon('search', 20));
$('navToggle').addEventListener('click', () => {
  const open = !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', open);
  $('navToggle').setAttribute('aria-expanded', String(open));
});

// ============================================================ start
async function boot() {
  // Tekstovi iz index.html
  document.querySelector('.skip').textContent = tr('Preskoči na sadržaj');
  $('navToggle').setAttribute('aria-label', tr('Meni'));
  $('topSearch').setAttribute('aria-label', tr('Pretraga'));
  $('side').setAttribute('aria-label', tr('Glavni meni'));
  $('panel').setAttribute('aria-label', tr('Bočni panel'));
  $('deck').setAttribute('aria-label', tr('Player'));
  $('now').setAttribute('aria-label', tr('Sada svira'));
  $('eq').setAttribute('aria-label', tr('Ekvalizer'));
  buildDeck();
  updateTrack(); updateState(); updateMode(); updateVolume(); updateSleep();
  try { await store.load(); }
  catch (e) { toast(tr('Server ne odgovara. Da li je Tunes pokrenuta?'), { error: true, timeout: 10000 }); }
  renderNav();
  render();
  updateTrack();
  connectEvents();
  api('/api/session').then(({ session }) => { remote = session; renderHandoff(); }).catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();

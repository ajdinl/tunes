// Lyrics from LRCLIB. Synced lyrics follow the track line by line,
// and clicking a line seeks to that point.
import { h, tr } from './ui.js';
import { api } from './store.js';
import { player } from './player.js';

const cache = new Map();

function parseLrc(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of times) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

export async function getLyrics(t) {
  if (!t || t.live) return null;
  if (cache.has(t.id)) return cache.get(t.id);
  const p = new URLSearchParams({ artist: t.artist || '', title: t.title, album: t.album || '', duration: String(t.duration || '') });
  const r = await api('/api/lyrics?' + p);
  const out = r.found ? { synced: r.synced ? parseLrc(r.synced) : null, plain: r.plain, instrumental: r.instrumental } : null;
  cache.set(t.id, out);
  return out;
}

// Builds a lyrics view that refreshes itself when the track changes.
export function lyricsView({ big = false } = {}) {
  const root = h('div.lyr', { class: big ? 'lyr--big' : '' });
  let lines = [];
  let nodes = [];
  let current = -1;
  let userScrollUntil = 0;
  let token = 0;

  root.addEventListener('wheel', () => { userScrollUntil = Date.now() + 4000; }, { passive: true });
  root.addEventListener('touchmove', () => { userScrollUntil = Date.now() + 4000; }, { passive: true });

  async function load() {
    const t = player.track;
    const my = ++token;
    lines = []; nodes = []; current = -1;
    root.replaceChildren();
    if (!t) { root.append(h('p.lyr__msg', {}, tr('Play a song and its lyrics will appear here.'))); return; }
    if (t.live) { root.append(h('p.lyr__msg', {}, tr('Radio stations have no lyrics. The song playing live is shown on the dial.'))); return; }
    root.append(h('p.lyr__msg', {}, tr('Looking for lyrics…')));
    let data = null;
    try { data = await getLyrics(t); } catch { data = undefined; }
    if (my !== token) return;
    root.replaceChildren();
    if (data === undefined) { root.append(h('p.lyr__msg', {}, tr('LRCLIB isn\'t responding. Try again in a few minutes.'))); return; }
    if (!data) { root.append(h('p.lyr__msg', {}, tr('No lyrics for “{title}” in LRCLIB.', { title: t.title }))); return; }
    if (data.instrumental) { root.append(h('p.lyr__msg', {}, tr('Instrumental: this song has no lyrics.'))); return; }
    if (data.synced?.length) {
      lines = data.synced;
      nodes = lines.map((l) => h('button.lyr__line', { type: 'button', onclick: () => { player.seek(l.t); userScrollUntil = 0; } }, l.text || '♪'));
      root.append(...nodes);
      sync();
    } else if (data.plain) {
      root.append(...data.plain.split('\n').map((l) => h('p.lyr__plain', {}, l || ' ')));
    }
  }

  function sync() {
    if (!lines.length) return;
    const t = player.time + 0.25;
    let i = lines.length - 1;
    while (i >= 0 && lines[i].t > t) i--;
    if (i === current) return;
    nodes[current]?.classList.remove('is-on');
    current = i;
    const n = nodes[i];
    if (!n) return;
    n.classList.add('is-on');
    nodes.forEach((x, k) => x.classList.toggle('is-past', k < i));
    if (Date.now() > userScrollUntil && root.offsetParent) {
      root.scrollTo({ top: n.offsetTop - root.clientHeight * 0.38, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  player.addEventListener('track', load);
  player.addEventListener('time', sync);
  load();
  return root;
}

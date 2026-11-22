// Male pomoćne funkcije za pravljenje interfejsa bez frameworka.
import { tr, plural, locale } from './i18n.js';

export { tr, plural };

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// ---------------------------------------------------------------- ikone
const P = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5l10 7-10 7z" fill="currentColor" stroke="none"/><path d="M18.5 5v14"/>',
  prev: '<path d="M19 5L9 12l10 7z" fill="currentColor" stroke="none"/><path d="M5.5 5v14"/>',
  shuffle: '<path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.7 0 3-1.4 4.1-3.2M13.4 10.2C14.5 8.4 15.8 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  repeat: '<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M17 4l3 3-3 3M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H4M7 20l-3-3 3-3"/>',
  repeat1: '<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M17 4l3 3-3 3M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H4M7 20l-3-3 3-3"/><path d="M11 10.5l1.5-1v5" stroke-width="1.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  heartFill: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" fill="currentColor"/>',
  queue: '<path d="M4 6h16M4 11h10M4 16h7M17 13v7l4-3.5z"/>',
  lyrics: '<path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/><path d="M8.5 9h7M8.5 12h4.5"/>',
  eq: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor"/><rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  volumeLow: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5M6 9.5V19h4.5v-5h3v5H18V9.5"/>',
  artist: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
  album: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/>',
  song: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9M12 8v4.5l3 2"/>',
  radio: '<rect x="3.5" y="8" width="17" height="11.5" rx="2"/><path d="M7 8l9.5-4"/><circle cx="15.5" cy="13.75" r="2.5"/><path d="M6.5 12h3M6.5 15.5h3"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  external: '<path d="M13 5h6v6M19 5l-8 8M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  collapse: '<path d="M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  grip: '<circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/><circle cx="15" cy="17" r="1.2" fill="currentColor"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18h3"/>',
  live: '<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8M5.2 5.2a9.5 9.5 0 0 0 0 13.6M18.8 5.2a9.5 9.5 0 0 1 0 13.6"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export function iconBtn(name, label, onClick, { size = 20, ...extra } = {}) {
  return h('button.ibtn', { type: 'button', title: label, 'aria-label': label, onclick: onClick, ...extra }, icon(name, size));
}

// ---------------------------------------------------------------- formatiranje
export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '–:––';
  s = Math.floor(s);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(total) {
  const m = Math.round(total / 60);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  return `${hh} h ${m % 60} min`;
}

export const songs = (n) => plural(n, ['pjesma', 'pjesme', 'pjesama'], ['song', 'songs']);

export function relDay(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (diff === 0) return tr('Danas');
  if (diff === 1) return tr('Jučer');
  if (diff < 7) return d.toLocaleDateString(locale(), { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// Set ili miks: dugi snimci (20+ min) ili naslovi tipa "DJ set", "mixtape", "Boiler Room".
const SET_WORDS = /\b(dj|live|full|mix|guest)[\s-]?set\b|\bset\s?#?\d|\bmixtape\b|\bmegamix\b|\bboiler room\b|\bessential mix\b|\bb2b\b|\bpodcast\b|\bepisode\b|\bradio show\b|\bcontinuous mix\b/i;
const TRACK_MIX = /\b(original|extended|radio|club|dub|vip|instrumental|edit|re|remix)[\s-]?mix\b/i;
export function isSet(x) {
  if (!x || x.live) return false;
  const d = x.duration || 0;
  if (d >= 20 * 60) return true;
  if (SET_WORDS.test(x.title || '')) return d === 0 || d >= 6 * 60;
  return /\bmix\b/i.test(x.title || '') && !TRACK_MIX.test(x.title || '') && d >= 10 * 60;
}

export const SOURCES = {
  local: { name: tr('Na računaru'), short: tr('Lokalno') },
  audius: { name: 'Audius', short: 'Audius' },
  archive: { name: 'Internet Archive', short: 'Archive' },
  radio: { name: 'Radio', short: 'Radio' },
  jamendo: { name: 'Jamendo', short: 'Jamendo' },
};

export function sourceTag(src) {
  const s = SOURCES[src] || { short: src };
  return h('span.src', { class: 'src--' + src, title: s.name }, s.short);
}

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'dj').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function shuffleArray(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------- omot
export function cover(src, label = '', cls = '') {
  const box = h('div.cv', { class: cls });
  const initial = (label || '?').trim().charAt(0).toUpperCase();
  const empty = () => { box.classList.add('cv--empty'); box.dataset.initial = initial; };
  if (src) {
    const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.remove(); empty(); }, { once: true });
    box.append(img);
  } else empty();
  return box;
}

// ---------------------------------------------------------------- obaveštenja
export function toast(msg, { action, onAction, error = false, timeout = 3500 } = {}) {
  const box = document.getElementById('toasts');
  const t = h('div.toast', { class: error ? 'toast--error' : '', role: error ? 'alert' : 'status' }, h('span', {}, msg));
  if (action) t.append(h('button.toast__act', { type: 'button', onclick: () => { onAction?.(); t.remove(); } }, action));
  box.append(t);
  setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 250); }, timeout);
}

// ---------------------------------------------------------------- kontekstni meni
let menuEl = null;
export function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

export function openMenu(x, y, items) {
  closeMenu();
  const prevFocus = document.activeElement;
  const build = (list) => h('div.menu', { role: 'menu' }, list.filter(Boolean).map((it) => {
    if (it === '-') return h('div.menu__sep', { role: 'separator' });
    if (it.items) {
      const sub = h('div.menu__item.menu__item--sub', { role: 'menuitem', tabindex: '-1', 'aria-haspopup': 'true' }, it.label);
      const subMenu = build(it.items);
      subMenu.classList.add('menu--sub');
      sub.append(subMenu);
      sub.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') { sub.classList.add('is-open'); subMenu.querySelector('.menu__item')?.focus(); e.stopPropagation(); } });
      return sub;
    }
    return h('button.menu__item', {
      type: 'button', role: 'menuitem', tabindex: '-1', disabled: it.disabled,
      onclick: (e) => { e.stopPropagation(); closeMenu(); prevFocus?.focus?.(); it.action(); },
    }, it.icon ? icon(it.icon, 16) : null, it.label);
  }));
  menuEl = build(items);
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menuEl.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menuEl.querySelector('.menu__item')?.focus();
  menuEl.addEventListener('keydown', (e) => {
    const items = [...menuEl.querySelectorAll(':scope .menu__item')].filter((n) => n.offsetParent);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { items[(i + 1) % items.length]?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length]?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { document.activeElement.closest('.menu--sub')?.parentElement.focus(); e.preventDefault(); }
    if (e.key === 'Escape') { closeMenu(); prevFocus?.focus?.(); }
  });
}

document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ---------------------------------------------------------------- dijalog za unos
export function ask(title, { value = '', placeholder = '', confirm = tr('Sačuvaj'), danger = false, input = true } = {}) {
  return new Promise((resolve) => {
    const field = input ? h('input.field', { type: 'text', value, placeholder, 'aria-label': title }) : null;
    const dlg = h('dialog.dlg', {},
      h('form.dlg__body', { method: 'dialog' },
        h('h2.dlg__title', {}, title),
        field,
        h('div.dlg__actions', {},
          h('button.btn.btn--ghost', { type: 'button', onclick: () => dlg.close('') }, tr('Otkaži')),
          h('button.btn', { class: danger ? 'btn--danger' : 'btn--primary', value: 'ok' }, confirm))));
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      dlg.remove();
      resolve(ok ? (input ? field.value.trim() : true) : null);
    });
    document.body.append(dlg);
    dlg.showModal();
    field?.select();
  });
}

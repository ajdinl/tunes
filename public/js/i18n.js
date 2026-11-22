// Interface language: English (default) or Bosnian.
// Strings in the code are English; tr() translates them when Bosnian is selected.
import { BS } from './i18n-bs.js';

const KEY = 'tunes.lang';

function detect() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved === 'en' || saved === 'bs') return saved;
  } catch { /* no saved choice */ }
  // First visit: Bosnian for bs/hr/sr/sh browsers, English for everyone else.
  return /^(bs|hr|sr|sh)\b/i.test(navigator.language || '') ? 'bs' : 'en';
}

export let lang = detect();

document.documentElement.lang = lang;

// Switches language in place; the app re-renders and playback keeps going.
export function setLang(l) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage full or blocked */ }
  document.documentElement.lang = l;
  window.dispatchEvent(new CustomEvent('langchange', { detail: l }));
}

export function tr(text, vars) {
  let out = lang === 'bs' && Object.hasOwn(BS, text) ? BS[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

// If the browser has no Bosnian number/date format, Croatian uses the same rules.
export const locale = () => (lang === 'en' ? 'en-GB' : ['bs-BA', 'hr-HR']);

// Plurals: Bosnian has three forms (1 pjesma, 2 pjesme, 5 pjesama), English two.
export function plural(n, bs, en) {
  const num = n.toLocaleString(locale());
  if (lang === 'en') return `${num} ${n === 1 ? en[0] : en[1]}`;
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? bs[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? bs[1] : bs[2];
  return `${num} ${w}`;
}

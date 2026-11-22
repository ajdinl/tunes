// Jezik interfejsa: bosanski (osnovni) ili engleski.
// Tekstovi u kodu su na bosanskom; t() ih prevodi kad je odabran engleski.
import { EN } from './i18n-en.js';

const KEY = 'sl.lang';

export const lang = (() => {
  try { return JSON.parse(localStorage.getItem(KEY)) === 'en' ? 'en' : 'bs'; } catch { return 'bs'; }
})();

document.documentElement.lang = lang === 'en' ? 'en' : 'bs';

export function setLang(l) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* */ }
  location.reload();
}

export function tr(text, vars) {
  let out = lang === 'en' && Object.hasOwn(EN, text) ? EN[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

// Ako browser nema bosanski format, hrvatski ima ista pravila (24.007, 22. novembra).
export const locale = () => (lang === 'en' ? 'en-GB' : ['bs-BA', 'hr-HR']);

// Množina: bosanski ima tri oblika (1 pjesma, 2 pjesme, 5 pjesama), engleski dva.
export function plural(n, bs, en) {
  const num = n.toLocaleString(locale());
  if (lang === 'en') return `${num} ${n === 1 ? en[0] : en[1]}`;
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? bs[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? bs[1] : bs[2];
  return `${num} ${w}`;
}

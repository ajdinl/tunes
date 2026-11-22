// Interface language. Strings in the code are English; tr() looks them up in the
// dictionary of the chosen language (public/js/i18n-<code>.js) and falls back to English.
// Dictionaries load on demand, so only the language in use is downloaded.

const KEY = 'tunes.lang';

// Order shown in Settings. name: in English (translated with tr()), native: in the language itself.
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧', locale: 'en-GB' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski', flag: '🇧🇦', locale: ['bs-BA', 'hr-HR'] },
  { code: 'sr', name: 'Serbian', native: 'Srpski', flag: '🇷🇸', locale: ['sr-Latn-RS', 'hr-HR'] },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', flag: '🇭🇷', locale: 'hr-HR' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪', locale: 'de-DE' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷', locale: 'tr-TR' },
];
const CODES = LANGUAGES.map((l) => l.code);

function detect() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (CODES.includes(saved)) return saved;
  } catch { /* no saved choice */ }
  // First visit: follow the browser language; Serbo-Croatian browsers get Bosnian.
  for (const pref of navigator.languages || [navigator.language || '']) {
    const code = String(pref).toLowerCase().split('-')[0];
    if (CODES.includes(code)) return code;
    if (code === 'sh') return 'bs';
  }
  return 'en';
}

async function loadDict(code) {
  if (code === 'en') return null;
  const mod = await import(`./i18n-${code}.js`);
  return Object.values(mod)[0];
}

export let lang = detect();
let dict = null;
try { dict = await loadDict(lang); } catch { lang = 'en'; dict = null; }
let rules = new Intl.PluralRules(locale());

document.documentElement.lang = lang;

// Switches language in place; the app re-renders and playback keeps going.
export async function setLang(code) {
  if (code === lang || !CODES.includes(code)) return;
  const next = await loadDict(code);
  lang = code;
  dict = next;
  rules = new Intl.PluralRules(locale());
  try { localStorage.setItem(KEY, JSON.stringify(code)); } catch { /* storage full or blocked */ }
  document.documentElement.lang = code;
  window.dispatchEvent(new CustomEvent('langchange', { detail: code }));
}

export function tr(text, vars) {
  let out = dict && typeof dict[text] === 'string' && Object.hasOwn(dict, text) ? dict[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

// Number and date format of the current language (with a fallback when the browser lacks it).
export function locale() {
  return LANGUAGES.find((l) => l.code === lang)?.locale || 'en-GB';
}

// "3 songs". Dictionaries hold the forms under "plural:<singular>", keyed by the
// Intl.PluralRules category of the language: { one, few, other } in Bosnian, { one, other } in German.
export function plural(n, one, many) {
  const num = n.toLocaleString(locale());
  const forms = dict?.['plural:' + one];
  if (!forms || typeof forms !== 'object') return `${num} ${n === 1 ? one : many}`;
  const cat = rules.select(n);
  return `${num} ${forms[cat] ?? forms.other ?? (n === 1 ? one : many)}`;
}

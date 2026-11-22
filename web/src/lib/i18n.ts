// Interface language. Strings in the code are English; tr() looks them up in the
// dictionary of the chosen language and falls back to English. Dictionaries load on
// demand, so only the language in use is downloaded.
import { useSyncExternalStore } from 'react';

type Forms = Partial<Record<Intl.LDMLPluralRule, string>>;
type Dict = Record<string, string | Forms>;

const KEY = 'tunes.lang';

// Order shown in Settings. name: in English (translated with tr()), native: in the language itself.
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧', locale: 'en-GB' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski', flag: '🇧🇦', locale: ['bs-BA', 'hr-HR'] },
  { code: 'sr', name: 'Serbian', native: 'Srpski', flag: '🇷🇸', locale: ['sr-Latn-RS', 'hr-HR'] },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', flag: '🇭🇷', locale: 'hr-HR' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪', locale: 'de-DE' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷', locale: 'tr-TR' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];
const CODES: readonly string[] = LANGUAGES.map((l) => l.code);

// One file per language; each is loaded only when that language is picked.
const LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {
  bs: () => import('../i18n/bs.ts'),
  sr: () => import('../i18n/sr.ts'),
  hr: () => import('../i18n/hr.ts'),
  de: () => import('../i18n/de.ts'),
  tr: () => import('../i18n/tr.ts'),
};

// English until the user picks a language in Settings (the browser language is not used).
function detect(): LangCode {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (CODES.includes(saved)) return saved;
  } catch { /* no saved choice */ }
  return 'en';
}

async function loadDict(code: string): Promise<Dict | null> {
  if (code === 'en') return null;
  const mod = await LOADERS[code]();
  return Object.values(mod)[0] as Dict;
}

export let lang: LangCode = detect();
let dict: Dict | null = null;
let rules: Intl.PluralRules;

// Loads the saved language before the first render.
export async function initLang(): Promise<void> {
  try { dict = await loadDict(lang); } catch { lang = 'en'; dict = null; }
  rules = new Intl.PluralRules(locale());
  document.documentElement.lang = lang;
}

const listeners = new Set<() => void>();

// Switches language in place; the app re-renders and playback keeps going.
export async function setLang(code: string): Promise<void> {
  if (code === lang || !CODES.includes(code)) return;
  const next = await loadDict(code);
  lang = code as LangCode;
  dict = next;
  rules = new Intl.PluralRules(locale());
  try { localStorage.setItem(KEY, JSON.stringify(code)); } catch { /* storage full or blocked */ }
  document.documentElement.lang = code;
  for (const l of listeners) l();
  window.dispatchEvent(new CustomEvent('langchange', { detail: code }));
}

// Re-renders the component when the language changes.
export function useLang(): LangCode {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang);
}

export function tr(text: string, vars?: Record<string, string | number>): string {
  const found = dict && Object.hasOwn(dict, text) ? dict[text] : undefined;
  let out = typeof found === 'string' ? found : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
  return out;
}

// Number and date format of the current language (with a fallback when the browser lacks it).
export function locale(): string | string[] {
  const l = LANGUAGES.find((x) => x.code === lang)?.locale || 'en-GB';
  return typeof l === 'string' ? l : [...l];
}

// "3 songs". Dictionaries hold the forms under "plural:<singular>", keyed by the
// Intl.PluralRules category of the language: { one, few, other } in Bosnian, { one, other } in German.
export function plural(n: number, one: string, many: string): string {
  const num = n.toLocaleString(locale());
  const forms = dict?.['plural:' + one];
  if (!forms || typeof forms !== 'object') return `${num} ${n === 1 ? one : many}`;
  const cat = rules.select(n);
  return `${num} ${forms[cat] ?? forms.other ?? (n === 1 ? one : many)}`;
}

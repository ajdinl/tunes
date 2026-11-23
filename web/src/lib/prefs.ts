// Appearance choices that follow the user to every browser and device: theme, language,
// player style and where the player buttons sit. They live on the server (settings.prefs),
// arrive with the state on load and over the event stream when another device changes them,
// and are also kept in localStorage, so a page starts with them before the server answers.
// Layout details of one screen (folded menu, compact menu items) and the offline buffer stay
// per device.
import { useSyncExternalStore } from 'react';

import type { Prefs } from '../../../lib/types.ts';
import { setLang, lang } from './i18n.ts';
import { DEVICE_STYLES, DIAL_PREF, STYLE_KEY, getDialStyle, setDialStyle } from './dial.ts';
import type { DialStyle } from './dial.ts';
import { api, store } from './store.ts';
import { shell, DECK_CTRLS } from '../shell/ui.ts';
import type { DeckCtrls } from '../shell/ui.ts';

export type { Prefs };
type Key = keyof Prefs;

const THEME_COLOR: Record<string, string> = { black: '#000000', light: '#f4f4f6', indigo: '#1c1f3a' };
const THEMES = Object.keys(THEME_COLOR);

const themeListeners = new Set<() => void>();
export function setTheme(t: string): void {
  if (!THEMES.includes(t)) return;
  document.documentElement.dataset.theme = t;
  document.querySelector<HTMLMetaElement>('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[t]);
  try { localStorage.setItem('tunes.theme', JSON.stringify(t)); } catch { /* storage full or blocked */ }
  for (const l of themeListeners) l();
}
export function useTheme(): string {
  return useSyncExternalStore((cb) => { themeListeners.add(cb); return () => themeListeners.delete(cb); }, () => document.documentElement.dataset.theme || 'black');
}

// The choices this device has, and where each is kept in localStorage. The player style is
// `dialStyle` on computers and `dialStylePhone` on phones.
const STORED: Partial<Record<Key, string>> = { theme: 'tunes.theme', lang: 'tunes.lang', [DIAL_PREF]: STYLE_KEY, deckCtrls: 'tunes.deckCtrls' };
const current = (): Prefs => ({
  theme: document.documentElement.dataset.theme || 'black',
  lang,
  [DIAL_PREF]: getDialStyle(),
  deckCtrls: shell.get().deckCtrls,
});

// Takes over choices made on another device (or saved earlier). Nothing is sent back.
export async function applyPrefs(p: Prefs | null | undefined): Promise<void> {
  if (!p) return;
  if (p.theme && p.theme !== current().theme) setTheme(p.theme);
  const style = p[DIAL_PREF];
  if (style && DEVICE_STYLES.includes(style as DialStyle)) setDialStyle(style as DialStyle);
  if (p.deckCtrls && DECK_CTRLS.includes(p.deckCtrls as DeckCtrls) && p.deckCtrls !== shell.get().deckCtrls) shell.set({ deckCtrls: p.deckCtrls as DeckCtrls });
  if (p.lang && p.lang !== lang) await setLang(p.lang);
}

// A choice made here: remembered on the server for the other browsers and devices.
export function savePref<K extends Key>(key: K, value: NonNullable<Prefs[K]>): void {
  store.settings = { ...store.settings, prefs: { ...(store.settings.prefs || {}), [key]: value } };
  api('/api/settings', { method: 'PUT', body: { prefs: { [key]: value } } }).catch(() => { /* offline: kept on this device */ });
}

// After the state has loaded: the server's choices win; choices this browser made before
// syncing existed (still only in localStorage) are sent up once if the server has none.
export async function syncPrefs(): Promise<void> {
  const server = store.settings.prefs || {};
  const now = current();
  const up: Prefs = {};
  for (const [key, storageKey] of Object.entries(STORED) as [Key, string][]) {
    let mine: string | null = null;
    try { mine = localStorage.getItem(storageKey); } catch { /* blocked */ }
    if (!server[key] && mine && now[key]) up[key] = now[key];
  }
  await applyPrefs(server);
  if (Object.keys(up).length) {
    store.settings = { ...store.settings, prefs: { ...server, ...up } };
    api('/api/settings', { method: 'PUT', body: { prefs: up } }).catch(() => { /* */ });
  }
}

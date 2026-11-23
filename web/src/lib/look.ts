// Appearance choices beyond the theme (Settings → Appearance, Music sources, Home screen):
//   accent  the color of buttons, the progress line and the spectrum: a preset, a custom color,
//           or "cover" (taken from the cover of the song that plays)       synced
//   nowBg   background of the full-screen Now Playing: blurred cover, cover colors, plain  synced
//   hide    online sources left out of the menu, Search, Discover and Home                 synced
//   home    order of the Home sections, and which are hidden                               synced
//   text    text size, and density of song lists                               this device only
// Synced ones go through prefs.ts (server + other devices); every choice is also kept in
// localStorage, so a page starts with it before the server answers.
import { useSyncExternalStore } from 'react';

import { ACCENTS, HIDEABLE_SOURCES, HOME_SECTIONS } from '../../../lib/data.ts';
import { coverColor, fitTo, hexRgb, hoverFor, inkFor, rgbHex } from './color.ts';
import type { RGB } from './color.ts';
import { media } from './media.ts';
import { player } from './player.ts';

export { ACCENTS, HIDEABLE_SOURCES, HOME_SECTIONS };
export const NOW_BGS = ['cover', 'color', 'plain'] as const;
export const TEXT_SIZES = ['small', 'normal', 'large'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;
export type NowBg = (typeof NOW_BGS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Density = (typeof DENSITIES)[number];
export interface HomeSection { key: string; on: boolean }

// Each preset in a shade for the dark themes and a darker one for the light theme.
export const PRESETS: Record<string, { dark: string; light: string }> = {
  amber: { dark: '#ffb547', light: '#c26d00' },
  coral: { dark: '#ff7a66', light: '#d2412e' },
  pink: { dark: '#ff7eb6', light: '#c7337a' },
  violet: { dark: '#b592ff', light: '#7448d6' },
  blue: { dark: '#62a8ff', light: '#2563d9' },
  teal: { dark: '#40d3c8', light: '#0a8076' },
  green: { dark: '#7fdc8e', light: '#2b8a3e' },
  lime: { dark: '#d4e157', light: '#6f7d00' },
};
const BACKGROUND: Record<string, RGB> = { black: [0, 0, 0], indigo: [28, 31, 58], light: [255, 255, 255] };

export interface Look {
  accent: string;
  nowBg: NowBg;
  hide: string[];
  home: HomeSection[];
  text: TextSize;
  density: Density;
}

const read = <T,>(key: string, ok: (v: unknown) => boolean, fallback: T): T => {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return ok(v) ? v as T : fallback; } catch { return fallback; }
};
const write = (key: string, v: unknown): void => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const validAccent = (v: unknown): v is string => typeof v === 'string' && (ACCENTS.includes(v) || v === 'cover' || /^#[0-9a-f]{6}$/.test(v));
const validNowBg = (v: unknown) => NOW_BGS.includes(v as NowBg);

// "radio,-recent" style strings (as stored) ⇄ lists.
export const parseHide = (v: string): string[] => v.split(',').filter((s) => HIDEABLE_SOURCES.includes(s));
export function parseHome(v: string): HomeSection[] {
  const out: HomeSection[] = [];
  for (const part of v.split(',')) {
    const key = part.replace(/^-/, '');
    if (HOME_SECTIONS.includes(key) && !out.some((s) => s.key === key)) out.push({ key, on: !part.startsWith('-') });
  }
  for (const key of HOME_SECTIONS) if (!out.some((s) => s.key === key)) out.push({ key, on: true }); // added in a later version
  return out;
}
export const homeString = (list: HomeSection[]): string => list.map((s) => (s.on ? '' : '-') + s.key).join(',');

let look: Look = {
  accent: read('tunes.accent', validAccent, 'amber'),
  nowBg: read('tunes.nowBg', validNowBg, 'cover'),
  hide: parseHide(read('tunes.hide', (v) => typeof v === 'string', '')),
  home: parseHome(read('tunes.home', (v) => typeof v === 'string', '')),
  text: read('tunes.textSize', (v) => TEXT_SIZES.includes(v as TextSize), 'normal'),
  density: read('tunes.density', (v) => DENSITIES.includes(v as Density), 'comfortable'),
};
const listeners = new Set<() => void>();
let coverRgb: RGB | null = null;

export const getLook = (): Look => look;
export function useLook(): Look {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => look);
}
export const sourceOn = (s: string): boolean => !look.hide.includes(s);

function set(patch: Partial<Look>): void {
  look = { ...look, ...patch };
  if ('accent' in patch) write('tunes.accent', look.accent);
  if ('nowBg' in patch) write('tunes.nowBg', look.nowBg);
  if ('hide' in patch) write('tunes.hide', look.hide.join(','));
  if ('home' in patch) write('tunes.home', homeString(look.home));
  if ('text' in patch) write('tunes.textSize', look.text);
  if ('density' in patch) write('tunes.density', look.density);
  if ('accent' in patch || 'nowBg' in patch) followCover();
  paint();
  for (const l of listeners) l();
}

export function setAccent(v: string): void { if (validAccent(v) && v !== look.accent) set({ accent: v }); }
export function setNowBg(v: string): void { if (validNowBg(v) && v !== look.nowBg) set({ nowBg: v as NowBg }); }
export function setHidden(list: string[]): void { set({ hide: HIDEABLE_SOURCES.filter((s) => list.includes(s)) }); }
export function setHome(list: HomeSection[]): void { set({ home: parseHome(homeString(list)) }); }
export function setTextSize(v: TextSize): void { if (v !== look.text) set({ text: v }); }
export function setDensity(v: Density): void { if (v !== look.density) set({ density: v }); }

// The accent color for a theme (null: the theme's own amber from app.css).
export function accentFor(accent: string, theme: string): RGB | null {
  const light = theme === 'light';
  if (accent === 'cover') return coverRgb ? fitTo(coverRgb, BACKGROUND[theme] || BACKGROUND.black, light) : null;
  if (accent.startsWith('#')) return fitTo(hexRgb(accent), BACKGROUND[theme] || BACKGROUND.black, light);
  if (accent === 'amber' || !PRESETS[accent]) return null;
  return hexRgb(PRESETS[accent][light ? 'light' : 'dark']);
}

const VARS = ['--amber', '--amber-ink', '--amber-hover', '--amber-rgb'];
const rgbVar = (c: RGB) => c.map(Math.round).join(' ');

// Puts the choices on <html>: accent variables in its style, the rest as data attributes
// that app.css reads. Called again when the theme changes (the accent depends on it).
export function paint(): void {
  const root = document.documentElement;
  const s = root.style;
  const c = accentFor(look.accent, root.dataset.theme || 'black');
  if (c) {
    s.setProperty('--amber', rgbHex(c));
    s.setProperty('--amber-ink', rgbHex(inkFor(c)));
    s.setProperty('--amber-hover', rgbHex(hoverFor(c)));
    s.setProperty('--amber-rgb', rgbVar(c));
  } else for (const v of VARS) s.removeProperty(v);
  if (coverRgb) s.setProperty('--cover-rgb', rgbVar(coverRgb)); else s.removeProperty('--cover-rgb');
  root.dataset.nowbg = look.nowBg;
  if (look.text === 'normal') delete root.dataset.text; else root.dataset.text = look.text;
  if (look.density === 'compact') root.dataset.density = 'compact'; else delete root.dataset.density;
  for (const l of paintListeners) l();
}
// Things drawn outside CSS (the dial, the mini player window) redraw with the new colors.
const paintListeners = new Set<() => void>();
export function onPaint(fn: () => void): () => void { paintListeners.add(fn); return () => { paintListeners.delete(fn); }; }

// The cover color is only worked out when something uses it.
let coverToken = 0;
function followCover(): void {
  const my = ++coverToken;
  const url = look.accent === 'cover' || look.nowBg === 'color' ? media(player.track?.cover) : '';
  if (!url) { if (coverRgb) { coverRgb = null; paint(); } return; }
  coverColor(url).then((c) => {
    if (my !== coverToken) return;
    coverRgb = c;
    paint();
  });
}
player.addEventListener('track', followCover);

followCover();
paint();

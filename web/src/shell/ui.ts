// State of the app shell that several parts toggle: side panel, equalizer, now playing,
// the mobile menu, the folded sidebar, the SoundCloud dock and where the player buttons sit.
import { useSyncExternalStore } from 'react';

import { STANDALONE } from '../lib/env.ts';

// Where the player buttons sit on computers: above the dial, beside it (one row, the bar is
// lower), or only while the mouse is over the bar.
export const DECK_CTRLS = ['above', 'beside', 'hover'] as const;
export type DeckCtrls = (typeof DECK_CTRLS)[number];
const savedCtrls = (): DeckCtrls => {
  try { const v = JSON.parse(localStorage.getItem('tunes.deckCtrls') || 'null'); return DECK_CTRLS.includes(v) ? v : 'above'; } catch { return 'above'; }
};

export interface ShellState {
  panel: 'queue' | 'lyrics' | null;
  eq: boolean;
  now: boolean;
  nav: boolean;
  sideMini: boolean;
  footCompact: boolean;
  deckCtrls: DeckCtrls;
  scMin: boolean;
  phone: boolean;
  install: boolean;
}

const saved = (key: string): boolean => { try { return JSON.parse(localStorage.getItem(key) || 'false') === true; } catch { return false; } };

let state: ShellState = {
  panel: null, eq: false, now: false, nav: false,
  sideMini: saved('tunes.sideMini'), footCompact: saved('tunes.footCompact'), deckCtrls: savedCtrls(), scMin: saved('tunes.scdockMin'), phone: false, install: false,
};
const listeners = new Set<() => void>();

export const shell = {
  get: (): ShellState => state,
  set(patch: Partial<ShellState>): void {
    state = { ...state, ...patch };
    if ('sideMini' in patch) try { localStorage.setItem('tunes.sideMini', JSON.stringify(state.sideMini)); } catch { /* */ }
    if ('footCompact' in patch) try { localStorage.setItem('tunes.footCompact', JSON.stringify(state.footCompact)); } catch { /* */ }
    if ('deckCtrls' in patch) try { localStorage.setItem('tunes.deckCtrls', JSON.stringify(state.deckCtrls)); } catch { /* */ }
    if ('scMin' in patch) try { localStorage.setItem('tunes.scdockMin', JSON.stringify(state.scMin)); } catch { /* */ }
    for (const l of listeners) l();
  },
  togglePanel(tab: 'queue' | 'lyrics'): void { shell.set({ panel: state.panel === tab ? null : tab }); },
};

export function useShell(): ShellState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

// A real mouse: hover-only things make sense (not on phones, tablets or touch screens).
export const CAN_HOVER = matchMedia('(hover: hover) and (pointer: fine)').matches;

// Opened on the computer that runs the Tunes server (the phone-only version has none).
export const IS_LOCAL = !STANDALONE && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

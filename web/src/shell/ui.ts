// State of the app shell that several parts toggle: side panel, equalizer, now playing,
// the mobile menu, the folded sidebar and the SoundCloud dock.
import { useSyncExternalStore } from 'react';

export interface ShellState {
  panel: 'queue' | 'lyrics' | null;
  eq: boolean;
  now: boolean;
  nav: boolean;
  sideMini: boolean;
  scMin: boolean;
  phone: boolean;
  install: boolean;
}

const saved = (key: string): boolean => { try { return JSON.parse(localStorage.getItem(key) || 'false') === true; } catch { return false; } };

let state: ShellState = {
  panel: null, eq: false, now: false, nav: false,
  sideMini: saved('tunes.sideMini'), scMin: saved('tunes.scdockMin'), phone: false, install: false,
};
const listeners = new Set<() => void>();

export const shell = {
  get: (): ShellState => state,
  set(patch: Partial<ShellState>): void {
    state = { ...state, ...patch };
    if ('sideMini' in patch) try { localStorage.setItem('tunes.sideMini', JSON.stringify(state.sideMini)); } catch { /* */ }
    if ('scMin' in patch) try { localStorage.setItem('tunes.scdockMin', JSON.stringify(state.scMin)); } catch { /* */ }
    for (const l of listeners) l();
  },
  togglePanel(tab: 'queue' | 'lyrics'): void { shell.set({ panel: state.panel === tab ? null : tab }); },
};

export function useShell(): ShellState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

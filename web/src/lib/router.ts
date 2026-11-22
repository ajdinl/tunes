// Router on real paths (/settings, /album/…). Links are plain <a href="/…"> elements:
// one document-level click handler turns them into history navigation. Old addresses from
// the hash router (#/settings, and the Bosnian #/podesavanja) are redirected.
import { useSyncExternalStore } from 'react';

export interface Route {
  name: string;            // first path segment ('' for home)
  arg: string;             // the rest, still URL-encoded
  params: URLSearchParams;
  path: string;            // pathname + search
}

// Old Bosnian routes from earlier versions keep working.
const LEGACY: Record<string, string> = {
  pretraga: 'search', otkrij: 'discover', izvodjaci: 'artists', izvodjac: 'artist', albumi: 'albums',
  pesme: 'songs', omiljene: 'favorites', istorija: 'history', plejlista: 'playlist', pametna: 'smart', podesavanja: 'settings',
};

// '#/album/x' -> '/album/x' (links saved by older versions: queue context, other devices).
export function toPath(href: string): string {
  if (href.startsWith('#/')) return href.slice(1);
  if (href === '#' || href === '') return '/';
  return href;
}

function legacyFix(path: string): string {
  const m = /^\/([a-z]+)/.exec(path);
  return m && LEGACY[m[1]] ? '/' + LEGACY[m[1]] + path.slice(m[0].length) : path;
}

function parse(): Route {
  const [name = '', ...rest] = location.pathname.replace(/^\/+/, '').split('/');
  return { name, arg: rest.join('/'), params: new URLSearchParams(location.search), path: location.pathname + location.search };
}

let current = parse();
const listeners = new Set<() => void>();
function notify(): void {
  current = parse();
  for (const l of listeners) l();
}

// An old hash address in the bar (bookmark, home-screen shortcut, a link in an old message).
function redirectHash(): boolean {
  if (!location.hash.startsWith('#/')) return false;
  history.replaceState(history.state, '', legacyFix(toPath(location.hash)));
  return true;
}

export function initRouter(): void {
  redirectHash();
  const fixed = legacyFix(location.pathname);
  if (fixed !== location.pathname) history.replaceState(null, '', fixed + location.search);
  current = parse();
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', () => { if (redirectHash()) notify(); });
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (!(href.startsWith('/') || href.startsWith('#/')) || href.startsWith('//') || href.startsWith('/api/')) return;
    e.preventDefault();
    navigate(toPath(href));
  });
}

export function navigate(to: string, { replace = false } = {}): void {
  const path = legacyFix(toPath(to));
  if (path === location.pathname + location.search && !replace) { notify(); return; }
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  notify();
}

// Updates the address without re-rendering (search keeps the query in the URL while you type).
export function replaceUrl(path: string): void {
  history.replaceState(null, '', path);
}

export function useRoute(): Route {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
}

export const go = (to: string): void => navigate(to);

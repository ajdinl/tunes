// App shell: layout, routes, keyboard shortcuts and the pieces that float above everything.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ComponentType } from 'react';

import { Icon } from './components/Icon.tsx';
import { Toasts, ContextMenu, AskDialog } from './components/feedback.tsx';
import { Sidebar } from './shell/Sidebar.tsx';
import { Deck } from './shell/Deck.tsx';
import { Panel } from './shell/Panel.tsx';
import { Equalizer } from './shell/Equalizer.tsx';
import { NowPlaying, toggleNowQueue } from './shell/NowPlaying.tsx';
import { Handoff } from './shell/Handoff.tsx';
import { ScDock } from './shell/ScDock.tsx';
import { PhoneDialog, InstallDialog } from './shell/PhoneDialogs.tsx';
import { MiniPlayer } from './shell/MiniPlayer.tsx';
import { shell, useShell, CAN_HOVER, nowHasSide } from './shell/ui.ts';
import { player, usePlayer } from './lib/player.ts';
import { useStore } from './lib/store.ts';
import { tr, useLang } from './lib/i18n.ts';
import { useRoute, go } from './lib/router.ts';
import type { Route } from './lib/router.ts';
import { toggleFav } from './lib/actions.ts';

import { Home } from './views/Home.tsx';
import { Search } from './views/Search.tsx';
import { Discover } from './views/Discover.tsx';
import { Radio } from './views/Radio.tsx';
import { Artists } from './views/Artists.tsx';
import { Artist } from './views/Artist.tsx';
import { Albums } from './views/Albums.tsx';
import { Album } from './views/Album.tsx';
import { Songs } from './views/Songs.tsx';
import { Favorites } from './views/Favorites.tsx';
import { Downloads } from './views/Downloads.tsx';
import { History } from './views/History.tsx';
import { Playlist } from './views/Playlist.tsx';
import { Smart } from './views/Smart.tsx';
import { ArchiveItem } from './views/ArchiveItem.tsx';
import { Settings } from './views/Settings.tsx';
import { Shared } from './views/Shared.tsx';
import { ShareDialog } from './shell/ShareDialog.tsx';
import { AudiusArtist } from './views/AudiusArtist.tsx';

const ROUTES: Record<string, ComponentType<{ route: Route }>> = {
  '': Home, search: Search, discover: Discover, radio: Radio,
  artists: Artists, artist: Artist, albums: Albums, album: Album,
  songs: Songs, favorites: Favorites, downloads: Downloads, history: History,
  playlist: Playlist, smart: Smart, archive: ArchiveItem, settings: Settings, shared: Shared,
  audius: AudiusArtist,
};

export function App() {
  useLang(); // the whole app re-renders in the new language; the player keeps playing
  const ui = useShell();
  const playing = usePlayer('state').playing;

  // Body classes that app.css keys off.
  useEffect(() => {
    const b = document.body.classList;
    b.toggle('is-playing', playing);
    b.toggle('nav-open', ui.nav);
    b.toggle('has-panel', Boolean(ui.panel));
    b.toggle('now-open', ui.now);
    b.toggle('side-mini', ui.sideMini);
    b.toggle('deck-row', ui.deckCtrls === 'beside');
    b.toggle('deck-hover', ui.deckCtrls === 'hover' && CAN_HOVER);
  }, [playing, ui.nav, ui.panel, ui.now, ui.sideMini, ui.deckCtrls]);

  useShortcuts();

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{tr('Skip to content')}</a>
      <div className="app" id="app">
        <div className="topbar">
          <button type="button" className="ibtn" id="navToggle" aria-label={tr('Menu')} aria-expanded={ui.nav} aria-controls="side"
            onClick={() => shell.set({ nav: !ui.nav })}><Icon name="menu" size={22} /></button>
          <span className="brand brand--small">Tunes</span>
          <a className="ibtn" href="/search" id="topSearch" aria-label={tr('Search')}><Icon name="search" size={20} /></a>
        </div>
        <Sidebar />
        {/* Tapping anywhere outside the open menu closes it. */}
        <div className="scrim" id="navScrim" aria-hidden="true" onClick={() => shell.set({ nav: false })} />
        <Main />
        <Panel />
        <Deck />
      </div>
      <NowPlaying />
      <Equalizer />
      <Toasts />
      <Handoff />
      <ScDock />
      <ContextMenu />
      <AskDialog />
      <PhoneDialog />
      <InstallDialog />
      <ShareDialog />
      <MiniPlayer />
    </>
  );
}

function Main() {
  const route = useRoute();
  // Any change to the data re-renders the current screen (screens keep their own state).
  useStore('library', 'favorites', 'playlists', 'history', 'stations', 'settings');
  const main = useRef<HTMLElement>(null);
  const View = ROUTES[route.name] || Home;
  // A screen starts fresh when its address changes (e.g. the Discover tabs). Search rewrites
  // its query with replaceUrl(), which doesn't count as a change, so it keeps its state.
  const screen = route.name + '/' + route.arg + '?' + route.params.toString();

  // A new screen starts at the top with focus on its heading; the mobile menu closes.
  useLayoutEffect(() => {
    if (main.current) main.current.scrollTop = 0;
    shell.set({ nav: false });
    if (route.name !== 'search') main.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [screen]);

  return (
    <main className="main" id="main" tabIndex={-1} ref={main}>
      <View key={screen} route={route} />
    </main>
  );
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
      const ui = shell.get();
      if (e.key === 'Escape') {
        if (ui.eq) { shell.set({ eq: false }); return; }
        if (ui.now) { shell.set({ now: false }); return; }
        if (ui.nav) { shell.set({ nav: false }); return; }
        if (typing) target.blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); go('/search'); }
        return;
      }
      if (target.closest?.('.dial') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      if (target.closest?.('dialog')) return;
      const k = e.key;
      const handlers: Record<string, () => unknown> = {
        ' ': () => { if (tag === 'BUTTON' || tag === 'A') return false; player.toggle(); },
        ArrowRight: () => (e.shiftKey ? player.next() : player.seek(player.time + 5)),
        ArrowLeft: () => (e.shiftKey ? player.prev() : player.seek(player.time - 5)),
        ArrowUp: () => { if (target.closest('.tl, .menu')) return false; player.setVolume(player.volume + 0.05); },
        ArrowDown: () => { if (target.closest('.tl, .menu')) return false; player.setVolume(player.volume - 0.05); },
        m: () => player.toggleMute(),
        l: () => { if (player.track) toggleFav(player.track); },
        s: () => player.toggleShuffle(),
        r: () => player.cycleRepeat(),
        // While "Now playing" is open on a computer, Q and T switch its right half.
        q: () => (shell.get().now ? toggleNowQueue() : shell.togglePanel('queue')),
        t: () => (shell.get().now && nowHasSide() ? shell.set({ nowSide: 'lyrics' }) : shell.togglePanel('lyrics')),
        e: () => shell.set({ eq: !ui.eq }),
        f: () => shell.set({ now: !ui.now && Boolean(player.track) }),
        '/': () => go('/search'),
      };
      const handled = handlers[k.length === 1 ? k.toLowerCase() : k];
      if (handled && handled() !== false) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

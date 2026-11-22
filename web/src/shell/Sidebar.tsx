// Left sidebar (slides in on phones, folds to icons on desktop).
import { Icon, IconButton } from '../components/Icon.tsx';
import { shell, useShell, IS_LOCAL, IS_STANDALONE } from './ui.ts';
import { useStore } from '../lib/store.ts';
import { tr } from '../lib/i18n.ts';
import { cx } from '../lib/format.ts';
import { useRoute, go } from '../lib/router.ts';
import { newPlaylist, playlistHref } from '../lib/actions.ts';

interface NavItem { href: string; name: string; alt?: string[]; label: string; icon: string }
const NAV: NavItem[] = [
  { href: '/', name: '', label: 'Home', icon: 'home' },
  { href: '/search', name: 'search', label: 'Search', icon: 'search' },
  { href: '/discover', name: 'discover', label: 'Discover', icon: 'compass' },
  { href: '/radio', name: 'radio', label: 'Radio', icon: 'radio' },
];
const NAV_LIB: NavItem[] = [
  { href: '/artists', name: 'artists', alt: ['artist'], label: 'Artists', icon: 'artist' },
  { href: '/albums', name: 'albums', alt: ['album'], label: 'Albums', icon: 'album' },
  { href: '/songs', name: 'songs', label: 'Songs', icon: 'song' },
  { href: '/favorites', name: 'favorites', label: 'Favorites', icon: 'heart' },
  { href: '/history', name: 'history', label: 'History', icon: 'history' },
];

export function Sidebar() {
  const store = useStore('playlists', 'settings');
  const ui = useShell();
  const route = useRoute();

  const link = (n: NavItem) => {
    const on = route.name === n.name || Boolean(n.alt?.includes(route.name));
    return (
      <a key={n.href} className={cx('nav__link', on && 'is-on')} href={n.href} title={tr(n.label)} aria-current={on ? 'page' : undefined}
        data-route={n.name} data-alt={(n.alt || []).join(',')}>
        <Icon name={n.icon} size={19} /><span>{tr(n.label)}</span>
      </a>
    );
  };

  return (
    <nav className="side" id="side" aria-label={tr('Main menu')}>
      <div className="side__head">
        <a className="brand" href="/"><span className="brand__mark" aria-hidden="true" /><span className="brand__name">Tunes</span></a>
        <IconButton icon="sidebar" size={19} className="side__toggle" label={ui.sideMini ? tr('Expand sidebar') : tr('Collapse sidebar')}
          aria-pressed={ui.sideMini} onClick={() => shell.set({ sideMini: !ui.sideMini })} />
      </div>
      <div className="nav">{NAV.map(link)}</div>
      <div className="nav"><p className="nav__label">{tr('Collection')}</p>{NAV_LIB.map(link)}</div>
      <div className="nav nav--lists">
        <div className="nav__head">
          <p className="nav__label">{tr('Playlists')}</p>
          <IconButton icon="plus" size={17} label={tr('New playlist')} onClick={async () => {
            const p = await newPlaylist();
            if (p) go(playlistHref(p.id));
          }} />
        </div>
        {store.playlists.length ? (
          <div className="nav__scroll">
            {store.playlists.map((p) => {
              const on = route.name === 'playlist' && route.arg === p.id;
              return (
                <a key={p.id} className={cx('nav__link', 'nav__link--pl', on && 'is-on')} href={playlistHref(p.id)} aria-current={on ? 'page' : undefined}
                  data-route="playlist" data-arg={p.id} onDragOver={(e) => e.preventDefault()}>
                  <span>{p.name}</span><span className="nav__count">{p.tracks.length}</span>
                </a>
              );
            })}
          </div>
        ) : <p className="nav__hint">{tr('Create your first playlist with the + button')}</p>}
      </div>
      <div className="nav nav--foot">
        {IS_LOCAL ? (
          <button type="button" className={cx('nav__link', 'nav__phone', store.settings.phoneOn && 'is-live')} onClick={() => shell.set({ phone: true })}>
            <Icon name="phone" size={19} /><span>{tr('Listen on phone')}</span>
            {store.settings.phoneOn ? <span className="nav__dot" title={tr('On')} /> : null}
          </button>
        ) : null}
        {!IS_LOCAL && !IS_STANDALONE ? (
          <button type="button" className="nav__link nav__phone" onClick={() => shell.set({ install: true })}>
            <Icon name="plus" size={19} /><span>{tr('Add to Home Screen')}</span>
          </button>
        ) : null}
        {link({ href: '/settings', name: 'settings', label: 'Settings', icon: 'settings' })}
      </div>
    </nav>
  );
}

// Left sidebar (slides in on phones, folds to icons on desktop).
import { Icon, IconButton } from '../components/Icon.tsx';
import { shell, useShell, IS_LOCAL } from './ui.ts';
import { useInstallMethod, promptInstall, IS_PHONE } from '../lib/install.ts';
import { toast } from '../lib/feedback.ts';
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
  const install = useInstallMethod();
  const installLabel = IS_PHONE ? tr('Add to Home Screen') : tr('Install app');

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
                <a key={p.id} className={cx('nav__link', 'nav__link--pl', on && 'is-on')} href={playlistHref(p.id)} title={p.name} aria-current={on ? 'page' : undefined}
                  data-route="playlist" data-arg={p.id} onDragOver={(e) => e.preventDefault()}>
                  <span>{p.name}</span><span className="nav__count">{p.tracks.length}</span>
                </a>
              );
            })}
          </div>
        ) : <p className="nav__hint">{tr('Create your first playlist with the + button')}</p>}
      </div>
      <div className={cx('nav', 'nav--foot', ui.footCompact && 'is-compact')}>
        <DragHandle className="nav__grip" orientation="horizontal"
          label={ui.footCompact ? tr('Show the labels below') : tr('Fold the items below into icons')}
          onDrag={(dx, dy) => { if (dy > 14) shell.set({ footCompact: true }); else if (dy < -14) shell.set({ footCompact: false }); }}
          onToggle={() => shell.set({ footCompact: !shell.get().footCompact })} />
        {IS_LOCAL ? (
          <button type="button" className={cx('nav__link', 'nav__phone', store.settings.phoneOn && 'is-live')} title={tr('Listen on phone')} onClick={() => shell.set({ phone: true })}>
            <Icon name="phone" size={19} /><span>{tr('Listen on phone')}</span>
            {store.settings.phoneOn ? <span className="nav__dot" title={tr('On')} /> : null}
          </button>
        ) : null}
        {install ? (
          <button type="button" className="nav__link nav__phone nav__install" title={installLabel} onClick={async () => {
            // One click where the browser can install; otherwise the steps for this browser.
            if (install === 'prompt') { if (await promptInstall()) toast(tr('Tunes is installed')); }
            else shell.set({ install: true });
          }}>
            <Icon name="plus" size={19} /><span>{installLabel}</span>
          </button>
        ) : null}
        {link({ href: '/settings', name: 'settings', label: 'Settings', icon: 'settings' })}
      </div>
      {/* The right edge: drag it left to fold the menu to icons, right to unfold (computers). */}
      <DragHandle className="side__edge" orientation="vertical" label={ui.sideMini ? tr('Expand sidebar') : tr('Collapse sidebar')}
        onDrag={(dx) => { if (dx < -40) shell.set({ sideMini: true }); else if (dx > 40) shell.set({ sideMini: false }); }}
        onToggle={() => shell.set({ sideMini: !shell.get().sideMini })} />
    </nav>
  );
}

// A line you can drag (or click, or use with the keyboard) to fold something.
function DragHandle({ className, orientation, label, onDrag, onToggle }: {
  className: string; orientation: 'horizontal' | 'vertical'; label: string;
  onDrag: (dx: number, dy: number) => void; onToggle: () => void;
}) {
  return (
    <div className={className} role="separator" aria-orientation={orientation} aria-label={label} tabIndex={0}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY;
        let moved = false;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
          onDrag(dx, dy);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          if (!moved) onToggle();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        if (orientation === 'horizontal' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); onDrag(0, e.key === 'ArrowDown' ? 99 : -99); }
        if (orientation === 'vertical' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); onDrag(e.key === 'ArrowLeft' ? -99 : 99, 0); }
      }} />
  );
}

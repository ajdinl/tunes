// Entry point of the React frontend.
import { createRoot } from 'react-dom/client';

import './styles/app.css';
import { App } from './App.tsx';
import { initLang, tr } from './lib/i18n.ts';
import { initRouter } from './lib/router.ts';
import { store } from './lib/store.ts';
import { player } from './lib/player.ts';
import { offline } from './lib/offline.ts';
import { toast } from './lib/feedback.ts';
import { songs } from './lib/format.ts';
import { connectEvents, startSession } from './lib/session.ts';
import { startTooltips } from './lib/tooltips.ts';
import { IS_LOCAL, shell } from './shell/ui.ts';
import { installMethod, IS_PHONE } from './lib/install.ts';
import * as i18n from './lib/i18n.ts';
import { syncPrefs } from './lib/prefs.ts';

// For the end-to-end tests (tests/e2e/helpers.js appModule()) and for poking around in the console.
Object.assign(window, { __tunes: { player, offline, store, i18n } });

// First visit on a phone: a short reminder that Tunes can be added to the Home Screen.
function maybeShowInstallHint(): void {
  if (IS_LOCAL || !IS_PHONE || installMethod() === null) return;
  try { if (localStorage.getItem('tunes.installHint')) return; localStorage.setItem('tunes.installHint', '1'); } catch { return; }
  setTimeout(() => toast(tr('Add Tunes to your Home Screen so it opens like an app.'), { action: tr('How?'), onAction: () => shell.set({ install: true }), timeout: 9000 }), 1500);
}

async function boot(): Promise<void> {
  initRouter();
  await initLang();
  startTooltips();
  const root = createRoot(document.getElementById('root')!);
  try { await store.load(); await syncPrefs(); }
  catch { toast(tr('The server isn\'t responding. Is Tunes running?'), { error: true, timeout: 10000 }); }
  root.render(<App />);
  connectEvents((count, changed) => { if (changed) toast(tr('Library updated: {n}', { n: songs(count) })); });
  startSession();
  maybeShowInstallHint();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();

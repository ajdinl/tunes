// The phone-only version (web/dist-standalone): no Tunes server. It is served like GitHub
// Pages under /tunes/, keeps the user's data in the browser and asks the music sources
// itself. The sources answer from the same fake internet the server tests use
// (tests/support/fake-net.js), with CORS headers like the real ones; songs are short WAVs.
import { test as base, expect } from '@playwright/test';

import { answer } from '../support/fake-net.js';
import { makeWav } from '../support/fixtures.js';
import { IPHONE_UA, sleep } from './helpers.js';
import { PAGES_URL } from '../../playwright.config.js';
import { shareLink } from '../../lib/share.ts';

const SONG = makeWav(245);
const CORS = { 'Access-Control-Allow-Origin': '*' };

const test = base.extend({
  // A phone that opens the link: its own storage, the service worker allowed, the internet faked.
  phone: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: PAGES_URL, userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2, locale: 'en-GB', serviceWorkers: 'allow',
    });
    const asked = [];
    const errors = [];
    await context.route((url) => url.hostname !== '127.0.0.1', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      asked.push(url.href);
      // Songs and stations: a short WAV.
      if (/\/v1\/tracks\/\w+\/stream$/.test(url.pathname) || /\/listen\/$/.test(url.pathname) || url.hostname === 'stream.example' || url.hostname === 'archive.org' && url.pathname.startsWith('/download/')) {
        return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'audio/wav' }, body: SONG });
      }
      const res = answer(url, { headers: req.headers() });
      if (!res) return route.abort('internetdisconnected');
      return route.fulfill({ status: res.status, headers: { ...CORS, 'Content-Type': res.headers.get('content-type') || 'application/json' }, body: Buffer.from(await res.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await use(Object.assign(page, { asked, ctx: context }));
    await context.close();
    expect(errors, 'page errors').toEqual([]);
  },
});

const ready = async (page) => { await page.locator('#main h1').first().waitFor(); };
const app = (page, fn, arg) => page.evaluate(fn, arg);
const playing = (page) => app(page, () => window.__tunes.player.playing);

test('opens from the link: English, the music sources, no computer parts', async ({ phone }) => {
  await phone.goto('./');
  await ready(phone);
  await expect(phone.locator('html')).toHaveAttribute('lang', 'en');
  await expect(phone.locator('#main')).toContainText('Free music from Audius, Internet Archive and internet radio.');
  await expect(phone.locator('#main')).not.toContainText('Add your music');
  await expect(phone.locator('#main')).toContainText('Harbor Lights'); // Audius, asked straight from the phone
  expect(phone.asked.some((u) => u.startsWith('https://api.audius.co/v1/tracks/trending'))).toBe(true);
  await expect(phone.locator('.deck [aria-label="Equalizer (E)"]')).toHaveCount(0);
  await expect(phone.locator('.deck .dial')).toHaveAttribute('data-style', 'minimal');

  // A deep link works too (GitHub Pages answers it with the app's 404.html).
  await phone.goto('settings');
  await expect(phone.locator('#main h1')).toHaveText('Settings');
  await expect(phone.locator('#main h2')).toHaveText(['Language', 'Theme and colors', 'Player and lists', 'App icon']);
  await expect(phone.locator('.dial-opt')).toHaveCount(0); // phones always use Minimal
  await phone.locator('.settings-tabs [data-tab="music"]').tap();
  await expect(phone).toHaveURL(/\/tunes\/settings\?tab=music$/);
  await expect(phone.locator('#main h2')).toHaveText(['Music sources', 'Home screen']); // no folders, Jamendo or Spotify here
  await phone.locator('.settings-tabs [data-tab="more"]').tap();
  await expect(phone.locator('#main h2')).toHaveText(['Offline playback', 'Backup']);
  await phone.locator('#navToggle').tap();
  await expect(phone.locator('.nav__phone:not(.nav__install)')).toHaveCount(0); // no "Listen on phone"
  await expect(phone.locator('.nav__install')).toBeVisible(); // but "Add to Home Screen"

  // Links stay under /tunes/.
  await phone.locator('.nav a[href$="/search"]').first().click();
  await expect(phone).toHaveURL(/\/tunes\/search$/);
});

test('plays from the sources directly and keeps favorites, playlists and choices on the phone', async ({ phone }) => {
  await phone.goto('./');
  await ready(phone);
  await phone.locator('#main .tr', { hasText: 'Harbor Lights' }).first().locator('.tr__title').tap(); // one tap plays
  await expect.poll(() => playing(phone)).toBe(true);
  expect(await app(phone, () => window.__tunes.player.fx.src)).toBe('https://api.audius.co/v1/tracks/D7KyD/stream?app_name=Tunes');

  await phone.locator('.deck__fav').tap();
  await app(phone, async () => { const s = window.__tunes.store; await s.createPlaylist('For the road', [window.__tunes.player.track]); });
  // Shown once right away, not only after a reload (the app used to get the stored array itself).
  expect(await app(phone, () => window.__tunes.store.playlists.map((p) => p.name))).toEqual(['For the road']);
  await phone.goto('settings');
  await phone.locator('.theme-opt', { hasText: 'Light' }).click();
  // The icon: picked before adding Tunes to the Home Screen (the linked manifest and touch icon follow).
  await expect(phone.locator('link[rel=manifest]')).toHaveAttribute('href', /manifest(-bars)?\.webmanifest$/);
  await phone.locator('.theme-opt', { hasText: 'Vinyl' }).click();
  await expect(phone.locator('link[rel=manifest]')).toHaveAttribute('href', '/tunes/manifest-vinyl.webmanifest');
  await expect(phone.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/tunes/icons/vinyl/icon-512.png');
  await sleep(600); // written to IndexedDB shortly after a change

  await phone.reload();
  await ready(phone);
  const kept = await app(phone, () => ({
    favorites: Object.keys(window.__tunes.store.favorites),
    playlists: window.__tunes.store.playlists.map((p) => [p.name, p.tracks.length]),
  }));
  expect(kept).toEqual({ favorites: ['audius:D7KyD'], playlists: [['For the road', 1]] });
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(phone.locator('link[rel=manifest]')).toHaveAttribute('href', '/tunes/manifest-vinyl.webmanifest');
  const manifest = await (await phone.request.get('manifest-vinyl.webmanifest')).json();
  expect(manifest.icons[0].src).toBe('icons/vinyl/icon-192.png');
  expect(manifest.start_url).toBe('/tunes/');
});

test('radio over https, even for a station listed with http', async ({ phone }) => {
  await phone.goto('radio');
  await ready(phone);
  await phone.locator('#main .station', { hasText: 'Coastline FM' }).first().click();
  await expect.poll(() => playing(phone)).toBe(true);
  expect(await app(phone, () => window.__tunes.player.fx.src)).toBe('https://stream.example/coast.mp3');
  expect(phone.asked).not.toContain('http://stream.example/coast.mp3');
});

test('opens without a connection, and saved songs still play', async ({ phone }) => {
  await phone.goto('./');
  await ready(phone);
  await expect.poll(() => app(phone, () => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await phone.locator('#main .tr', { hasText: 'Harbor Lights' }).first().locator('.tr__title').tap(); // one tap plays
  await expect.poll(() => playing(phone)).toBe(true);
  await phone.locator('.deck__fav').tap();
  // The offline buffer downloads the song (straight from the source) in the background.
  await expect.poll(() => app(phone, () => window.__tunes.offline.isCached('audius:D7KyD')), { timeout: 15000 }).toBe(true);
  await sleep(600);

  await phone.ctx.setOffline(true);
  await phone.reload();
  await ready(phone);
  await phone.goto('favorites').catch(() => {});
  await ready(phone);
  await phone.locator('#main .tr', { hasText: 'Harbor Lights' }).first().locator('.tr__title').tap(); // one tap plays
  await expect.poll(() => playing(phone)).toBe(true);
  expect(await app(phone, () => window.__tunes.player.fx.src)).toMatch(/^blob:/);
  await phone.ctx.setOffline(false);
});

test('backup: the whole collection as a file, made on the phone', async ({ phone }) => {
  await phone.goto('./');
  await ready(phone);
  const fav = phone.locator('#main .tr', { hasText: 'Harbor Lights' }).first().locator('.tr__fav');
  await fav.tap();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await phone.goto('settings?tab=more');
  await ready(phone);
  const [download] = await Promise.all([phone.waitForEvent('download'), phone.getByRole('button', { name: 'Download backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tunes-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await (await import('node:fs')).promises.readFile(await download.path(), 'utf8'));
  expect(Object.keys(data.favorites)).toEqual(['audius:D7KyD']);
  expect(data.settings).toBeUndefined();
});

test('downloads for a trip: straight from the source, listed and playing with no connection', async ({ phone }) => {
  await phone.goto('./');
  await ready(phone);
  await expect.poll(() => app(phone, () => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const row = phone.locator('#main .tr', { hasText: 'Harbor Lights' }).first();
  await row.locator('.tr__more').tap();
  await phone.locator('.menu__item', { hasText: 'Download' }).tap();
  await expect.poll(() => app(phone, () => window.__tunes.offline.isPinned('audius:D7KyD')), { timeout: 15000 }).toBe(true);
  expect(phone.asked).toContain('https://api.audius.co/v1/tracks/D7KyD/stream?app_name=Tunes');

  await phone.ctx.setOffline(true);
  await phone.goto('downloads');
  await ready(phone);
  await expect(phone.locator('#main h1')).toHaveText('Downloads');
  await phone.locator('#main .tr', { hasText: 'Harbor Lights' }).locator('.tr__title').tap();
  await expect.poll(() => playing(phone)).toBe(true);
  expect(await app(phone, () => window.__tunes.player.fx.src)).toMatch(/^blob:/);
  await phone.ctx.setOffline(false);
});

test('hearthis.at DJ mixes: played straight from the source, downloadable only where the DJ allows it', async ({ phone }) => {
  await phone.goto('discover?source=hearthis');
  await ready(phone);
  await phone.locator('.chip', { hasText: 'Afro House' }).tap();
  const free = phone.locator('#main .tr', { hasText: 'Sunset Afro Set' });
  await expect(free).toBeVisible();
  expect(phone.asked.some((u) => u.startsWith('https://api-v2.hearthis.at/feed/?type=popular&category=afrohouse'))).toBe(true);
  await free.locator('.tr__title').tap();
  await expect.poll(() => playing(phone)).toBe(true);
  expect(await app(phone, () => window.__tunes.player.fx.src)).toBe('https://hearthis.app/dj-amara/sunset-set/listen/');

  // The DJ allows downloading this one…
  await free.locator('.tr__more').tap();
  await expect(phone.locator('.menu__item', { hasText: 'Download' })).toBeVisible();
  await phone.locator('#main h1').first().tap(); // a tap outside closes the menu
  await expect(phone.locator('.menu')).toHaveCount(0);
  // …but this one only streams, so there is no Download.
  await phone.locator('#main .tr', { hasText: 'Club Night Mix' }).locator('.tr__more').tap();
  await expect(phone.locator('.menu__item', { hasText: 'Open on source website' })).toBeVisible();
  await expect(phone.locator('.menu__item', { hasText: 'Download' })).toHaveCount(0);
  expect(await app(phone, async () => window.__tunes.offline.pin([{ id: 'hearthis:club-night', source: 'hearthis', title: 'x', stream: '/api/stream/url?u=x' }]))).toBe(0);
});

test('a shared song opens ready to play, keep or add to a playlist; a broken link says so', async ({ phone }) => {
  // The link as Tunes on a computer makes it (server-shaped addresses), opened on this phone.
  const link = shareLink({
    id: 'audius:D7KyD', source: 'audius', title: 'Harbor Lights', artist: 'Nadia Vale', duration: 245,
    cover: '/api/img?u=' + encodeURIComponent('https://creatornode.example/content/abc/480x480.jpg'), stream: '/api/stream/audius/D7KyD',
  }, PAGES_URL);
  await phone.goto(link);
  await expect(phone.locator('#main h1')).toHaveText('Harbor Lights');
  await expect(phone.locator('.hd__kicker')).toHaveText('Shared with you');
  await expect(phone.locator('.hd__meta')).toContainText('Nadia Vale · Audius · 4:05');
  await phone.locator('.shared__play').tap();
  await expect.poll(() => playing(phone)).toBe(true);
  expect(await app(phone, () => window.__tunes.player.fx.src)).toBe('https://api.audius.co/v1/tracks/D7KyD/stream?app_name=Tunes');
  await phone.locator('.shared__fav').tap();
  await expect(phone.locator('.shared__fav')).toHaveAttribute('aria-pressed', 'true');
  expect(await app(phone, () => Object.keys(window.__tunes.store.favorites))).toEqual(['audius:D7KyD']);

  await phone.goto('shared#bm90LWEtc29uZw');
  await expect(phone.locator('.empty')).toContainText('This link is broken or incomplete');
});

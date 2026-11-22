// Every screen renders in every language without page errors and without stray
// "null" / "undefined" / "NaN" text; old Bosnian addresses redirect.
import { test, expect, open, go, settle, setLanguage, routeOf, LANGS } from './helpers.js';
import { ARCHIVE_DOC, AUDIUS_USER } from '../support/fake-net.js';

const STATIC_ROUTES = [
  '/', '/search', '/search?q=river', '/search?q=river&type=sets', '/search?q=river&type=artists',
  '/discover', '/discover?source=hearthis', '/discover?source=archive', '/discover?source=jamendo', '/radio',
  '/artists', '/albums', '/songs', '/favorites', '/downloads', '/history',
  '/smart/mix', '/smart/most-played', '/smart/forgotten', '/smart/recent', '/smart/unplayed', '/smart/online',
  '/settings', `/audius/${AUDIUS_USER.id}`, `/archive/${ARCHIVE_DOC.identifier}`,
];

function strayText() {
  const bad = /\b(null|undefined|NaN)\b/;
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode.textContent;
    if (bad.test(t) && !w.currentNode.parentElement.closest('script,style')) out.push(t.trim().slice(0, 80));
  }
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v && bad.test(v)) out.push(`${a}="${v}"`);
    }
  }
  return out;
}

test.beforeAll(async ({ request }) => {
  // A playlist, a favorite and some history, so those screens have content too.
  const { tracks } = await (await request.get('/api/library')).json();
  await request.post('/api/playlists', { data: { name: 'Test mix', tracks: tracks.slice(0, 3) } });
  const fav = await (await request.get('/api/state')).json();
  if (!fav.favorites[tracks[1].id]) await request.post('/api/favorites/toggle', { data: { track: tracks[1] } });
  await request.post('/api/history', { data: { track: tracks[2], at: Date.now() - 86400000 } });
});

for (const lang of LANGS) {
  test(`every screen renders in ${lang}`, async ({ page }) => {
    await open(page, '/');
    await setLanguage(page, lang);
    await page.reload();
    await settle(page);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);

    // Routes that need ids from the data: an artist, an album and the playlist.
    await open(page, '/artists');
    const artist = await page.locator('#main a[href*="/artist/"]').first().getAttribute('href');
    await open(page, '/albums');
    const album = await page.locator('#main a[href*="/album/"]').first().getAttribute('href');
    const playlist = await page.locator('.nav a[href*="/playlist/"]').first().getAttribute('href');

    for (const hash of [...STATIC_ROUTES, artist, album, playlist]) {
      await go(page, hash);
      await expect(page.locator('#main h1, #main input[type=search]').first(), hash).toBeVisible();
      await expect(page.locator('#main .err'), `${hash} shows an error`).toHaveCount(0);
      expect(await page.evaluate(strayText), `stray text on ${hash} (${lang})`).toEqual([]);
    }
  });
}

test('old hash addresses (and old Bosnian ones) redirect to paths', async ({ page }) => {
  const pairs = {
    '#/settings': '#/settings', '#/album/x%7Cy': '#/album/x%7Cy', '#/podesavanja': '#/settings', '#/pretraga?q=jazz': '#/search?q=jazz', '#/omiljene': '#/favorites',
    '#/istorija': '#/history', '#/izvodjaci': '#/artists', '#/albumi': '#/albums', '#/pesme': '#/songs', '#/otkrij': '#/discover',
  };
  for (const [from, to] of Object.entries(pairs)) {
    await open(page, from);
    expect(routeOf(page)).toBe(to.slice(1));
    expect(new URL(page.url()).hash).toBe('');
  }
});

test('online screens show results from the sources', async ({ page }) => {
  await open(page, '/search?q=river');
  await expect(page.locator('#main')).toContainText('Harbor Lights');
  await expect(page.locator('#main')).toContainText('Coastline FM');
  await expect(page.locator('#main')).toContainText('The Fen Lights Live at the Mill');
  // Local songs match too.
  await expect(page.locator('#main')).toContainText('Slow River');
  await open(page, `/archive/${ARCHIVE_DOC.identifier}`);
  await expect(page.locator('#main .tr__title')).toHaveText(['fen01 Opening Song', 'Intro']);
  await open(page, `/audius/${AUDIUS_USER.id}`);
  await expect(page.locator('#main h1')).toHaveText('Kaito');
  await open(page, '/radio');
  await expect(page.locator('#main')).toContainText('Coastline FM');
});

test('paths load directly, and back and forward work', async ({ page }) => {
  await open(page, '/albums');
  await expect(page.locator('#main h1')).toHaveText('Albums');
  await page.locator('#main a[href*="/album/"]').first().click();
  await expect(page.locator('#main h1')).not.toHaveText('Albums');
  expect(routeOf(page)).toMatch(/^\/album\//);
  await page.goBack();
  await expect(page.locator('#main h1')).toHaveText('Albums');
  await page.goForward();
  await expect(page.locator('#main h1')).not.toHaveText('Albums');
  // A link in the app is handled in place, without a page load.
  await page.evaluate(() => { window.__sameDocument = true; });
  await page.locator('.nav a[href="/songs"]').click();
  await expect(page.locator('#main h1')).toHaveText('Songs');
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('a new build on the server updates an open window once, then offers a reload', async ({ page }) => {
  // The server announces a build this window doesn't run.
  await page.route('**/api/events', (r) => r.fulfill({
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
    body: 'retry: 500\n\nevent: version\ndata: {"id":"index-NEWBUILD.js"}\n\n',
  }));
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto('/songs');
  // Nothing plays, so it reloads by itself, once (the files here never change, so a loop would be easy).
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tunes.reloadedFor')).catch(() => null)).toBe('index-NEWBUILD.js');
  await expect(page.locator('.toast')).toContainText('A new version of Tunes is ready.');
  await page.waitForTimeout(2500);
  expect(loads).toBe(2);
  await expect(page.locator('.toast .toast__act')).toHaveText('Reload');
});

test('English and the black theme until the user picks others, whatever the browser language', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, locale: 'bs-BA', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await open(page, '/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#main h1')).toHaveText('Settings');
  // The black theme is the default too.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'black');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.locator('.lang-select').selectOption('bs');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bs');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'bs');
  await ctx.close();
});

test('a stopped server shows a short note, not an old copy of the interface', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await open(page, '/');
  // A cache left by the old service worker is removed when the new one takes over.
  await page.evaluate(async () => {
    await (await caches.open('tunes-v1')).put('/', new Response('<h1>Old Tunes</h1>', { headers: { 'Content-Type': 'text/html' } }));
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
  await page.reload();
  await settle(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([]);

  await page.evaluate(() => localStorage.setItem('tunes.lang', JSON.stringify('bs')));
  await ctx.setOffline(true);
  await page.goto('/settings').catch(() => {});
  await expect(page.locator('h1')).toHaveText('Tunes nije pokrenut');
  await expect(page.locator('body')).not.toContainText('Old Tunes');
  // Back as soon as the server answers again.
  await ctx.setOffline(false);
  await expect(page.locator('#main h1')).toHaveText('Postavke', { timeout: 10000 });
  await ctx.close();
});

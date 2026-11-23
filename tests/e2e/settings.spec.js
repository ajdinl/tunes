// Settings that reach other devices: the app icon, and phone access in a real browser.
import fs from 'node:fs';
import path from 'node:path';

import { test, expect, open, settle, sleep, phoneURL, appModule } from './helpers.js';

test('choosing an app icon updates favicon, home-screen icon and manifest on every open device', async ({ device, request }) => {
  const laptop = await device();
  const phone = await device({ mobile: true });
  await open(phone, '/');
  await open(laptop, '/settings');

  await laptop.locator('.theme-opt', { hasText: /^Vinyl$/ }).click();
  await expect(laptop.locator('.theme-opt', { hasText: /^Vinyl$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(laptop.locator('link[rel=icon]')).toHaveAttribute('href', '/icons/app.svg?v=vinyl');
  // The phone hears about it over the event stream, without a reload.
  await expect(phone.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/icons/app-512.png?v=vinyl');
  await expect(phone.locator('link[rel=icon]')).toHaveAttribute('href', '/icons/app.svg?v=vinyl');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.icons[1].src).toBe('/icons/app-512.png?v=vinyl');

  await laptop.locator('.theme-opt', { hasText: /^Dial$/ }).click();
  await expect(phone.locator('link[rel=icon]')).toHaveAttribute('href', '/icons/app.svg?v=dial');
});

test('phone access: the QR link logs the phone in, and the app works with the cookie', async ({ device, request }) => {
  const on = await (await request.post('/api/phone', { data: { enabled: true } })).json();
  expect(on.enabled).toBe(true);
  await sleep(600); // db.json is written with a short delay
  const token = JSON.parse(fs.readFileSync(path.join(process.env.TUNES_E2E_DATA, 'db.json'), 'utf8')).settings.phone.token;
  const lan = `http://phone.local:${on.port}`;
  try {
    const phone = await device({ mobile: true });
    const denied = await phone.goto(lan + '/');
    expect(denied.status()).toBe(401);
    await expect(phone.locator('body')).toContainText('Scan the QR code');

    await phone.goto(`${lan}/?k=${token}#/songs`);
    expect(new URL(phone.url()).search).toBe('');
    await settle(phone);
    await expect(phone.locator('#main .tr')).not.toHaveCount(0);
    const cookies = await phone.context().cookies(lan);
    expect(cookies.find((c) => c.name === 'sl_k')).toMatchObject({ value: token, httpOnly: true, sameSite: 'Strict' });
    // The home-screen manifest opens the link with the key.
    const manifest = await phone.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()));
    expect(manifest.start_url).toBe(`/?k=${token}`);
  } finally {
    await request.post('/api/phone', { data: { enabled: false } });
  }
});

// ---------------------------------------------------------------- installing as an app
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0';
const installButton = (page) => page.locator('.nav__install');

test('install: one click where the browser offers it', async ({ page }) => {
  await open(page, '/');
  // What Chrome, Edge and Brave fire when the app can be installed.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    dispatchEvent(e);
  });
  await expect(installButton(page)).toHaveText('Install app');
  await installButton(page).click();
  await expect.poll(() => page.evaluate(() => window.__prompted)).toBe(true);
  await expect(page.locator('dialog.dlg')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Tunes is installed');
  await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
  await expect(installButton(page)).toHaveCount(0);
});

test('install: short steps for the browser in use, nothing where it is not possible', async ({ page, browser, baseURL }) => {
  // Chromium on a computer before it offers the one-click install: the address bar icon.
  await open(page, '/');
  await installButton(page).click();
  const dlg = page.locator('dialog.dlg');
  await expect(dlg.locator('.dlg__title')).toHaveText('Install app');
  await expect(dlg).toContainText('install icon at the right end of the address bar');
  await expect(dlg.locator('.install__h')).toHaveCount(0); // Tailscale is only explained on phones
  await dlg.locator('.ibtn').click();

  for (const [ua, expected] of [[MAC_SAFARI, 'File → Add to Dock'], [FIREFOX, null]]) {
    const ctx = await browser.newContext({ baseURL, userAgent: ua, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await open(p, '/');
    if (expected) {
      await installButton(p).click();
      await expect(p.locator('dialog.dlg')).toContainText(expected);
    } else {
      await expect(installButton(p)).toHaveCount(0); // Firefox on a computer can't install web apps
    }
    await ctx.close();
  }
});

test('install: on an iPhone, Share → Add to Home Screen plus Tailscale', async ({ device, baseURL }) => {
  const phone = await device({ mobile: true });
  await phone.goto(phoneURL(baseURL, '/'));
  await settle(phone);
  await phone.locator('#navToggle').tap();
  await installButton(phone).tap();
  const dlg = phone.locator('dialog.dlg');
  await expect(dlg.locator('.dlg__title')).toHaveText('Add to Home Screen');
  await expect(dlg).toContainText('Tap the Share button');
  await expect(dlg).not.toContainText('address bar');
  await expect(dlg.locator('.install__h')).toHaveText('Listening away from home (Tailscale)');
});

test('theme, language, player style and button layout follow you to other browsers', async ({ device }) => {
  const a = await device();
  const b = await device();
  await open(a, '/settings');
  await open(b, '/');
  await a.locator('.theme-opt', { hasText: 'Light' }).click();
  await a.locator('.dial-opt[data-style="minimal"]').click();
  await a.locator('.ctrls-opt[data-ctrls="beside"]').click();
  await a.locator('.lang-select').selectOption('de');
  await expect(a.locator('html')).toHaveAttribute('lang', 'de');

  // A device that is already open changes along, without a reload.
  await expect(b.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(b.locator('html')).toHaveAttribute('lang', 'de');
  await expect(b.locator('.deck .dial')).toHaveAttribute('data-style', 'minimal');
  await expect(b.locator('body')).toHaveClass(/deck-row/);

  // A browser that has never seen Tunes starts with them.
  const c = await device();
  await open(c, '/settings');
  await expect(c.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(c.locator('html')).toHaveAttribute('lang', 'de');
  await expect(c.locator('#main h1')).toHaveText('Einstellungen');
  await expect(c.locator('.dial-opt[data-style="minimal"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(c.locator('.ctrls-opt[data-ctrls="beside"]')).toHaveAttribute('aria-pressed', 'true');

  // The menu folded on one computer stays a choice of that screen.
  await a.locator('.side__toggle').click();
  await expect(a.locator('body')).toHaveClass(/side-mini/);
  await c.reload();
  await settle(c);
  await expect(c.locator('body')).not.toHaveClass(/side-mini/);
});

test('choices made before syncing existed are sent up once', async ({ device, request }) => {
  const a = await device();
  await a.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tunes.theme', JSON.stringify('indigo'));
    localStorage.setItem('tunes.dialStyle', JSON.stringify('mirror'));
  });
  await open(a, '/');
  await expect.poll(async () => (await (await request.get('/api/state')).json()).settings.prefs).toEqual({ theme: 'indigo', dialStyle: 'mirror' });
  await expect(a.locator('html')).toHaveAttribute('data-theme', 'indigo');
});

const cssVar = (page, name) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);

test('accent color, Now Playing background, sources and Home sections follow you; text size stays on the device', async ({ device, request }) => {
  const a = await device();
  const b = await device();
  await open(a, '/settings');
  await open(b, '/');
  await expect(b.locator('.side .nav__link[data-route="radio"]')).toHaveCount(1);

  await a.locator('.accent-opt[data-accent="teal"]').click();
  await expect(a.locator('.accent-opt[data-accent="teal"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await cssVar(a, '--amber')).toBe('#40d3c8');
  await a.locator('.nowbg-opt[data-nowbg="plain"]').click();
  await a.locator('.switch[data-source="radio"]').click();
  await expect(a.locator('.switch[data-source="radio"]')).toHaveAttribute('aria-checked', 'false');
  // Popular on Audius to the top of Home.
  for (let i = 0; i < 3; i++) await a.getByRole('button', { name: 'Move Popular this week on Audius up' }).click();
  await expect(a.locator('.opt-list__item[data-section]').first()).toHaveAttribute('data-section', 'popular');
  const bodySize = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  const normal = await bodySize(a);
  await a.locator('.text-opt[data-text="small"]').click();
  expect(await bodySize(a)).toBeLessThan(normal);
  await a.locator('.text-opt[data-text="large"]').click();
  expect(await bodySize(a)).toBeGreaterThan(normal);
  await a.locator('.density-opt[data-density="compact"]').click();
  await expect(a.locator('html')).toHaveAttribute('data-text', 'large');
  await expect(a.locator('html')).toHaveAttribute('data-density', 'compact');

  await expect.poll(async () => (await (await request.get('/api/state')).json()).settings.prefs)
    .toEqual({ accent: 'teal', nowBg: 'plain', hide: 'radio', home: 'popular,recent,smart,stations' });

  // The other open browser changes along: color, background, menu and Home.
  await expect.poll(() => cssVar(b, '--amber')).toBe('#40d3c8');
  await expect(b.locator('html')).toHaveAttribute('data-nowbg', 'plain');
  await expect(b.locator('.side .nav__link[data-route="radio"]')).toHaveCount(0);
  await expect(b.locator('.sec__title').first()).toHaveText('Popular this week on Audius');
  // Text size and density are this device's own.
  await expect(b.locator('html')).not.toHaveAttribute('data-text', /./);
  await expect(b.locator('html')).not.toHaveAttribute('data-density', /./);

  // Radio is gone from Search too; the light theme gets the darker shade of the same accent.
  await open(b, '/search?q=jazz');
  await expect(b.locator('.searchsrc .chip--audius')).toHaveCount(1);
  await expect(b.locator('.searchsrc .chip--radio')).toHaveCount(0);
  await a.locator('.theme-opt', { hasText: 'Light' }).click();
  expect(await cssVar(a, '--amber')).toBe('#0a8076');

  // Back to amber: the theme's own colors from app.css.
  await a.locator('.accent-opt[data-accent="amber"]').click();
  expect(await cssVar(a, '--amber')).toBe('');
});

test('the accent can follow the cover of the song that plays, or be any color', async ({ device, request }) => {
  const a = await device();
  await open(a, '/settings');
  await a.locator('.accent-opt[data-accent="cover"]').click();
  expect(await cssVar(a, '--amber')).toBe(''); // nothing plays: the default amber
  // A song with a red cover (served by the fake internet through the image proxy).
  await appModule(a, 'player', ({ player }) => player.playList([{
    id: 'audius:red', source: 'audius', title: 'Red', artist: 'Cover', duration: 100,
    cover: '/api/img?u=' + encodeURIComponent('https://img.example/cover.png'), stream: '/api/stream/audius/red',
  }], 0));
  await expect.poll(() => cssVar(a, '--amber')).toMatch(/^#ff/);
  const [r, g, bl] = (await cssVar(a, '--amber-rgb')).split(' ').map(Number);
  expect(r).toBeGreaterThan(200);
  expect(Math.abs(g - bl)).toBeLessThan(10); // a lighter red, readable on black
  expect(await cssVar(a, '--cover-rgb')).toBe('255 0 0');

  // A custom color is lightened until it reads on the dark theme; the choice itself is kept.
  await a.locator('.accent-opt--custom input').fill('#203080');
  await expect(a.locator('.accent-opt--custom')).toHaveClass(/is-on/);
  expect(await cssVar(a, '--amber')).not.toBe('#203080');
  await expect.poll(async () => (await (await request.get('/api/state')).json()).settings.prefs.accent).toBe('#203080');
});

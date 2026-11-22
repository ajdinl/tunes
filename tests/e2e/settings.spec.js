// Settings that reach other devices: the app icon, and phone access in a real browser.
import fs from 'node:fs';
import path from 'node:path';

import { test, expect, open, settle, sleep, phoneURL } from './helpers.js';

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

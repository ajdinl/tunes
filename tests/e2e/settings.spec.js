// Settings that reach other devices: the app icon, and phone access in a real browser.
import fs from 'node:fs';
import path from 'node:path';

import { test, expect, open, settle, sleep } from './helpers.js';

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

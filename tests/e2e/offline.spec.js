// Offline buffer (IndexedDB): songs ahead are downloaded, play without a connection, and
// expire after 72 hours unless they are in the current window.
import { test, expect, settle, expectPlaying, position, appModule, phoneURL, touch } from './helpers.js';

const cachedIds = (page) => appModule(page, 'offline', async (m) => { await m.offline.ready; return [...m.offline.index.keys()]; });

test('songs downloaded ahead play without a connection', async ({ device, baseURL, request }) => {
  const { tracks } = await (await request.get('/api/library')).json();
  const album = tracks.filter((t) => t.album === 'Blue Hours').sort((a, b) => a.trackNo - b.trackNo);
  // A phone on Wi-Fi: local songs are buffered there (on the computer itself they are already on disk).
  const phone = await device({ mobile: true });
  await phone.goto(phoneURL(baseURL, '/albums'));
  await settle(phone);
  await phone.locator('#main a[href*="/album/"]', { hasText: 'Blue Hours' }).first().click();
  await expect(phone.locator('#main h1')).toHaveText('Blue Hours');
  await phone.locator('#main .tr .tr__play').first().click();
  await expectPlaying(phone);

  // The current song and the next ones (3 ahead by default) end up in IndexedDB.
  await expect.poll(() => cachedIds(phone), { timeout: 30000 }).toEqual(expect.arrayContaining(album.map((t) => t.id)));
  const keys = await phone.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('tunes-offline');
    r.onsuccess = () => { const q = r.result.transaction('blobs').objectStore('blobs').getAllKeys(); q.onsuccess = () => res(q.result); };
  }));
  expect(keys).toEqual(expect.arrayContaining(album.map((t) => t.id)));

  await phone.context().setOffline(true);
  await phone.locator('.deck__meta').tap(); // Now Playing has the full controls on a phone
  await phone.locator('.now [aria-label="Next"]').tap();
  await expect(phone.locator('.deck__title')).toHaveText('Slow River');
  await expectPlaying(phone);
  // It keeps playing without the network (the start can take a moment on a busy machine).
  const t0 = await position(phone);
  await expect.poll(() => position(phone), { timeout: 10000 }).toBeGreaterThan(t0 + 1);
  expect(await appModule(phone, 'player', (m) => m.player.fx.src.startsWith('blob:'))).toBe(true);

  // A stream that fails while offline switches to the downloaded copy at the same spot.
  await appModule(phone, 'player', (m) => {
    const p = m.player;
    p.offlineSrc = false;
    p.lastT = 20;
    p.fx.src = p.track.stream;
    p.fx.play().catch(() => {});
  });
  await expect.poll(() => appModule(phone, 'player', (m) => m.player.fx.src.startsWith('blob:')), { timeout: 20000 }).toBe(true);
  await expectPlaying(phone);
  await phone.context().setOffline(false);
});

test('songs unused for 72 hours are deleted, except the current window', async ({ device, baseURL }) => {
  const phone = await device({ mobile: true });
  await phone.goto(phoneURL(baseURL, '/'));
  await settle(phone);
  const r = await appModule(phone, 'offline', async (m) => {
    const { offline } = m;
    await offline.ready;
    const blob = () => new Blob([new Uint8Array(1000)], { type: 'audio/wav' });
    for (const id of ['test:old', 'test:fresh', 'test:keep']) await offline.save({ id, title: id }, blob(), 'audio/wav');
    const old = Date.now() - 73 * 3600000;
    offline.index.get('test:old').used = old;
    offline.index.get('test:keep').used = old;
    offline.keep = new Set(['test:keep']);
    await offline.expire();
    const out = { old: offline.isCached('test:old'), fresh: offline.isCached('test:fresh'), keep: offline.isCached('test:keep') };
    out.inDb = await new Promise((res) => {
      const q = indexedDB.open('tunes-offline');
      q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').getAllKeys(); g.onsuccess = () => res(g.result.sort()); };
    });
    offline.keep = new Set();
    return out;
  });
  expect(r).toEqual({ old: false, fresh: true, keep: true, inDb: ['test:fresh', 'test:keep'] });
});

test('nothing is deleted while the device is offline', async ({ device, baseURL }) => {
  const phone = await device({ mobile: true });
  await phone.goto(phoneURL(baseURL, '/'));
  await settle(phone);
  await phone.context().setOffline(true);
  const kept = await appModule(phone, 'offline', async (m) => {
    const { offline } = m;
    await offline.ready;
    await offline.save({ id: 'test:stale', title: 'stale' }, new Blob([new Uint8Array(10)]), 'audio/wav');
    offline.index.get('test:stale').used = Date.now() - 100 * 3600000;
    await offline.expire();
    return offline.isCached('test:stale');
  });
  await phone.context().setOffline(false);
  expect(kept).toBe(true);
});

test('downloads for a trip: kept past 72 hours and the buffer limit, listed offline, removable', async ({ device, baseURL, request }) => {
  const { tracks } = await (await request.get('/api/library')).json();
  const album = tracks.filter((t) => t.album === 'Blue Hours');
  const phone = await device({ mobile: true });
  await phone.goto(phoneURL(baseURL, '/albums'));
  await settle(phone);
  await phone.locator('#main a[href*="/album/"]', { hasText: 'Blue Hours' }).first().click();
  await expect(phone.locator('#main h1')).toHaveText('Blue Hours');

  // One button keeps the whole album on the phone.
  await phone.getByRole('button', { name: 'Download', exact: true }).tap();
  const pinned = () => appModule(phone, 'offline', (m) => m.offline.pinned().map((x) => x.id).sort());
  await expect.poll(pinned, { timeout: 30000 }).toEqual(album.map((t) => t.id).sort());
  await expect(phone.getByRole('button', { name: 'Downloaded' })).toBeVisible();
  await expect(phone.locator('#main .tr .tr__dl')).toHaveCount(album.length);

  // A trip: ten days later, a full buffer and a cleared buffer don't touch them.
  await appModule(phone, 'offline', async (m) => {
    await m.offline.expire(Date.now() + 10 * 86400000);
    await m.offline.evict(10 ** 12);
    await m.offline.clear();
  });
  expect(await pinned()).toEqual(album.map((t) => t.id).sort());

  // The Downloads screen lists them, and they play without a connection. (Opening the app
  // itself offline is covered by the phone-only version's tests, which have a service worker.)
  await phone.goto(phoneURL(baseURL, '/downloads'));
  await settle(phone);
  await expect(phone.locator('#main h1')).toHaveText('Downloads');
  await expect(phone.locator('#main .tr')).toHaveCount(album.length);
  await phone.context().setOffline(true);
  await phone.locator('#main .tr .tr__title').first().tap();
  await expectPlaying(phone);
  expect(await appModule(phone, 'player', (m) => m.player.fx.src.startsWith('blob:'))).toBe(true);
  await phone.context().setOffline(false);

  // Removing: one from its menu, then all of them.
  await phone.locator('#main .tr').nth(1).locator('.tr__more').tap();
  await phone.locator('.menu__item', { hasText: 'Remove download' }).tap();
  await expect(phone.locator('#main .tr')).toHaveCount(album.length - 1);
  await phone.locator('#main').getByRole('button', { name: 'Remove all downloads' }).tap();
  await phone.locator('dialog').getByRole('button', { name: 'Remove all downloads' }).tap();
  await expect(phone.locator('#main')).toContainText('Nothing downloaded yet.');
  await expect.poll(pinned).toEqual([]);
});

test('downloads: sort with one tap, search, and arrange "My order" with a finger', async ({ device, baseURL, request }) => {
  const { tracks } = await (await request.get('/api/library')).json();
  const album = tracks.filter((t) => t.album === 'Blue Hours'); // Morning Light, Slow River, Paper Boats
  const phone = await device({ mobile: true });
  await phone.goto(phoneURL(baseURL, '/downloads'));
  await settle(phone);
  await appModule(phone, 'offline', async (m, list) => { await m.offline.pin(list); }, album);
  await expect.poll(() => appModule(phone, 'offline', (m) => m.offline.pinned().length), { timeout: 30000 }).toBe(3);
  const titles = () => phone.locator('#main .tr .tr__title').allTextContents();

  await phone.locator('.chip', { hasText: 'Title' }).tap();
  await expect.poll(titles).toEqual(['Morning Light', 'Paper Boats', 'Slow River']);
  await phone.locator('.field--filter').fill('river');
  await expect.poll(titles).toEqual(['Slow River']);
  await phone.locator('.field--filter').fill('');

  // My order: handles appear; drag the first song below the last one.
  await phone.locator('.chip', { hasText: 'My order' }).tap();
  await expect(phone.locator('#main .tr__grip')).toHaveCount(3);
  const before = await titles();
  const g = await phone.locator('#main .tr__grip').first().boundingBox();
  const last = await phone.locator('#main .tr').last().boundingBox();
  const t = await touch(phone);
  await t.swipe({ x: g.x + g.width / 2, y: g.y + g.height / 2 }, { x: g.x + g.width / 2, y: last.y + last.height - 4 }, 12);
  await expect.poll(titles).toEqual([before[1], before[2], before[0]]);

  // Kept on this device, with the chosen sort.
  await phone.reload();
  await settle(phone);
  await expect(phone.locator('.chip', { hasText: 'My order' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(titles).toEqual([before[1], before[2], before[0]]);
});

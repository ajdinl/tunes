// Music plays on one device (and one tab) at a time, and can move between devices.
import { test, expect, open, playSong, expectPlaying, isPlaying, position, deckTitle, toasts, sleep } from './helpers.js';

test('handoff: the phone continues at the same second and the computer pauses', async ({ device }) => {
  const laptop = await device();
  const phone = await device({ mobile: true });
  await playSong(laptop, 'Morning Light');
  const box = await laptop.locator('.deck .dial').boundingBox();
  await laptop.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2); // about 1:00
  await expect.poll(() => position(laptop)).toBeGreaterThan(50);
  await laptop.locator('.deck__ctrls').hover(); // the dial tooltip is not in the way
  await sleep(5500); // the playing device reports every 5 s

  await open(phone, '#/');
  const banner = phone.locator('.handoff');
  await expect(banner).toBeVisible();
  await expect(banner.locator('.handoff__label')).toHaveText('Playing on: Computer');
  await expect(banner.locator('.handoff__name')).toHaveText('Morning Light');

  const at = await position(laptop);
  await banner.locator('.btn--primary').click();
  await expect(phone.locator('.deck__title')).toHaveText('Morning Light');
  await expectPlaying(phone);
  expect(Math.abs((await position(phone)) - at)).toBeLessThanOrEqual(4);
  await expectPlaying(laptop, false);
  expect((await toasts(laptop)).join(' ')).toContain('Music continues on: Phone');
  await expect(banner).toBeHidden();
});

test('starting a song on another device pauses the first one; pressing play takes it back', async ({ device }) => {
  const laptop = await device();
  const phone = await device({ mobile: true });
  await playSong(laptop, 'Slow River');
  await playSong(phone, 'Low Tide');
  await expectPlaying(laptop, false);
  expect(await isPlaying(phone)).toBe(true);

  await laptop.evaluate(() => document.activeElement?.blur());
  await laptop.keyboard.press('Space');
  await expectPlaying(laptop, true);
  await expectPlaying(phone, false);
  expect((await toasts(phone)).join(' ')).toContain('Music continues on: Computer');
});

test('two tabs on the same computer count as two players', async ({ device }) => {
  const first = await device();
  const second = await first.context().newPage();
  await playSong(first, 'Paper Boats');
  await playSong(second, 'Northbound');
  await expectPlaying(first, false);
  expect(await isPlaying(second)).toBe(true);
  // A reload keeps the tab's identity (sessionStorage), so it is not a new device.
  const id = await second.evaluate(() => sessionStorage.getItem('tunes.player'));
  await second.reload();
  expect(await second.evaluate(() => sessionStorage.getItem('tunes.player'))).toBe(id);
});

test('a device that missed the event (no SSE) yields on its next report', async ({ device }) => {
  const phone = await device({ mobile: true });
  const sleepy = await device();
  // This device never receives server events, like a sleeping tab.
  await sleepy.route('**/api/events', (r) => r.abort());
  await playSong(sleepy, 'Morning Light');
  await playSong(phone, 'Night Bus');
  // It finds out when it next reports its position (every 5 s while playing).
  await expectPlaying(sleepy, false, 12000);
  expect((await toasts(sleepy)).join(' ')).toContain('Music continues on: Phone');
  expect(await isPlaying(phone)).toBe(true);
  expect(await deckTitle(phone)).toBe('Night Bus');
});

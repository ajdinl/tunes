// Mixcloud shows play through Mixcloud's embedded player (Widget API). The tests serve a
// stand-in widget (tests/support/fake-mixcloud-widget.js), so they run without the internet
// and check what the app asks the widget to do. Search and Discover use the fake API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, open, playSong, expectPlaying, position } from './helpers.js';

const WIDGET = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'support', 'fake-mixcloud-widget.js'), 'utf8');

test.beforeEach(async ({ context }) => {
  await context.route('https://widget.mixcloud.com/media/js/widgetApi.js', (r) => r.fulfill({ contentType: 'text/javascript', body: WIDGET }));
  await context.route('https://player-widget.mixcloud.com/widget/iframe/?**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>widget</title>' }));
});

const calls = (page, name) => page.evaluate((n) => (window.__mc?.calls || []).filter((c) => c[0] === n), name);
const show = (page, title) => page.locator('#main .tr', { has: page.locator('.tr__title', { hasText: title }) });

test('a show from Search plays, pauses, seeks and sets the volume through the widget', async ({ page }) => {
  await open(page, '/search?q=river&type=sets');
  const section = page.locator('#main .sec', { has: page.locator('.sec__title', { hasText: 'Mixcloud: sets & mixes' }) });
  await expect(section.locator('.tr__title')).toHaveText(['River Sessions #12', 'Late Night Mix']);
  await show(page, 'River Sessions #12').locator('.tr__title').click();

  await expect(page.locator('.scdock.scdock--mixcloud')).toBeVisible();
  await expect(page.locator('.scdock__label')).toHaveText('Mixcloud');
  await expect(page.locator('.scdock iframe')).toHaveAttribute('src', /^https:\/\/player-widget\.mixcloud\.com\/widget\/iframe\/\?feed=%2Fharbor-sessions%2Friver-sessions-12%2F&/);
  await expectPlaying(page);
  await expect(page.locator('.deck__title')).toHaveText('River Sessions #12');

  await page.locator('.deck .dial').hover(); // the buttons show while the mouse is on the bar
  await page.locator('.deck .play').click();
  await expectPlaying(page, false);
  expect((await calls(page, 'pause')).length).toBeGreaterThan(0);
  await page.locator('.deck .play').click();
  await expectPlaying(page, true);

  const box = await page.locator('.deck .dial').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => (await calls(page, 'seek')).at(-1)?.[1] ?? 0).toBeGreaterThan(1500);
  await expect.poll(() => position(page)).toBeGreaterThan(1500);

  await page.locator('.deck .vol').fill('0.3');
  await expect.poll(async () => (await calls(page, 'setVolume')).at(-1)?.[1]).toBeCloseTo(0.3);

  // The next show reuses the same widget (an iPhone keeps the permission a tap gave it).
  await show(page, 'Late Night Mix').locator('.tr__title').click();
  await expect(page.locator('.deck__title')).toHaveText('Late Night Mix');
  expect((await calls(page, 'load')).at(-1)).toEqual(['load', '/lena-moss/late-night-mix/', true]);
  await expect(page.locator('.scdock iframe')).toHaveCount(1);
  await expectPlaying(page);
});

test('switching to another source pauses the widget and hides the dock; the end of a show plays the next', async ({ page }) => {
  await open(page, '/discover?source=mixcloud');
  await expect(page.locator('#main .tr__title')).toHaveText(['River Sessions #12', 'Late Night Mix']);
  await page.locator('#main .chip', { hasText: 'Deep House' }).click();
  await expect(page.locator('#main .tr__title')).toHaveText(['River Sessions #12', 'Late Night Mix']);
  await show(page, 'River Sessions #12').locator('.tr__title').click();
  await expectPlaying(page);
  await page.evaluate(() => window.__mc.end());
  await expect(page.locator('.deck__title')).toHaveText('Late Night Mix');
  await expectPlaying(page);

  await playSong(page, 'Northbound');
  expect(await page.evaluate(() => window.__mc.widgets.at(-1).playing)).toBe(false);
  await expect(page.locator('.scdock')).toBeHidden();
});

// SoundCloud links play through SoundCloud's embedded player (Widget API). The tests serve a
// stand-in widget (tests/support/fake-soundcloud-widget.js), so they run without the internet
// and check what the app asks the widget to do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, open, playSong, expectPlaying, position } from './helpers.js';

const WIDGET = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'support', 'fake-soundcloud-widget.js'), 'utf8');

test.beforeEach(async ({ context }) => {
  await context.route('https://w.soundcloud.com/player/api.js', (r) => r.fulfill({ contentType: 'text/javascript', body: WIDGET }));
  await context.route('https://w.soundcloud.com/player/?**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>widget</title>' }));
});

const calls = (page, name) => page.evaluate((n) => (window.__sc?.calls || []).filter((c) => c[0] === n), name);
const searchFor = (page, url) => open(page, '/search?q=' + encodeURIComponent(url));

test('a pasted track link resolves and plays, pauses, seeks and sets the volume through the widget', async ({ page }) => {
  await searchFor(page, 'Listen: https://soundcloud.com/nadia-vale/slow-river?si=xyz');
  const result = page.locator('#main .tr', { has: page.locator('.tr__title', { hasText: 'Slow River' }) });
  await expect(result).toHaveCount(1);
  await page.locator('#main .btn--primary', { hasText: 'Play' }).click();

  await expect(page.locator('.scdock')).toBeVisible();
  const frame = page.locator('.scdock iframe');
  await expect(frame).toHaveAttribute('src', /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fnadia-vale%2Fslow-river/);
  await expectPlaying(page);
  await expect(page.locator('.deck__title')).toHaveText('Slow River');

  await page.locator('.deck .dial').hover(); // the buttons show while the mouse is on the bar
  await page.locator('.deck .play').click();
  await expectPlaying(page, false);
  expect((await calls(page, 'pause')).length).toBeGreaterThan(0);
  await page.locator('.deck .play').click();
  await expectPlaying(page, true);

  const box = await page.locator('.deck .dial').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => (await calls(page, 'seekTo')).at(-1)?.[1] ?? 0).toBeGreaterThan(80000);
  await expect.poll(() => position(page)).toBeGreaterThan(80);

  await page.locator('.deck .vol').fill('0.3');
  await expect.poll(async () => (await calls(page, 'setVolume')).at(-1)?.[1]).toBe(30);
});

test('a set shows the song that is playing inside it', async ({ page }) => {
  await searchFor(page, 'https://soundcloud.com/nadia-vale/sets/blue-hours');
  await page.locator('#main .btn--primary', { hasText: 'Play' }).click();
  await expectPlaying(page);
  await expect(page.locator('.deck__title')).toHaveText('First Song');
  await expect(page.locator('.deck__artist')).toContainText('Nadia Vale');
  await page.evaluate(() => window.__sc.nextSound());
  await expect(page.locator('.deck__title')).toHaveText('Second Song');
});

test('switching to another source pauses the widget and hides the dock', async ({ page }) => {
  await searchFor(page, 'https://soundcloud.com/nadia-vale/slow-river');
  await page.locator('#main .btn--primary', { hasText: 'Play' }).click();
  await expectPlaying(page);
  const pausesBefore = (await calls(page, 'pause')).length;
  await playSong(page, 'Northbound');
  expect((await calls(page, 'pause')).length).toBeGreaterThan(pausesBefore);
  expect(await page.evaluate(() => window.__sc.widgets.at(-1).playing)).toBe(false);
  await expect(page.locator('.scdock')).toBeHidden();
});

test('links that are not tracks, sets or artists are rejected', async ({ page }) => {
  await searchFor(page, 'https://soundcloud.com/stream');
  await expect(page.locator('#main')).toContainText('Paste a link to a SoundCloud track, set or artist');
  await expect(page.locator('#main .btn--primary', { hasText: 'Play' })).toHaveCount(0);
});

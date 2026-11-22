// Playing music on one device: language switch, seeking, history, lyrics, shortcuts.
import {
  test, expect, open, go, playSong, expectPlaying, position, deckTitle, appModule, sleep, LANGS,
} from './helpers.js';

test('switching language while music plays keeps playing and re-renders the UI', async ({ page }) => {
  await playSong(page, 'Morning Light');
  await go(page, '/settings');
  const expected = { bs: 'Postavke', sr: 'Podešavanja', hr: 'Postavke', de: 'Einstellungen', tr: 'Ayarlar', en: 'Settings' };
  for (const code of [...LANGS.slice(1), 'en']) {
    const before = await position(page);
    await page.locator(`.lang-opt[lang="${code}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator(`.lang-opt[lang="${code}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.nav a[href$="/settings"]')).toContainText(expected[code]);
    await expectPlaying(page);
    expect(await deckTitle(page)).toBe('Morning Light');
    await sleep(1200);
    expect(await position(page)).toBeGreaterThanOrEqual(before);
  }
  // Translated plurals come from Intl.PluralRules categories.
  const plurals = await appModule(page, 'i18n', async (m) => {
    const out = {};
    for (const c of ['bs', 'de']) { await m.setLang(c); out[c] = [1, 3, 5].map((n) => m.plural(n, 'song', 'songs')); }
    await m.setLang('en');
    return out;
  });
  expect(plurals.bs).toEqual(['1 pjesma', '3 pjesme', '5 pjesama']);
  expect(plurals.de).toEqual(['1 Song', '3 Songs', '5 Songs']);
});

test('the dial seeks with the mouse, and the arrow keys seek', async ({ page }) => {
  await playSong(page, 'Slow River'); // 190 s
  const box = await page.locator('.deck .dial').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(() => position(page)).toBeGreaterThan(70);
  expect(await position(page)).toBeLessThan(120);
  const t = await position(page);
  await page.locator('.deck .dial').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(t + 4);
});

test('play, pause and next from the player bar and the keyboard', async ({ page }) => {
  await playSong(page, 'Morning Light');
  await page.locator('.deck .play').click();
  await expectPlaying(page, false);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await expectPlaying(page, true);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.deck__title')).not.toHaveText('Morning Light');
  await expectPlaying(page, true);
});

test('history shows a song once per day with the number of plays', async ({ page, request }) => {
  await request.delete('/api/history', { data: {} });
  const { tracks } = await (await request.get('/api/library')).json();
  const song = tracks.find((t) => t.title === 'Low Tide');
  const other = tracks.find((t) => t.title === 'Northbound');
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  const at = day.getTime() - (Date.now() < day.getTime() ? 86400000 : 0); // earlier today, or noon yesterday
  for (let i = 2; i >= 0; i--) {
    const r = await (await request.post('/api/history', { data: { track: song, at: at - i * 600000 } })).json();
    expect(r.counted).toBe(true);
  }
  // A reload right after does not count again.
  expect((await (await request.post('/api/history', { data: { track: song, at: at + 1000 } })).json()).counted).toBe(false);
  await request.post('/api/history', { data: { track: other, at: at - 3600000 } });

  await open(page, '/history');
  const rows = page.locator('.tr', { has: page.locator('.tr__title', { hasText: 'Low Tide' }) });
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.hist__n')).toHaveText('3×');
  await expect(page.locator('.tr', { has: page.locator('.tr__title', { hasText: 'Northbound' }) }).locator('.hist__n')).toHaveCount(0);
});

test('a song is added to history after half of it has been heard, not after skipping ahead', async ({ page, request }) => {
  await request.delete('/api/history', { data: {} });
  await playSong(page, 'Night Bus'); // 150 s: counts after 75 s of listening
  // Skipping to the end is not listening.
  await appModule(page, 'player', (m) => { m.player.seek(140); });
  await sleep(1500);
  expect((await (await request.get('/api/state')).json()).history).toHaveLength(0);
  await appModule(page, 'player', (m) => { m.player.seek(0); m.player.fx.playbackRate = 6; });
  await expect.poll(async () => (await (await request.get('/api/state')).json()).history.length, { timeout: 30000 }).toBe(1);
  await appModule(page, 'player', (m) => { m.player.fx.playbackRate = 1; });
});

test('lyrics: a .lrc file next to the song, LRCLIB for an exact match, nothing for no match', async ({ page }) => {
  await playSong(page, 'Morning Light');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('t');
  const panel = page.locator('#panel');
  await expect(panel.locator('.lyr__line').first()).toHaveText('First line of the morning');
  await expect(panel.locator('.lyr__line')).toHaveCount(2);

  await playSong(page, 'Slow River');
  await expect(panel.locator('.lyr__line').first()).toHaveText('Down by the slow river');

  await playSong(page, 'Paper Boats');
  await expect(panel.locator('.lyr__msg')).toHaveText('No lyrics for “Paper Boats” in LRCLIB.');
});

test('the queue panel lists what plays next', async ({ page }) => {
  await open(page, '/albums');
  await page.locator('#main a[href*="/album/"]', { hasText: 'Blue Hours' }).first().click();
  await expect(page.locator('#main h1')).toHaveText('Blue Hours');
  await page.locator('#main .tr .tr__play').first().click();
  await expectPlaying(page);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('q');
  await expect(page.locator('#panel')).toContainText('Slow River');
  await expect(page.locator('#panel')).toContainText('Paper Boats');
});

test('Media Session shows the song and handles the lock-screen buttons', async ({ page }) => {
  // Keep a copy of the handlers the app registers, so the test can press the buttons.
  await page.addInitScript(() => {
    window.__ms = {};
    const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, fn) => { window.__ms[action] = fn; return orig(action, fn); };
  });
  await playSong(page, 'Northbound');
  const meta = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, album: navigator.mediaSession.metadata?.album }));
  expect(meta).toEqual({ title: 'Northbound', artist: 'The Fen Lights', album: 'Static' });
  const actions = await page.evaluate(() => Object.keys(window.__ms));
  expect(actions).toEqual(expect.arrayContaining(['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']));
  await page.evaluate(() => window.__ms.pause());
  await expectPlaying(page, false);
  await page.evaluate(() => window.__ms.play());
  await expectPlaying(page, true);
  await page.evaluate(() => window.__ms.seekto({ seekTime: 100 }));
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(100);
  await page.evaluate(() => window.__ms.nexttrack());
  await expect(page.locator('.deck__title')).not.toHaveText('Northbound');
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).not.toBe('Northbound');
});

test('deleting the history and a playlist from the UI works', async ({ page, request }) => {
  const { tracks } = await (await request.get('/api/library')).json();
  await request.post('/api/history', { data: { track: tracks[0], at: Date.now() - 3600000 } });
  const p = await (await request.post('/api/playlists', { data: { name: 'To delete', tracks: tracks.slice(0, 2) } })).json();

  await open(page, '/history');
  await page.locator('#main .btn', { hasText: 'Delete history' }).click();
  await page.locator('dialog.dlg .btn--danger').click();
  await expect(page.locator('#main .empty')).toBeVisible();
  expect((await (await request.get('/api/state')).json()).history).toEqual([]);

  await open(page, `/playlist/${p.id}`);
  await page.locator('#main .btn', { hasText: /^Delete$/ }).click();
  await page.locator('dialog.dlg .btn--danger').click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).playlists.some((x) => x.id === p.id)).toBe(false);
  await expect(page.locator('.nav a', { hasText: 'To delete' })).toHaveCount(0);
});

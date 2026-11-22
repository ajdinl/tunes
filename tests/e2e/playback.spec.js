// Playing music on one device: language switch, seeking, history, lyrics, shortcuts.
import {
  test, expect, open, go, settle, playSong, expectPlaying, position, deckTitle, appModule, sleep, LANGS,
} from './helpers.js';

test('switching language while music plays keeps playing and re-renders the UI', async ({ page }) => {
  await playSong(page, 'Morning Light');
  await go(page, '/settings');
  const expected = {
    bs: 'Postavke', sr: 'Podešavanja', hr: 'Postavke', sl: 'Nastavitve', mk: 'Поставки', sq: 'Cilësimet',
    de: 'Einstellungen', es: 'Ajustes', fr: 'Paramètres', pt: 'Configurações', tr: 'Ayarlar', en: 'Settings',
  };
  for (const code of [...LANGS.slice(1), 'en']) {
    const before = await position(page);
    await page.locator('.lang-select').selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('.lang-select')).toHaveValue(code);
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

test('player styles: picked in Settings, remembered on this device, seeking still works', async ({ page }) => {
  await playSong(page, 'Slow River');
  await open(page, '/settings');
  const dial = page.locator('.deck .dial');
  await expect(dial).toHaveAttribute('data-style', 'dial');
  for (const style of ['calm', 'minimal', 'color', 'mirror']) {
    await page.locator(`.dial-opt[data-style="${style}"]`).click();
    await expect(page.locator(`.dial-opt[data-style="${style}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(dial).toHaveAttribute('data-style', style);
  }
  await page.locator('.dial-opt[data-style="minimal"]').click();
  await page.reload();
  await settle(page);
  await expect(page.locator('.deck .dial')).toHaveAttribute('data-style', 'minimal');
  await page.locator('.deck .play').click();
  await expectPlaying(page);
  const box = await page.locator('.deck .dial').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(() => position(page)).toBeGreaterThan(70);
  await page.locator('.dial-opt[data-style="dial"]').click();
});

test('mini player: a small window with the song and the controls', async ({ page, context }) => {
  // A same-origin popup stands in for the picture-in-picture window (the test can drive it
  // like a page); the app renders into it exactly as into the real one.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow: async ({ width, height }) => window.open('', 'tunes-mini', `width=${width},height=${height}`) },
    });
  });
  await playSong(page, 'Paper Boats');
  const button = page.locator('.deck [aria-label="Mini player"]');
  await expect(button).toBeVisible();
  const [mini] = await Promise.all([context.waitForEvent('page'), button.click()]);
  await expect(mini.locator('.mini__title')).toHaveText('Paper Boats');
  await expect(mini.locator('.mini__artist')).toHaveText('Nadia Vale');
  // The app's styles came along.
  await expect.poll(() => mini.evaluate(() => getComputedStyle(document.querySelector('.mini')).display)).toBe('flex');
  await expect(page.locator('.deck [aria-label="Close mini player"]')).toHaveAttribute('aria-pressed', 'true');

  await mini.locator('.mini .play').click();
  await expectPlaying(page, false);
  await mini.locator('.mini .play').click();
  await expectPlaying(page, true);
  await mini.locator('.mini [aria-label="Next"]').click();
  await expect(page.locator('.deck__title')).toHaveText(await mini.locator('.mini__title').textContent());
  await expect(mini.locator('.mini__title')).not.toHaveText('Paper Boats');
  const box = await mini.locator('.mini__bar').boundingBox();
  await mini.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(() => position(page)).toBeGreaterThan(60);

  await mini.close();
  await expect(page.locator('.deck [aria-label="Mini player"]')).toHaveAttribute('aria-pressed', 'false');
});

test('mini player in Safari: a picture-in-picture video drawn from the song', async ({ page }) => {
  // Safari has no Document Picture-in-Picture, only video picture-in-picture. Chromium plays
  // Safari here: no picture-in-picture window, and the video's window is simulated (the test
  // presses its play/pause button by calling play() and pause() on the video).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, get: () => true });
    let inPip = null;
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => inPip });
    HTMLVideoElement.prototype.requestPictureInPicture = function () {
      if (this.readyState < 1) return Promise.reject(new DOMException('No frame yet', 'InvalidStateError'));
      inPip = this;
      this.dispatchEvent(new Event('enterpictureinpicture'));
      return Promise.resolve({ width: 320, height: 120 });
    };
    document.exitPictureInPicture = async () => {
      const v = inPip;
      inPip = null;
      v?.dispatchEvent(new Event('leavepictureinpicture'));
    };
  });
  await playSong(page, 'Paper Boats');
  const video = page.locator('.mini-video');
  const button = page.locator('.deck [aria-label="Mini player"]');
  await expect(button).toBeVisible();
  // Ready before the click (Safari allows picture-in-picture only right inside it).
  await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);

  await button.click();
  await expect(page.locator('.deck [aria-label="Close mini player"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(video).toHaveAttribute('data-song', 'Paper Boats – Nadia Vale');
  await expect.poll(() => video.evaluate((v) => v.paused)).toBe(false); // follows the music

  // The picture: the progress line along the bottom is drawn in amber up to the position.
  await page.locator('.deck .play').click();
  await expectPlaying(page, false);
  const box = await page.locator('.deck .dial').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  const pixel = (fx) => video.evaluate((v, f) => {
    const c = v.srcObject.getVideoTracks()[0].canvas;
    return [...c.getContext('2d').getImageData(Math.round(c.width * f), c.height - 4, 1, 1).data].slice(0, 3);
  }, fx);
  await expect.poll(() => pixel(0.3)).toEqual([255, 181, 71]);
  expect(await pixel(0.9)).not.toEqual([255, 181, 71]);
  await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);

  // The window's play/pause button drives the player.
  await video.evaluate((v) => v.play());
  await expectPlaying(page, true);
  await video.evaluate((v) => v.pause());
  await expectPlaying(page, false);
  await video.evaluate((v) => v.play());
  await expectPlaying(page, true);

  // Next (from the window's Media Session buttons or anywhere else) shows the new song.
  await appModule(page, 'player', (m) => m.player.next());
  const next = await deckTitle(page);
  expect(next).not.toBe('Paper Boats');
  await expect(video).toHaveAttribute('data-song', new RegExp('^' + next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' – '));

  await page.locator('.deck [aria-label="Close mini player"]').click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);
  await expectPlaying(page, true); // closing the window doesn't stop the music

  // Safari's own close button pauses the video first and only then closes the window:
  // the music keeps playing.
  await button.click();
  await expect.poll(() => video.evaluate((v) => v.paused)).toBe(false);
  await video.evaluate((v) => { v.pause(); setTimeout(() => document.exitPictureInPicture(), 50); });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await sleep(800);
  await expectPlaying(page, true);
});

test('mini player button is hidden where the browser has no picture-in-picture at all', async ({ page }) => {
  // Like Firefox.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, get: () => false });
  });
  await playSong(page, 'Paper Boats');
  await expect(page.locator('.deck [aria-label="Mini player"]')).toHaveCount(0);
  await expect(page.locator('.mini-video')).toHaveCount(0);
});

test('player buttons: above the dial, beside it in one row, or only on hover', async ({ page }) => {
  await playSong(page, 'Slow River');
  const deck = page.locator('.deck');
  const ctrls = page.locator('.deck .deck__ctrls');
  const play = ctrls.locator('.play');
  const dial = page.locator('.deck .dial');
  const height = async () => (await deck.boundingBox()).height;
  const opacity = () => ctrls.evaluate((el) => getComputedStyle(el).opacity);
  const before = await height();
  const expectTipClear = async () => {
    for (const style of ['minimal', 'dial']) { // ends on the default style
      await page.locator(`.dial-opt[data-style="${style}"]`).click();
      const db = await dial.boundingBox();
      await page.mouse.move(db.x + db.width * 0.42, db.y + db.height / 2);
      const tip = page.locator('.deck .dial__tip');
      await expect(tip).toBeVisible();
      const tb = await tip.boundingBox();
      const cb = await ctrls.boundingBox();
      expect(tb.y, style).toBeGreaterThanOrEqual(db.y);
      expect(tb.y > cb.y + cb.height || tb.x + tb.width < cb.x || tb.x > cb.x + cb.width, `${style}: tip under the buttons`).toBe(true);
    }
  };
  await go(page, '/settings'); // no reload: the music keeps playing
  await expectPlaying(page, true);
  const pick = async (value) => {
    await page.locator(`.ctrls-opt[data-ctrls="${value}"]`).click();
    await expect(page.locator(`.ctrls-opt[data-ctrls="${value}"]`)).toHaveAttribute('aria-pressed', 'true');
  };
  // Above (the default): the buttons sit over the dial; the song and the tools line up with the dial.
  await expect(page.locator('.ctrls-opt[data-ctrls="above"]')).toHaveAttribute('aria-pressed', 'true');
  const mid = (b) => b.y + b.height / 2;
  expect((await ctrls.boundingBox()).y + 20).toBeLessThan((await dial.boundingBox()).y);
  expect(Math.abs(mid(await page.locator('.deck__now').boundingBox()) - mid(await dial.boundingBox()))).toBeLessThan(6);
  await expectTipClear();
  // Minimal is only a line: a lower dial, closer to the buttons, and a lower bar.
  await page.locator('.dial-opt[data-style="minimal"]').click();
  await expect.poll(height).toBeLessThan(before - 10);
  expect(Math.abs(mid(await page.locator('.deck__now').boundingBox()) - mid(await dial.boundingBox()))).toBeLessThan(6);
  const deckBox = await deck.boundingBox();
  const cover = await page.locator('.deck__cv').boundingBox();
  expect(cover.y + cover.height).toBeLessThanOrEqual(deckBox.y + deckBox.height); // the cover still fits
  await page.locator('.dial-opt[data-style="dial"]').click();

  // Beside: one row, like SoundCloud, and a lower bar.
  await pick('beside');
  await expect(page.locator('body')).toHaveClass(/deck-row/);
  await expect.poll(height).toBeLessThan(before - 20);
  expect(Math.abs(mid(await ctrls.boundingBox()) - mid(await dial.boundingBox()))).toBeLessThan(6);
  expect((await ctrls.boundingBox()).x + (await ctrls.boundingBox()).width).toBeLessThan((await dial.boundingBox()).x);
  await play.click();
  await expectPlaying(page, false);
  await play.click();
  await expectPlaying(page, true);

  // Only on hover: a lower bar, the buttons float up over it while the mouse is on the bar.
  await pick('hover');
  await expect(page.locator('body')).toHaveClass(/deck-hover/);
  await expect(page.locator('body')).not.toHaveClass(/deck-row/);
  await page.mouse.move(10, 10);
  await expect.poll(height).toBeLessThan(before - 20);
  await expect.poll(opacity).toBe('0');
  await page.locator('.deck__dial').hover();
  await expect.poll(opacity).toBe('1');
  // The time under the mouse stays visible: inside the dial, not behind the buttons.
  await expectTipClear();
  await page.locator('.deck__dial').hover();
  await play.click();
  await expectPlaying(page, false);
  // The keyboard still works while they are hidden.
  await page.mouse.move(10, 10);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await expectPlaying(page, true);

  // Remembered on this device.
  await page.reload();
  await settle(page);
  await expect(page.locator('body')).toHaveClass(/deck-hover/);
  await pick('above');
  await expect(page.locator('body')).not.toHaveClass(/deck-hover|deck-row/);
  await expect.poll(opacity).toBe('1');
  await expect.poll(height).toBe(before);
});

// The phone: touch seeking on the dial, the slide-out menu, and iPhone details.
import { test, expect, open, playSong, position, appModule, touch, sleep } from './helpers.js';

test('dial: a vertical swipe does not seek, a tap and a sideways drag do', async ({ device }) => {
  const phone = await device({ mobile: true });
  await playSong(phone, 'Morning Light'); // 200 s
  // On phones the dial is in Now Playing (a tap on the compact bar opens it).
  await phone.locator('.deck__meta').tap();
  const box = await phone.locator('.now .dial').boundingBox();
  const cy = box.y + box.height / 2;
  const at = (f) => ({ x: box.x + box.width * f, y: cy });
  const t = await touch(phone);

  // Swiping up from the dial (closing the app from the home bar) must not move the song.
  const t0 = await position(phone);
  await t.swipe(at(0.7), { x: box.x + box.width * 0.7 + 6, y: cy - 90 });
  await sleep(400);
  expect(await position(phone)).toBeLessThanOrEqual(t0 + 2);

  // A tap at the middle seeks to about half.
  await t.tap(at(0.5).x, cy);
  await expect.poll(() => position(phone)).toBeGreaterThan(80);
  expect(await position(phone)).toBeLessThan(120);

  // Dragging sideways to the left seeks back.
  await t.swipe(at(0.5), { x: box.x + box.width * 0.2, y: cy + 2 }, 10);
  await expect.poll(() => position(phone)).toBeLessThan(60);
});

test('menu: opens from the button, closes on a tap outside and on Escape', async ({ device }) => {
  const phone = await device({ mobile: true });
  await open(phone, '/');
  const isOpen = () => phone.evaluate(() => document.body.classList.contains('nav-open'));
  await phone.locator('#navToggle').tap();
  await expect.poll(isOpen).toBe(true);
  await expect(phone.locator('#navToggle')).toHaveAttribute('aria-expanded', 'true');

  // Wait for the slide-in animation to finish.
  const sideLeft = () => phone.evaluate(() => Math.round(document.getElementById('side').getBoundingClientRect().left));
  await expect.poll(sideLeft).toBe(0);
  // A tap on an empty spot inside the menu keeps it open.
  // (the spot farthest from any link or button: touch input snaps to nearby targets)
  const inside = await phone.evaluate(() => {
    const side = document.getElementById('side');
    const r = side.getBoundingClientRect();
    const targets = [...side.querySelectorAll('a,button,input')].map((el) => el.getBoundingClientRect()).filter((b) => b.width);
    const dist = (x, y) => Math.min(...targets.map((b) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom))));
    let best = null;
    for (let y = r.top + 20; y < r.bottom - 20; y += 8) {
      for (let x = r.left + 20; x < r.right - 20; x += 8) {
        const d = dist(x, y);
        if (!best || d > best.d) best = { x, y, d };
      }
    }
    return best && best.d >= 16 ? best : null;
  });
  expect(inside).not.toBeNull();
  await phone.touchscreen.tap(inside.x, inside.y);
  await sleep(300);
  expect(await isOpen()).toBe(true);

  await phone.touchscreen.tap(370, 500); // outside the menu (it is about 300 px wide)
  await expect.poll(isOpen).toBe(false);
  await expect(phone.locator('#navToggle')).toHaveAttribute('aria-expanded', 'false');

  await phone.locator('#navToggle').tap();
  await expect.poll(isOpen).toBe(true);
  await phone.keyboard.press('Escape');
  await expect.poll(isOpen).toBe(false);

  // Following a link closes it too.
  await phone.locator('#navToggle').tap();
  await phone.locator('.nav a[href$="/songs"]').tap();
  await expect.poll(isOpen).toBe(false);
  await expect(phone.locator('#main h1')).toBeVisible();
});

test('iPhone: opaque status bar, safe areas, and no Web Audio graph on mobile', async ({ device }) => {
  const phone = await device({ mobile: true });
  await playSong(phone, 'Slow River');
  await expect(phone.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black');
  await expect(phone.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  const cssUrl = await phone.locator('link[rel="stylesheet"][href*="/assets/"]').getAttribute('href');
  const css = await (await phone.request.get(cssUrl)).text();
  for (const side of ['top', 'bottom', 'left', 'right']) expect(css).toContain(`env(safe-area-inset-${side}`);
  // iOS stops audio that goes through Web Audio when the screen locks.
  expect(await appModule(phone, 'player', (m) => ({ mobile: m.player.mobile, graph: Boolean(m.player.ctx) }))).toEqual({ mobile: true, graph: false });
});

test('desktop uses the Web Audio graph (equalizer and spectrum)', async ({ page }) => {
  await playSong(page, 'Slow River');
  expect(await appModule(page, 'player', (m) => ({ mobile: m.player.mobile, graph: Boolean(m.player.ctx), filters: m.player.filters?.length }))).toEqual({ mobile: false, graph: true, filters: 10 });
});

test('tooltips show right away on mouse hover, not on touch', async ({ page, device }) => {
  await playSong(page, 'Northbound');
  const tip = page.locator('.tip.is-on');
  const shuffle = page.locator('.deck__ctrls .ibtn').first();
  await page.locator('.deck .dial').hover(); // the player buttons show while the mouse is on the bar
  await shuffle.hover();
  await expect(tip).toHaveText('Shuffle (S)', { timeout: 500 });
  // No native title on top of it (the browser's own tooltip would show after ~2 s).
  expect(await shuffle.getAttribute('title')).toBeNull();
  // Elements with a title get the same quick tooltip.
  await page.locator('.deck__title').hover();
  await expect(tip).toHaveText('Playing from: All songs', { timeout: 500 });
  // A link whose text is already visible gets none; in the folded sidebar it does.
  await page.locator('.nav a[href="/songs"]').hover();
  await expect(tip).toHaveCount(0);
  await page.locator('.side__toggle').click();
  await page.locator('.nav a[href="/songs"]').hover();
  await expect(tip).toHaveText('Songs', { timeout: 500 });
  // Every item of the folded menu has one, the buttons at the bottom too.
  const missing = await page.evaluate(() => [...document.querySelectorAll('#side .nav__link')]
    .filter((el) => !(el.dataset.tip || el.getAttribute('title') || el.getAttribute('aria-label'))).map((el) => el.outerHTML.slice(0, 80)));
  expect(missing).toEqual([]);
  await page.locator('.nav__phone:not(.nav__install)').hover();
  await expect(tip).toHaveText('Listen on phone', { timeout: 500 });
  await page.locator('.side__toggle').click();
  await page.mouse.move(700, 300);
  await expect(tip).toHaveCount(0);

  const phone = await device({ mobile: true });
  await playSong(phone, 'Low Tide');
  await phone.locator('.deck .deck__mplay').tap();
  await expect(phone.locator('.tip.is-on')).toHaveCount(0);
});

test('player bar: the dial shrinks instead of running under the buttons', async ({ device }) => {
  const page = await device();
  await playSong(page, 'Morning Light');
  for (const width of [1600, 1440, 1300, 1241, 1100, 900, 861]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const end = document.querySelector('.deck .deck__time--end').getBoundingClientRect();
      const dial = document.querySelector('.deck .dial').getBoundingClientRect();
      const tools = document.querySelector('.deck__tools').getBoundingClientRect();
      const first = document.querySelector('.deck__tools > *').getBoundingClientRect();
      return { gap: Math.round(first.left - end.right), dial: Math.round(dial.width), toolsFit: tools.right <= innerWidth + 1 };
    });
    expect(r.gap, `room between the dial and the buttons at ${width}px`).toBeGreaterThanOrEqual(16);
    expect(r.toolsFit, `buttons inside the window at ${width}px`).toBe(true);
    expect(r.dial, `dial width at ${width}px`).toBeGreaterThan(190);
  }
});

test('sidebar: the playlist section never runs over the items at the bottom', async ({ device }) => {
  const page = await device();
  await open(page, '/');
  for (const height of [900, 700, 560, 480]) {
    await page.setViewportSize({ width: 1300, height });
    await page.waitForTimeout(120);
    // What is actually drawn in the middle of each bottom item must be that item.
    // (In a very short window the menu scrolls: bring each item into view first.)
    const covered = await page.evaluate(() => [...document.querySelectorAll('.nav--foot .nav__link')].filter((el) => {
      el.scrollIntoView({ block: 'nearest' });
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !hit || !el.contains(hit);
    }).map((el) => el.textContent));
    expect(covered, `bottom items covered at ${height}px`).toEqual([]);
    // Nothing from the playlist section may show below its own box (over the items under it).
    const spill = await page.evaluate(() => {
      const lists = document.querySelector('.nav--lists');
      const lb = lists.getBoundingClientRect();
      const clipped = getComputedStyle(lists).overflowY !== 'visible';
      return [...lists.querySelectorAll('*')].filter((el) => {
        const b = el.getBoundingClientRect();
        return b.height > 0 && (clipped ? Math.min(b.bottom, lb.bottom) : b.bottom) > lb.bottom + 0.5;
      }).map((el) => el.textContent.slice(0, 40));
    });
    expect(spill, `playlist section spills at ${height}px`).toEqual([]);
  }
});

test('menu handles: drag the line to fold the bottom items, drag the edge to fold the menu', async ({ device }) => {
  const page = await device();
  await open(page, '/');
  const foot = page.locator('.nav--foot');
  const grip = page.locator('.nav__grip');
  let b = await grip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(foot).toHaveClass(/is-compact/);
  // One row of icons, each with a tooltip.
  const tops = await foot.locator('.nav__link').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(foot.locator('.nav__link span:not(.ic):not(.nav__dot)').first()).toBeHidden();
  await foot.locator('a[href="/settings"]').hover();
  await expect(page.locator('.tip.is-on')).toHaveText('Settings');
  // Remembered.
  await page.reload();
  await expect(page.locator('.nav--foot')).toHaveClass(/is-compact/);
  // Back with the keyboard.
  await page.locator('.nav__grip').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.nav--foot')).not.toHaveClass(/is-compact/);

  // The right edge of the menu.
  const edge = page.locator('.side__edge');
  b = await edge.boundingBox();
  await page.mouse.move(b.x + 3, 300);
  await page.mouse.down();
  await page.mouse.move(b.x - 80, 300, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('body')).toHaveClass(/side-mini/);
  b = await page.locator('.side__edge').boundingBox();
  await page.mouse.move(b.x + 3, 300);
  await page.mouse.down();
  await page.mouse.move(b.x + 90, 300, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('body')).not.toHaveClass(/side-mini/);
});

test('phone: always the Minimal player style, nothing to choose, no equalizer', async ({ device, request }) => {
  const computer = await device();
  await open(computer, '/settings');
  await computer.locator('.dial-opt[data-style="mirror"]').click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).settings.prefs.dialStyle).toBe('mirror');

  // The phone has no Web Audio graph, so no spectrum and no equalizer.
  const phone = await device({ mobile: true });
  await playSong(phone, 'Morning Light');
  await expect(phone.locator('.deck [aria-label="Equalizer (E)"]')).toHaveCount(0);
  // The compact bar: song, heart, queue and play; the rest is in Now Playing.
  await expect(phone.locator('.deck .deck__center')).toBeHidden();
  await expect(phone.locator('.deck .deck__queue')).toBeVisible();
  await expect(phone.locator('.deck .deck__mplay')).toBeVisible();
  await expect(phone.locator('.deck [aria-label="Sleep timer"]')).toBeHidden();
  await phone.locator('.deck__meta').tap();
  await expect(phone.locator('.now .dial')).toHaveAttribute('data-style', 'minimal'); // not the computer's Mirror
  await expect(phone.locator('.now [aria-label="Sleep timer"]')).toBeVisible();
  await expect(phone.locator('.now [aria-label="Lyrics (T)"]')).toHaveCount(0); // one button for the queue and lyrics
  await expect(phone.locator('.now__share')).toHaveCount(0); // a file on the computer can't be shared
  // No room for the queue next to the cover: it opens in the side panel.
  await phone.locator('.now__queuebtn').tap();
  await expect(phone.locator('.now')).toBeHidden();
  await expect(phone.locator('#panel .queue')).toBeVisible();
  await phone.locator('#panel [aria-label="Close panel"]').tap();
  await phone.locator('.deck__meta').tap();
  await phone.locator('.now__close').tap();
  await open(phone, '/settings');
  await expect(phone.locator('.dial-opt')).toHaveCount(0); // no player style picker
  await expect(phone.locator('.ctrls-opt')).toHaveCount(0); // player button layout is for computers
  // Even a phone choice saved by an older version doesn't apply any more.
  await phone.evaluate(() => localStorage.setItem('tunes.dialStylePhone', JSON.stringify('calm')));
  await phone.reload();
  await phone.locator('.deck__meta').tap();
  await expect(phone.locator('.now .dial')).toHaveAttribute('data-style', 'minimal');
  await expect(computer.locator('.deck .dial')).toHaveAttribute('data-style', 'mirror');
});

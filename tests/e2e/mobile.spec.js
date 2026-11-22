// The phone: touch seeking on the dial, the slide-out menu, and iPhone details.
import { test, expect, open, playSong, position, appModule, touch, sleep } from './helpers.js';

test('dial: a vertical swipe does not seek, a tap and a sideways drag do', async ({ device }) => {
  const phone = await device({ mobile: true });
  await playSong(phone, 'Morning Light'); // 200 s
  const box = await phone.locator('.deck .dial').boundingBox();
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
  await open(phone, '#/');
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
  await phone.locator('.nav a[href="#/songs"]').tap();
  await expect.poll(isOpen).toBe(false);
  await expect(phone.locator('#main h1')).toBeVisible();
});

test('iPhone: opaque status bar, safe areas, and no Web Audio graph on mobile', async ({ device }) => {
  const phone = await device({ mobile: true });
  await playSong(phone, 'Slow River');
  await expect(phone.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black');
  await expect(phone.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  const css = await (await phone.request.get('/css/app.css')).text();
  for (const side of ['top', 'bottom', 'left', 'right']) expect(css).toContain(`env(safe-area-inset-${side}`);
  // iOS stops audio that goes through Web Audio when the screen locks.
  expect(await appModule(phone, 'player', (m) => ({ mobile: m.player.mobile, graph: Boolean(m.player.ctx) }))).toEqual({ mobile: true, graph: false });
});

test('desktop uses the Web Audio graph (equalizer and spectrum)', async ({ page }) => {
  await playSong(page, 'Slow River');
  expect(await appModule(page, 'player', (m) => ({ mobile: m.player.mobile, graph: Boolean(m.player.ctx), filters: m.player.filters?.length }))).toEqual({ mobile: false, graph: true, filters: 10 });
});

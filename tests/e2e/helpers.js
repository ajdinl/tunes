// Shared helpers for the end-to-end tests.
//
// The tests drive the app through the DOM and the class names from css/app.css (.tr, .deck,
// .handoff, body.is-playing …). The React port keeps app.css, so they keep working. The few
// places that reach into app internals go through appModule() below: update it in one place
// when the module layout changes.
import { test as base, expect } from '@playwright/test';

export { expect };

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const LANGS = ['en', 'bs', 'sr', 'hr', 'de', 'tr'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Host names that reach the test server. phone.local is mapped to 127.0.0.1 (playwright.config.js).
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', 'phone.local'];
export const phoneURL = (baseURL, hash = '#/') => baseURL.replace('127.0.0.1', 'phone.local') + '/' + hash;

// Every page and context the test opens: page errors fail the test, and requests leave
// 127.0.0.1 only when a test routes them itself (the fake SoundCloud widget).
// API requests in flight per page (not the event stream or audio), so settle() can wait for them.
const inflight = new WeakMap();
function trackRequests(page) {
  const set = new Set();
  inflight.set(page, set);
  page.on('request', (r) => { if (/\/api\/(?!events|stream)/.test(r.url())) set.add(r); });
  const done = (r) => set.delete(r);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
}

async function prepareContext(context, errors) {
  await context.route((url) => !LOCAL_HOSTS.includes(url.hostname) && !url.protocol.startsWith('blob') && !url.protocol.startsWith('data'),
    (route) => route.abort('internetdisconnected'));
  context.on('page', (page) => {
    trackRequests(page);
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  });
}

export const test = base.extend({
  pageErrors: [async ({}, use) => {
    const errors = [];
    await use(errors);
    expect(errors, 'page errors').toEqual([]);
  }, { auto: true }],

  context: async ({ context, pageErrors }, use) => {
    await prepareContext(context, pageErrors);
    await use(context);
  },

  // Opens another device: its own browser context (own storage), desktop or iPhone.
  device: async ({ browser, pageErrors, baseURL }, use) => {
    const contexts = [];
    await use(async ({ mobile = false } = {}) => {
      const context = await browser.newContext({
        baseURL,
        locale: 'en-GB',
        ...(mobile
          ? { userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
          : { viewport: { width: 1440, height: 900 } }),
      });
      contexts.push(context);
      await prepareContext(context, pageErrors);
      return context.newPage();
    });
    for (const c of contexts) await c.close();
  },
});

// Opens the app at a hash route and waits until the screen has rendered.
export async function open(page, hash = '#/') {
  await page.goto('/' + hash);
  await settle(page);
}

// Waits until the screen is drawn: no loading indicator and no API request in flight, twice in a row.
export async function settle(page) {
  await page.locator('#main > *').first().waitFor();
  const quiet = () => page.evaluate(() => !document.querySelector('#main .loading')).then((noSpinner) => noSpinner && !(inflight.get(page)?.size));
  const deadline = Date.now() + 15000;
  let calm = 0;
  while (calm < 2) {
    if (Date.now() > deadline) throw new Error('Screen did not finish loading: ' + page.url());
    calm = (await quiet()) ? calm + 1 : 0;
    await sleep(120);
  }
}

// Changes the route inside the running app (no reload) and waits for the new screen.
export async function go(page, hash) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('#main > *')?.setAttribute('data-stale', '');
  });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.locator('#main > :not([data-stale])').first().waitFor();
  await settle(page);
}

export async function setLanguage(page, code) {
  await page.evaluate((c) => localStorage.setItem('tunes.lang', JSON.stringify(c)), code);
}

export const isPlaying = (page) => page.evaluate(() => document.body.classList.contains('is-playing'));

export async function expectPlaying(page, playing = true, timeout = 10000) {
  await expect.poll(() => isPlaying(page), { timeout }).toBe(playing);
}

// Current position from the player bar ("1:23") in seconds.
export async function position(page) {
  const text = await page.locator('.deck__time').first().textContent();
  const parts = text.trim().split(':').map(Number);
  return parts.reduce((a, b) => a * 60 + b, 0);
}

export const deckTitle = (page) => page.locator('.deck__title').textContent();

// Plays a song from the Songs screen by its title.
export async function playSong(page, title) {
  if (!page.url().includes('#/songs')) await open(page, '#/songs');
  const row = page.locator('.tr', { has: page.locator('.tr__title', { hasText: new RegExp(`^${title}$`) }) });
  await row.locator('.tr__play').click();
  await expect(page.locator('.deck__title')).toHaveText(title);
  await expectPlaying(page);
}

export async function toasts(page) {
  return page.locator('.toast').allTextContents();
}

// App modules inside the page (internals; see the note at the top).
export function appModule(page, name, fn, arg) {
  return page.evaluate(async ({ name, fn, arg }) => {
    const mod = await import(`/js/${name}.js`);
    return new Function('mod', 'arg', `return (${fn})(mod, arg);`)(mod, arg);
  }, { name, fn: fn.toString(), arg });
}

// Low-level touch input (Chromium DevTools protocol): Playwright has tap() but no drag.
export async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  return {
    async swipe(from, to, steps = 8) {
      await send('touchStart', from.x, from.y);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        await sleep(16);
      }
      await send('touchEnd');
    },
    async tap(x, y) { await send('touchStart', x, y); await sleep(30); await send('touchEnd'); },
  };
}

export { sleep };

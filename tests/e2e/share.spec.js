// Sharing a song by link, and the one button for the queue and lyrics.
import { test, expect, open, playSong } from './helpers.js';

test('share a song: a link that carries it, a QR code; nothing to share for files on the computer', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await playSong(page, 'Morning Light');
  await page.locator('.deck .dial').hover();
  await expect(page.locator('.deck__share')).toHaveCount(0);
  await page.locator('#main .tr', { hasText: 'Morning Light' }).click({ button: 'right' });
  await expect(page.locator('.menu:not(.menu--sub)')).toBeVisible();
  await expect(page.locator('.menu__item', { hasText: /^Share$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // An Audius song from Discover (answered by the fake internet).
  await open(page, '/discover');
  const row = page.locator('#main .tr', { hasText: 'Harbor Lights' }).first();
  await row.locator('.tr__play').click();
  await expect(page.locator('.deck__title')).toHaveText('Harbor Lights');
  await page.locator('.deck .dial').hover();
  await page.locator('.deck__share').click();
  const dlg = page.getByRole('dialog', { name: 'Share song' });
  await expect(dlg.locator('.dlg__title')).toHaveText('Share song');
  await expect(dlg.locator('.share__title')).toHaveText('Harbor Lights');
  const link = await dlg.locator('.share__link').inputValue();
  expect(link).toMatch(/^https:\/\/ajdinl\.github\.io\/tunes\/shared#[\w-]+$/);
  await expect(dlg.locator('.share__qr svg')).toBeVisible();
  await dlg.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.locator('.toast').last()).toContainText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toHaveCount(0);

  // The same from the song's ⋯ menu.
  await row.click({ button: 'right' });
  await page.locator('.menu__item', { hasText: /^Share$/ }).click();
  await expect(dlg.locator('.share__link')).toHaveValue(link);
});

test('one button opens the queue and lyrics on the tab used last; a queued song plays from its cover', async ({ page }) => {
  await playSong(page, 'Morning Light');
  await page.locator('.deck .dial').hover();
  const btn = page.locator('.deck__queue');
  const panel = page.locator('#panel');
  await btn.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.tab[data-tab="queue"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('t');
  await expect(panel.locator('.tab[data-tab="lyrics"]')).toHaveAttribute('aria-selected', 'true');
  await btn.click();
  await expect(panel).toBeHidden();
  await btn.click();
  await expect(panel.locator('.tab[data-tab="lyrics"]')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('q');
  const next = panel.locator('.queue__list .qr').first();
  const title = await next.locator('.qr__title').textContent();
  await next.hover();
  await expect(next.locator('.qr__play')).toBeVisible();
  await next.locator('.qr__cvbtn').click();
  await expect(page.locator('.deck__title')).toHaveText(title);
});

// Sharing a song or a playlist by link, and the one button for the queue and lyrics.
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

test('share a playlist: files on the computer are left out; the link opens it ready to play and keep', async ({ page, request }) => {
  const { tracks } = await (await request.get('/api/library')).json();
  const harbor = {
    id: 'audius:D7KyD', source: 'audius', title: 'Harbor Lights', artist: 'Nadia Vale', duration: 245,
    cover: '/api/img?u=' + encodeURIComponent('https://creatornode.example/content/abc/480x480.jpg'), stream: '/api/stream/audius/D7KyD',
  };
  const mine = await (await request.post('/api/playlists', { data: { name: 'Road trip', tracks: [tracks[0], harbor, tracks[1]] } })).json();
  const onlyLocal = await (await request.post('/api/playlists', { data: { name: 'Only mine', tracks: tracks.slice(0, 2) } })).json();
  try {
    // Nothing to share when every song is a file on this computer.
    await open(page, `/playlist/${onlyLocal.id}`);
    await expect(page.locator('#main h1')).toHaveText('Only mine');
    await expect(page.locator('.pl__share')).toHaveCount(0);

    await open(page, `/playlist/${mine.id}`);
    await page.locator('.pl__share').click();
    const dlg = page.getByRole('dialog', { name: 'Share playlist' });
    await expect(dlg.locator('.share__title')).toHaveText('Road trip');
    await expect(dlg.locator('.share__artist')).toHaveText('1 song');
    await expect(dlg.locator('.share__left')).toHaveText('Left out because others can’t play them: 2 songs');
    await expect(dlg.locator('.share__qr svg')).toBeVisible();
    const link = await dlg.locator('.share__link').inputValue();
    expect(link).toMatch(/^https:\/\/ajdinl\.github\.io\/tunes\/shared#p1\.[\w-]+$/);
    await dlg.getByRole('button', { name: 'Close' }).click();

    // Someone opens it (here on this server; the phone-only version shows the same screen).
    await open(page, '/shared#' + link.split('#')[1]);
    await expect(page.locator('#main h1')).toHaveText('Road trip');
    await expect(page.locator('.hd__kicker')).toHaveText('Shared with you');
    await expect(page.locator('#main .tr')).toHaveCount(1);
    await expect(page.locator('#main .tr')).toContainText('Harbor Lights');
    await page.locator('#main .hd .btn--primary').click();
    await expect(page.locator('.deck__title')).toHaveText('Harbor Lights');

    // Keeping it makes a playlist of its own; the button then leads there.
    await page.locator('.shared__keep').click();
    await expect(page.locator('.toast').last()).toContainText('Created playlist “Road trip”');
    await expect(page.locator('.shared__open')).toHaveText('In your playlists');
    const kept = (await (await request.get('/api/state')).json()).playlists.filter((p) => p.name === 'Road trip' && p.id !== mine.id);
    expect(kept.map((p) => p.tracks.map((t) => t.id))).toEqual([['audius:D7KyD']]);
    await page.locator('.shared__open').click();
    await expect(page).toHaveURL(new RegExp(`/playlist/${kept[0].id}$`));
    await request.delete(`/api/playlists/${kept[0].id}`, { data: {} });

    await open(page, '/shared#p1.bm90LWEtcGxheWxpc3Q');
    await expect(page.locator('.empty')).toContainText('This link is broken or incomplete');
  } finally {
    for (const p of [mine, onlyLocal]) await request.delete(`/api/playlists/${p.id}`, { data: {} });
  }
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

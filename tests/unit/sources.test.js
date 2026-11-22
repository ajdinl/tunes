import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installFakeNet, LRCLIB_SONG, RADIO_STATION, ARCHIVE_DOC } from '../support/fake-net.js';
import {
  audius, archive, radio, jamendo, soundcloud, lyrics, listenbrainz, sameSong, lyricKey, mainArtist, parseLength,
} from '../../lib/sources.ts';

let uninstall;
beforeAll(() => { uninstall = installFakeNet(); });
afterAll(() => uninstall());

describe('lyrics matching (sameSong)', () => {
  const hit = { trackName: 'Slow River', artistName: 'Nadia Vale', duration: 190 };

  it('normalizes keys: case, accents, brackets, feat., &', () => {
    expect(lyricKey('Čovjek (Remastered 2011)')).toBe('covjek');
    expect(lyricKey('Song [Live]')).toBe('song');
    expect(lyricKey('Song feat. Someone')).toBe('song');
    expect(lyricKey('Song - Radio Edit')).toBe('song');
    expect(lyricKey('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(mainArtist('Nadia Vale, Kaito')).toBe('nadia vale');
    expect(mainArtist('Nadia Vale feat. Kaito')).toBe('nadia vale');
  });

  it('accepts the same artist, title and length (within 3 s)', () => {
    expect(sameSong(hit, { artist: 'Nadia Vale', title: 'Slow River', duration: 190 })).toBe(true);
    expect(sameSong(hit, { artist: 'nadia vale', title: 'Slow River (Remastered)', duration: 193 })).toBe(true);
    expect(sameSong(hit, { artist: 'Nadia Vale & Kaito', title: 'Slow River', duration: 188 })).toBe(true);
  });

  it('rejects a wrong artist, a wrong title, a different length or a missing length', () => {
    expect(sameSong(hit, { artist: 'Someone Else', title: 'Slow River', duration: 190 })).toBe(false);
    expect(sameSong(hit, { artist: 'Nadia Vale', title: 'Fast River', duration: 190 })).toBe(false);
    expect(sameSong(hit, { artist: 'Nadia Vale', title: 'Slow River', duration: 194 })).toBe(false);
    expect(sameSong(hit, { artist: 'Nadia Vale', title: 'Slow River', duration: 0 })).toBe(false);
    expect(sameSong(null, { artist: 'Nadia Vale', title: 'Slow River', duration: 190 })).toBe(false);
    expect(sameSong(hit, { artist: '', title: 'Slow River', duration: 190 })).toBe(false);
  });
});

describe('lyrics() against LRCLIB', () => {
  it('finds an exact match', async () => {
    const r = await lyrics({ artist: 'Nadia Vale', title: 'Slow River', duration: 190 });
    expect(r).toEqual({ found: true, synced: LRCLIB_SONG.syncedLyrics, plain: LRCLIB_SONG.plainLyrics, instrumental: false, source: 'lrclib' });
  });
  it('gives nothing for a wrong artist', async () => {
    expect(await lyrics({ artist: 'Wrong Band', title: 'Slow River', duration: 190 })).toEqual({ found: false });
  });
  it('gives nothing without a duration', async () => {
    expect(await lyrics({ artist: 'Nadia Vale', title: 'Slow River', duration: 0 })).toEqual({ found: false });
  });
  it('gives nothing for sets over 20 minutes or without artist/title', async () => {
    expect(await lyrics({ artist: 'Nadia Vale', title: 'Slow River', duration: 21 * 60 })).toEqual({ found: false });
    expect(await lyrics({ artist: '', title: 'Slow River', duration: 190 })).toEqual({ found: false });
  });
});

describe('parseLength', () => {
  it('reads seconds and mm:ss / hh:mm:ss', () => {
    expect(parseLength('200.5')).toBe(201);
    expect(parseLength('1:05')).toBe(65);
    expect(parseLength('1:00:01')).toBe(3601);
    expect(parseLength('')).toBe(0);
    expect(parseLength('abc')).toBe(0);
  });
});

describe('Audius', () => {
  it('maps tracks and skips gated ones', async () => {
    const list = await audius.search('harbor');
    expect(list.map((x) => x.title)).toEqual(['Harbor Lights', 'Tide Tables']);
    // Downloads only for the artist's Audius followers: not offered.
    expect(list[1].download).toBeNull();
    const t = list[0];
    expect(t).toMatchObject({
      id: 'audius:D7KyD', source: 'audius', title: 'Harbor Lights', artist: 'Kaito', duration: 245, year: 2023,
      stream: '/api/stream/audius/D7KyD', link: 'https://audius.co/kaito/harbor-lights', artistRef: 'audius:MWpwWPo',
    });
    expect(t.download).toBe('https://api.audius.co/v1/tracks/D7KyD/download?app_name=Tunes');
    // Covers go through the image proxy, with mirrors as fallbacks.
    const cover = new URL(t.cover, 'http://x');
    expect(cover.pathname).toBe('/api/img');
    expect(cover.searchParams.get('m')).toBe('https://mirror1.example,https://mirror2.example');
  });
  it('lists only artists that have tracks', async () => {
    const users = await audius.users('kaito');
    expect(users.map((u) => u.id)).toEqual(['MWpwWPo']);
    expect(users[0]).toMatchObject({ name: 'Kaito', followers: 1200, trackCount: 2, link: 'https://audius.co/kaito' });
  });
  it('loads an artist with tracks', async () => {
    const r = await audius.user('MWpwWPo');
    expect(r.artist.name).toBe('Kaito');
    expect(r.tracks).toHaveLength(1);
  });
});

describe('Internet Archive', () => {
  it('searches', async () => {
    const [x] = await archive.search('fen lights');
    expect(x).toMatchObject({ id: 'ia:' + ARCHIVE_DOC.identifier, title: ARCHIVE_DOC.title, artist: 'The Fen Lights', year: '1999' });
  });
  it('loads an item with the best playable format, sorted by track number', async () => {
    const { album, tracks } = await archive.item(ARCHIVE_DOC.identifier);
    expect(album).toMatchObject({ title: ARCHIVE_DOC.title, artist: 'The Fen Lights', year: '1999', description: 'Soundboard recording .' });
    expect(album.license).toMatch(/creativecommons/);
    expect(tracks.map((t) => [t.trackNo, t.title, t.duration])).toEqual([[1, 'fen01 Opening Song', 250], [2, 'Intro', 65]]);
    expect(tracks[0].stream).toBe('/api/stream/url?u=' + encodeURIComponent(`https://archive.org/download/${ARCHIVE_DOC.identifier}/fen01%20Opening%20Song.mp3`));
    expect(tracks[0].ext).toBe('.mp3');
  });
  it('rejects odd identifiers', async () => {
    await expect(archive.item('../etc/passwd')).rejects.toThrow('Invalid identifier');
  });
});

describe('Radio Browser', () => {
  it('maps stations and skips ones without a URL', async () => {
    const list = await radio.search({ q: 'coast' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'radio:' + RADIO_STATION.stationuuid, source: 'radio', title: 'Coastline FM', live: true,
      artist: 'Bosnia and Herzegovina / jazz, lounge', album: 'MP3 128 kbps', genre: 'jazz', cover: null,
    });
    const s = new URL(list[0].stream, 'http://x');
    expect(s.pathname).toBe('/api/stream/radio');
    expect(s.searchParams.get('u')).toBe(RADIO_STATION.url_resolved);
  });
});

describe('Jamendo', () => {
  it('returns nothing without a client id', async () => {
    expect(await jamendo.search('x', '')).toEqual([]);
  });
  it('reports a bad client id', async () => {
    await expect(jamendo.search('x', 'bad')).rejects.toThrow(/Jamendo: Your credential/);
  });
  it('maps tracks', async () => {
    const [t] = await jamendo.search('road', 'good-client');
    expect(t).toMatchObject({ id: 'jamendo:1886', title: 'Open Road', artist: 'Cielo', year: '2020', genre: 'pop', ext: '.mp3' });
    expect(t.download).toMatch(/download\/1886/);
  });
});

describe('SoundCloud', () => {
  it('finds a link inside a share message', () => {
    expect(soundcloud.find('Listen to this https://on.soundcloud.com/aBcD1 on SoundCloud')).toBe('https://on.soundcloud.com/aBcD1');
    expect(soundcloud.find('nothing here')).toBeNull();
  });

  it('canonicalizes links: drops tracking parameters, keeps private tokens', async () => {
    expect(await soundcloud.canonical('https://m.soundcloud.com/nadia-vale/slow-river?si=abc&utm_source=x')).toBe('https://soundcloud.com/nadia-vale/slow-river');
    expect(await soundcloud.canonical('https://soundcloud.com/nadia-vale/slow-river/s-SeCrEt')).toBe('https://soundcloud.com/nadia-vale/slow-river/s-SeCrEt');
    expect(await soundcloud.canonical('https://on.soundcloud.com/aBcD1')).toBe('https://soundcloud.com/nadia-vale/slow-river');
  });

  it('rejects non-SoundCloud links, /stream and other non-content pages', async () => {
    await expect(soundcloud.canonical('https://example.com/x')).rejects.toMatchObject({ status: 400, message: 'Not a SoundCloud link' });
    await expect(soundcloud.canonical('https://soundcloud.com/stream')).rejects.toMatchObject({ status: 400 });
    await expect(soundcloud.canonical('https://soundcloud.com/')).rejects.toMatchObject({ status: 400 });
    await expect(soundcloud.canonical('not a url')).rejects.toMatchObject({ status: 400, message: 'Invalid address' });
    await expect(soundcloud.canonical('https://on.soundcloud.com/missing')).rejects.toMatchObject({ status: 404 });
  });

  it('resolves tracks, sets and artists', async () => {
    const t = await soundcloud.resolve('https://soundcloud.com/nadia-vale/slow-river');
    expect(t).toMatchObject({ source: 'soundcloud', title: 'Slow River', artist: 'Nadia Vale', kind: 'track', link: 'https://soundcloud.com/nadia-vale/slow-river' });
    expect(t.id).toMatch(/^soundcloud:[0-9a-f]{16}$/);
    const set = await soundcloud.resolve('https://soundcloud.com/nadia-vale/sets/blue-hours');
    expect(set).toMatchObject({ kind: 'set', title: 'Blue Hours', album: 'Blue Hours' });
    expect((await soundcloud.resolve('https://soundcloud.com/nadia-vale')).kind).toBe('artist');
  });

  it('reports missing or private links', async () => {
    await expect(soundcloud.resolve('https://soundcloud.com/nobody/nothing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('ListenBrainz', () => {
  it('validates tokens', async () => {
    expect(await listenbrainz.validate('good-token')).toEqual({ valid: true, user: 'tester' });
    expect(await listenbrainz.validate('bad')).toEqual({ valid: false, user: null });
  });
  it('skips submissions without a token or artist', async () => {
    await expect(listenbrainz.submit('', 'single', { artist: 'a', title: 'b' })).resolves.toBeUndefined();
    await expect(listenbrainz.submit('good-token', 'single', { title: 'b' })).resolves.toBeUndefined();
  });
});

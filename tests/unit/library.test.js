import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Library } from '../../lib/library.ts';
import { LIBRARY, SIDECAR, makeLibrary, makeWav } from '../support/fixtures.js';

let base;
let lib;
const byTitle = (title) => lib.tracks().find((t) => t.title === title);

beforeAll(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'tunes-lib-'));
  const music = makeLibrary(path.join(base, 'music'));
  lib = new Library({ dataDir: path.join(base, 'data'), getFolders: () => [music] });
  await lib.scan();
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('Library', () => {
  it('finds every audio file and reads its tags', () => {
    expect(lib.tracks()).toHaveLength(LIBRARY.length);
    const t = byTitle('Morning Light');
    expect(t).toMatchObject({ source: 'local', artist: 'Nadia Vale', album: 'Blue Hours', albumArtist: 'Nadia Vale', trackNo: 1, duration: 200, ext: '.wav' });
    expect(t.id).toMatch(/^local:[0-9a-f]{16}$/);
    expect(t.stream).toBe('/api/stream/local/' + t.id.slice(6));
    expect(t.cover).toBe('/api/local/cover/' + t.id.slice(6));
  });

  it('falls back to Artist/Album/file name when a file has no tags', () => {
    expect(byTitle('Night Bus')).toMatchObject({ artist: 'Untagged Artist', album: 'Loose Tapes', duration: 150 });
  });

  it('caches the scan and only re-reads changed files', async () => {
    expect(JSON.parse(fs.readFileSync(path.join(base, 'data', 'library.json'), 'utf8')).version).toBe(2);
    expect(await lib.scan()).toEqual({ count: LIBRARY.length, changed: 0 });
    const again = new Library({ dataDir: path.join(base, 'data'), getFolders: lib.getFolders });
    expect(again.tracks()).toHaveLength(LIBRARY.length);
  });

  it('notices added and removed files', async () => {
    const extra = path.join(base, 'music', 'New', 'Single', '01 Fresh.wav');
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, makeWav(5, { title: 'Fresh', artist: 'New' }));
    expect((await lib.scan()).count).toBe(LIBRARY.length + 1);
    fs.rmSync(path.dirname(path.dirname(extra)), { recursive: true });
    expect((await lib.scan()).count).toBe(LIBRARY.length);
  });

  it('reads a .lrc file next to the song', async () => {
    const t = byTitle('Morning Light');
    expect(await lib.lyrics(t.id.slice(6))).toEqual({ synced: SIDECAR.text, plain: null });
    expect(await lib.lyrics(byTitle('Slow River').id.slice(6))).toBeNull();
    expect(await lib.lyrics('0000000000000000')).toBeNull();
  });

  it('remembers that an album has no cover', async () => {
    const h = byTitle('Northbound').id.slice(6);
    expect(await lib.cover(h)).toBeNull();
    expect(fs.readdirSync(path.join(base, 'data', 'covers')).some((f) => f.endsWith('.none'))).toBe(true);
  });
});

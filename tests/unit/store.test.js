import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Store, cleanTrack, tildify, ICONS } from '../../lib/store.js';

let dir;
let stores = [];
const open = (file = path.join(dir, 'db.json')) => { const s = new Store(file); stores.push(s); return s; };
const track = (over = {}) => ({ id: 'local:abc', source: 'local', title: 'Song', artist: 'Artist', duration: 200, ...over });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunes-store-')); });
afterEach(() => {
  for (const s of stores) clearTimeout(s.timer);
  stores = [];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('tildify', () => {
  const home = os.homedir();
  it('shows folders inside the home folder as ~/…', () => {
    expect(tildify(path.join(home, 'Music', 'Tunes'))).toBe('~/Music/Tunes');
    expect(tildify(home)).toBe('~');
  });
  it('leaves other folders alone, including look-alike prefixes', () => {
    expect(tildify('/tmp/music')).toBe('/tmp/music');
    expect(tildify(home + 'other/x')).toBe(home + 'other/x');
  });
});

describe('cleanTrack', () => {
  it('keeps only whitelisted fields and drops empty values', () => {
    const t = cleanTrack({ id: 'a', title: 'T', artist: '', album: null, kind: 'set', artistRef: 'audius:1', evil: '<script>', bytes: 99 });
    expect(t).toEqual({ id: 'a', title: 'T', kind: 'set', artistRef: 'audius:1' });
  });
  it('always has a string id and a title', () => {
    expect(cleanTrack({})).toEqual({ id: '', title: 'Untitled' });
    expect(cleanTrack({ id: 42 }).id).toBe('42');
  });
});

describe('Store', () => {
  it('starts with defaults when there is no file', () => {
    const s = open();
    expect(s.data.settings.icon).toBe('dial');
    expect(s.data.settings.folders).toEqual([path.join(os.homedir(), 'Music', 'Tunes')]);
    expect(s.data.history).toEqual([]);
  });

  it('merges a partial file with the defaults', () => {
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ settings: { folders: ['/m'], volume: 0.3 }, favorites: { x: {} } }));
    const s = open();
    expect(s.data.settings.folders).toEqual(['/m']);
    expect(s.data.settings.volume).toBe(0.3);
    expect(s.data.settings.eq.preset).toBe('Flat');
    expect(s.data.favorites).toEqual({ x: {} });
    expect(s.data.playlists).toEqual([]);
  });

  it('writes atomically and reads back what it wrote', () => {
    const s = open();
    s.toggleFavorite(track());
    s.flush();
    expect(fs.existsSync(path.join(dir, 'db.json.tmp'))).toBe(false);
    const again = open();
    expect(Object.keys(again.data.favorites)).toEqual(['local:abc']);
  });

  it('publicState masks tokens, hides the phone key and shows folders with ~', () => {
    const s = open();
    s.data.settings.folders = [path.join(os.homedir(), 'Music'), '/srv/music'];
    s.data.settings.listenbrainzToken = 'secret-lb';
    s.data.settings.jamendoClientId = 'secret-jam';
    s.data.settings.phone = { enabled: true, token: 'secret-phone' };
    const st = s.publicState();
    expect(st.settings.folders).toEqual(['~/Music', '/srv/music']);
    expect(st.settings.listenbrainzToken).toBe('••••');
    expect(st.settings.jamendoClientId).toBe('••••');
    expect(st.settings.hasListenbrainz).toBe(true);
    expect(st.settings.hasJamendo).toBe(true);
    expect(st.settings.phoneOn).toBe(true);
    expect(JSON.stringify(st)).not.toMatch(/secret/);
  });

  it('publicState sends at most the last 1000 history entries', () => {
    const s = open();
    s.data.history = Array.from({ length: 1500 }, (_, i) => ({ track: { id: 't' + i }, at: i }));
    const h = s.publicState().history;
    expect(h).toHaveLength(1000);
    expect(h[0].track.id).toBe('t500');
  });

  it('toggles favorites and saved stations', () => {
    const s = open();
    expect(s.toggleFavorite(track())).toBe(true);
    expect(s.data.favorites['local:abc'].track.title).toBe('Song');
    expect(s.toggleFavorite(track())).toBe(false);
    expect(s.data.favorites).toEqual({});
    const st = track({ id: 'radio:1', live: true });
    expect(s.toggleStation(st)).toBe(true);
    expect(s.toggleStation(st)).toBe(false);
  });

  describe('addHistory', () => {
    it('counts a play and updates counts and last played', () => {
      const s = open();
      expect(s.addHistory(track(), 1_000_000)).toBe(true);
      expect(s.data.playCounts['local:abc']).toBe(1);
      expect(s.data.lastPlayed['local:abc']).toBe(1_000_000);
      expect(s.data.history).toHaveLength(1);
    });

    it('does not count the same song again within its own length (reload or handoff)', () => {
      const s = open();
      const t0 = 1_000_000;
      expect(s.addHistory(track({ duration: 200 }), t0)).toBe(true);
      expect(s.addHistory(track({ duration: 200 }), t0 + 199_000)).toBe(false);
      expect(s.addHistory(track({ duration: 200 }), t0 + 200_000)).toBe(true);
      expect(s.data.playCounts['local:abc']).toBe(2);
    });

    it('uses at least 60 s for short songs and 30 min for radio', () => {
      const s = open();
      const t0 = 1_700_000_000_000;
      s.addHistory(track({ id: 'short', duration: 10 }), t0);
      expect(s.addHistory(track({ id: 'short', duration: 10 }), t0 + 59_000)).toBe(false);
      s.addHistory(track({ id: 'radio:x', live: true }), t0);
      expect(s.addHistory(track({ id: 'radio:x', live: true }), t0 + 29 * 60_000)).toBe(false);
      expect(s.addHistory(track({ id: 'radio:x', live: true }), t0 + 30 * 60_000)).toBe(true);
    });

    it('counts a play reported with an older timestamp', () => {
      const s = open();
      s.addHistory(track(), 1_000_000);
      expect(s.addHistory(track(), 500_000)).toBe(true);
    });

    it('keeps at most 5000 entries', () => {
      const s = open();
      for (let i = 0; i < 5005; i++) s.addHistory(track({ id: 'x' + i }), 1_000_000 + i);
      expect(s.data.history).toHaveLength(5000);
      expect(s.data.history[0].track.id).toBe('x5');
    });

    it('clearHistory empties history, counts and last played', () => {
      const s = open();
      s.addHistory(track(), 1);
      s.clearHistory();
      expect(s.data.history).toEqual([]);
      expect(s.data.playCounts).toEqual({});
      expect(s.data.lastPlayed).toEqual({});
    });
  });

  describe('playlists', () => {
    it('creates, updates and deletes', () => {
      const s = open();
      const p = s.createPlaylist('Road trip', [track(), { id: 'b', junk: 1 }]);
      expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(p.tracks.map((t) => t.id)).toEqual(['local:abc', 'b']);
      expect(p.tracks[1]).not.toHaveProperty('junk');
      s.updatePlaylist(p.id, { name: 'Renamed', add: [track({ id: 'c' })] });
      expect(p.name).toBe('Renamed');
      expect(p.tracks).toHaveLength(3);
      s.updatePlaylist(p.id, { tracks: [track({ id: 'z' })] });
      expect(p.tracks.map((t) => t.id)).toEqual(['z']);
      expect(s.updatePlaylist('missing', { name: 'x' })).toBeNull();
      expect(s.deletePlaylist(p.id)).toBe(true);
      expect(s.deletePlaylist(p.id)).toBe(false);
    });

    it('limits names to 120 characters and has a default name', () => {
      const s = open();
      expect(s.createPlaylist('x'.repeat(300)).name).toHaveLength(120);
      expect(s.createPlaylist('').name).toBe('New playlist');
    });
  });

  describe('updateSettings', () => {
    it('expands ~ in folders and drops empty ones', () => {
      const s = open();
      s.updateSettings({ folders: ['~/Music/Tunes', '  ', ' /srv/x '] });
      expect(s.data.settings.folders).toEqual([path.join(os.homedir(), 'Music/Tunes'), '/srv/x']);
    });

    it('treats the masked token as "unchanged" and an empty string as "clear"', () => {
      const s = open();
      s.updateSettings({ listenbrainzToken: ' tok ' });
      expect(s.data.settings.listenbrainzToken).toBe('tok');
      s.updateSettings({ listenbrainzToken: '••••' });
      expect(s.data.settings.listenbrainzToken).toBe('tok');
      s.updateSettings({ listenbrainzToken: '' });
      expect(s.data.settings.listenbrainzToken).toBe('');
    });

    it('clamps EQ gains and volume', () => {
      const s = open();
      s.updateSettings({ eq: { enabled: 1, gains: [20, -20, 'x', 3, 0, 0, 0, 0, 0, 0, 9] }, volume: 3 });
      expect(s.data.settings.eq).toEqual({ enabled: true, preset: 'Custom', gains: [12, -12, 0, 3, 0, 0, 0, 0, 0, 0] });
      expect(s.data.settings.volume).toBe(1);
      s.updateSettings({ volume: -1 });
      expect(s.data.settings.volume).toBe(0);
    });

    it('accepts only known icons', () => {
      const s = open();
      s.updateSettings({ icon: 'vinyl' });
      expect(s.data.settings.icon).toBe('vinyl');
      s.updateSettings({ icon: '../../etc' });
      expect(s.data.settings.icon).toBe('vinyl');
      expect(ICONS).toEqual(['dial', 'night', 'vinyl', 'bars']);
    });
  });
});

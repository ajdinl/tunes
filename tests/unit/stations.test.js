// The featured stations on the Radio page: the same shape as stations from radio-browser.info,
// safe addresses only, and accepted when someone shares one.
import { describe, expect, it } from 'vitest';

import { FEATURED_STATIONS } from '../../lib/stations.ts';
import { readShared, shareLink } from '../../lib/share.ts';

describe('featured stations', () => {
  it('are live radio tracks with radio-browser ids and https streams, covers and links', () => {
    expect(FEATURED_STATIONS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(FEATURED_STATIONS.map((s) => s.id)).size).toBe(FEATURED_STATIONS.length);
    for (const s of FEATURED_STATIONS) {
      expect(s).toMatchObject({ source: 'radio', live: true });
      expect(s.id).toMatch(/^radio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const q = new URLSearchParams(s.stream.split('?')[1]);
      expect(s.stream.startsWith('/api/stream/radio?')).toBe(true);
      expect('radio:' + q.get('sid')).toBe(s.id);
      expect(new URL(q.get('u')).protocol).toBe('https:');
      expect(new URL(s.cover).protocol).toBe('https:');
      expect(new URL(s.link).protocol).toBe('https:');
    }
  });

  it('can be shared and come back unchanged', () => {
    for (const s of FEATURED_STATIONS) {
      const link = shareLink(s);
      expect(readShared(new URL(link).hash)).toMatchObject({ id: s.id, title: s.title, stream: s.stream, live: true });
    }
  });
});

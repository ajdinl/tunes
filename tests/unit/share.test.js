// Sharing a song by link (lib/share.ts): what can be shared, and what a received link may carry.
import { describe, expect, it } from 'vitest';

import { PUBLIC_APP, canShare, readShared, shareLink } from '../../lib/share.ts';

const AUDIUS = {
  id: 'audius:D7KyD', source: 'audius', title: 'Harbor Lights — ćevapi', artist: 'Nadia', duration: 214,
  cover: '/api/img?u=' + encodeURIComponent('https://creatornode.example/a/480x480.jpg') + '&m=' + encodeURIComponent('https://m1.example'),
  stream: '/api/stream/audius/D7KyD', link: 'https://audius.co/nadia/harbor-lights', artistRef: 'audius:abc',
};
const hashOf = (t) => shareLink(t).split('#')[1];
const encode = (o) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('share links', () => {
  it('carry a song to the phone-only version and back, letters and all', () => {
    const link = shareLink(AUDIUS);
    expect(link.startsWith(PUBLIC_APP + 'shared#')).toBe(true);
    expect(link.split('#')[1]).toMatch(/^[\w-]+$/); // safe in any chat app
    expect(readShared('#' + hashOf(AUDIUS))).toEqual(AUDIUS);
  });

  it('are offered for online songs and stations, not for files on the computer or Jamendo', () => {
    expect(canShare(AUDIUS)).toBe(true);
    expect(canShare({ id: 'radio:x', source: 'radio', title: 'R', stream: '/api/stream/radio?sid=x&u=' + encodeURIComponent('http://ice.example/live'), live: true })).toBe(true);
    expect(canShare({ id: 'abc', source: 'local', title: 'Mine', stream: '/api/stream/local/abc' })).toBe(false);
    expect(canShare({ id: 'jamendo:1', source: 'jamendo', title: 'J', stream: '/api/stream/url?u=' + encodeURIComponent('https://storage.jamendo.com/?client_id=secret') })).toBe(false);
    expect(shareLink({ id: 'abc', source: 'local', title: 'Mine', stream: '/x' })).toBeNull();
  });

  it('accept each source only with the addresses Tunes makes for it', () => {
    const ok = [
      { id: 'ia:gd77/01.mp3', source: 'archive', title: 'A', stream: '/api/stream/url?u=' + encodeURIComponent('https://archive.org/download/gd77/01.mp3') },
      { id: 'hearthis:9', source: 'hearthis', title: 'H', stream: '/api/stream/url?u=' + encodeURIComponent('https://hearthis.at/dj/set/listen/') },
      { id: 'soundcloud:ab', source: 'soundcloud', title: 'S', stream: 'https://soundcloud.com/artist/song', link: 'https://soundcloud.com/artist/song' },
    ];
    for (const t of ok) expect(readShared(encode(t)), t.source).toMatchObject({ id: t.id, stream: t.stream });
    const bad = [
      { ...AUDIUS, stream: 'https://evil.example/a.mp3' },
      { ...AUDIUS, stream: '/api/stream/audius/../../api/export' },
      { ...AUDIUS, source: 'local', stream: '/api/stream/local/x' },
      { ...AUDIUS, id: 'radio:x' },
      { id: 'ia:x', source: 'archive', title: 'A', stream: '/api/stream/url?u=' + encodeURIComponent('https://evil.example/download/x.mp3') },
      { id: 'hearthis:1', source: 'hearthis', title: 'H', stream: '/api/stream/url?u=' + encodeURIComponent('https://hearthis.at.evil.example/x') },
      { id: 'soundcloud:1', source: 'soundcloud', title: 'S', stream: 'javascript:alert(1)' },
      { id: 'radio:1', source: 'radio', title: 'R', stream: '/api/stream/radio?u=' + encodeURIComponent('file:///etc/passwd') },
    ];
    for (const t of bad) expect(readShared(encode(t)), JSON.stringify(t)).toBeNull();
    expect(readShared('#not-base64!')).toBeNull();
    expect(readShared('')).toBeNull();
  });

  it('drop unsafe extras: a script link, an svg or http cover, unknown fields', () => {
    const t = readShared(encode({ ...AUDIUS, link: 'javascript:alert(1)', cover: 'http://img.example/a.svg', download: '/api/export', kind: 'evil', artistRef: '../x' }));
    expect(t).toMatchObject({ id: AUDIUS.id, title: AUDIUS.title });
    for (const k of ['link', 'cover', 'download', 'kind', 'artistRef']) expect(t[k], k).toBeUndefined();
  });
});

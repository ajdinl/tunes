// The audio proxy: streams from other servers go through Tunes (same origin for Web Audio),
// with Range passed on, content types fixed, ICY metadata stripped and SHOUTcast v1 handled.
import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../support/server.js';
import { listen } from '../support/sse.js';

let srv;
let upstream;
let shoutcast;
let up;   // http://127.0.0.1:<port> of the fake upstream
let sc;   // the fake SHOUTcast v1 server
const AUDIO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const METAINT = 100;

// An ICY stream: METAINT audio bytes, a metadata block, repeated.
function icyBody(title) {
  const meta = Buffer.from(`StreamTitle='${title}';`);
  const len = Math.ceil(meta.length / 16);
  const block = Buffer.concat([Buffer.from([len]), meta, Buffer.alloc(len * 16 - meta.length)]);
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(AUDIO.subarray(i * METAINT, (i + 1) * METAINT), i === 0 ? block : Buffer.from([0]));
  return { body: Buffer.concat(parts), audio: AUDIO.subarray(0, 3 * METAINT) };
}

const listenOn = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === '/song.mp3') {
      const range = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '');
      if (range) {
        const a = Number(range[1]);
        const b = range[2] ? Number(range[2]) : AUDIO.length - 1;
        res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${a}-${b}/${AUDIO.length}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes', 'Set-Cookie': 'x=1' });
        return res.end(AUDIO.subarray(a, b + 1));
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': AUDIO.length, 'Set-Cookie': 'x=1' });
      return res.end(AUDIO);
    }
    if (req.url === '/aacp') { res.writeHead(200, { 'Content-Type': 'audio/aacp' }); return res.end(AUDIO); }
    if (req.url === '/page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<script>fetch("/api/export")</script>'); }
    if (req.url === '/moved') { res.writeHead(302, { Location: '/song.mp3' }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
    if (req.url === '/missing') { res.writeHead(404); return res.end(); }
    if (req.url === '/broken') { res.writeHead(500); return res.end(); }
    if (req.url === '/live') {
      if (req.headers['icy-metadata'] !== '1') { res.writeHead(400); return res.end('wanted Icy-MetaData'); }
      const { body } = icyBody('Nadia Vale - Slow River');
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': String(METAINT), 'icy-name': 'Coastline FM', 'Content-Length': body.length });
      return res.end(body);
    }
    res.writeHead(404).end();
  });
  up = `http://127.0.0.1:${await listenOn(upstream)}`;

  // SHOUTcast v1 answers "ICY 200 OK", which Node's HTTP parser rejects.
  shoutcast = net.createServer((sock) => {
    sock.once('data', () => {
      const { body } = icyBody('Old Station Song');
      sock.end(Buffer.concat([Buffer.from(`ICY 200 OK\r\ncontent-type: audio/mpeg\r\nicy-metaint: ${METAINT}\r\nicy-name: Old Station\r\n\r\n`), body]));
    });
  });
  sc = `http://127.0.0.1:${await listenOn(shoutcast)}`;

  srv = await startServer({ port: 4740, name: 'tunes-proxy', env: { TUNES_ALLOW_PRIVATE_UPSTREAM: '1' } }); // the fake stations run on 127.0.0.1
});
afterAll(async () => {
  await srv?.stop();
  upstream?.close();
  shoutcast?.close();
});

const viaUrl = (u, init) => fetch(`${srv.url}/api/stream/url?u=${encodeURIComponent(u)}`, init);
const viaRadio = (u, sid = 'station-1') => fetch(`${srv.url}/api/stream/radio?sid=${sid}&u=${encodeURIComponent(u)}`);

describe('audio proxy', () => {
  it('streams a file, fixes the content type and drops unrelated headers', async () => {
    const r = await viaUrl(up + '/song.mp3');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('content-length')).toBe(String(AUDIO.length));
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(Buffer.from(await r.arrayBuffer()).equals(AUDIO)).toBe(true);
  });

  it('passes Range requests on', async () => {
    const r = await viaUrl(up + '/song.mp3', { headers: { Range: 'bytes=100-199' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 100-199/${AUDIO.length}`);
    expect(Buffer.from(await r.arrayBuffer()).equals(AUDIO.subarray(100, 200))).toBe(true);
  });

  it('maps odd audio types to ones browsers know', async () => {
    expect((await viaUrl(up + '/aacp')).headers.get('content-type')).toBe('audio/aac');
  });

  it('never passes a page on: anything but audio goes out as a sandboxed download', async () => {
    const r = await viaUrl(up + '/page.html');
    expect(r.headers.get('content-type')).toBe('application/octet-stream');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('follows redirects, but not forever', async () => {
    const r = await viaUrl(up + '/moved');
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(AUDIO.length);
    const loop = await viaUrl(up + '/loop');
    expect(loop.status).toBe(502);
    expect(await loop.text()).toMatch(/Too many redirects/);
  });

  it('reports upstream errors', async () => {
    expect((await viaUrl(up + '/missing')).status).toBe(404);
    expect((await viaUrl(up + '/broken')).status).toBe(502);
    expect((await viaUrl('http://127.0.0.1:1/nothing')).status).toBe(502);
  });

  it('rejects bad addresses and other protocols', async () => {
    expect((await viaUrl('not a url')).status).toBe(400);
    expect((await viaUrl('file:///etc/passwd')).status).toBe(400);
  });

  it('strips ICY metadata from radio and broadcasts the song title', async () => {
    const sse = listen(srv.url);
    await sse.ready;
    const r = await viaRadio(up + '/live');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBeNull();
    expect(decodeURIComponent(r.headers.get('x-station-name'))).toBe('Coastline FM');
    const body = Buffer.from(await r.arrayBuffer());
    expect(body.equals(icyBody('').audio)).toBe(true);
    expect((await sse.next('icy')).data).toEqual({ sid: 'station-1', title: 'Nadia Vale - Slow River' });
    sse.close();
  });

  it('plays SHOUTcast v1 stations ("ICY 200 OK")', async () => {
    const sse = listen(srv.url);
    await sse.ready;
    const r = await viaRadio(sc + '/', 'old-1');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    const body = Buffer.from(await r.arrayBuffer());
    expect(body.equals(icyBody('').audio)).toBe(true);
    expect((await sse.next('icy')).data).toEqual({ sid: 'old-1', title: 'Old Station Song' });
    sse.close();
  });
});

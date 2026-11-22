// Protections against websites the user happens to visit while Tunes runs, and against other
// devices on the same network (see the security notes in CLAUDE.md).
import http from 'node:http';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, client } from '../support/server.js';

let srv;
let api;
const status = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path, headers }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

beforeAll(async () => {
  srv = await startServer({ port: 4760, name: 'tunes-security' });
  api = client(srv.url);
});
afterAll(() => srv?.stop());

describe('requests from other websites', () => {
  it('the API answers only Tunes itself', async () => {
    expect(await status('/api/state', { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
    expect(await status('/api/stream/url?u=https%3A%2F%2Fevil.example%2Fx.html', { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
    expect(await status('/api/state', { 'Sec-Fetch-Site': 'same-site' })).toBe(403); // e.g. another port
    expect(await status('/api/state', { 'Sec-Fetch-Site': 'same-origin' })).toBe(200);
    expect(await status('/api/state', { 'Sec-Fetch-Site': 'none' })).toBe(200); // typed into the address bar
    expect(await status('/', { 'Sec-Fetch-Site': 'cross-site' })).toBe(200); // a link to the app itself is fine
  });

  it('a broken address answers 400 and the server keeps running', async () => {
    expect(await status('/%ff')).toBe(400);
    expect(await status('/api/%E0%A4%A')).toBe(400);
    expect((await api.get('/api/state')).status).toBe(200);
  });

  it('pages carry a Content Security Policy', async () => {
    const r = await api.get('/settings');
    const csp = r.headers.get('content-security-policy');
    expect(csp).toMatch(/script-src 'self' 'sha256-[\w+/=]+' https:\/\/w\.soundcloud\.com/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('the proxies stay on the public internet', () => {
  it('refuses the computer itself and the home network', async () => {
    for (const u of [srv.url + '/api/export', 'http://localhost:4545/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data']) {
      expect((await api.get('/api/stream/url?u=' + encodeURIComponent(u))).status, u).toBe(403);
      expect((await api.get('/api/img?u=' + encodeURIComponent(u))).status, u).toBe(404);
    }
    expect((await api.get('/api/stream/radio?sid=x&u=' + encodeURIComponent('http://10.0.0.1:8000/live'))).status).toBe(403);
  });

  it('serves bitmaps as covers, never SVG (it can carry a script)', async () => {
    const png = await api.get('/api/img?u=' + encodeURIComponent('https://img.example/cover.png'));
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect((await api.get('/api/img?u=' + encodeURIComponent('https://img.example/evil.svg'))).status).toBe(404);
  });
});

describe('saving to the computer', () => {
  it('writes audio files only, whatever the track says', async () => {
    const r = await api.post('/api/download', { track: {
      id: 'archive:evil/x', title: 'com.evil', artist: 'Library', album: 'LaunchAgents', ext: '.plist', download: 'https://archive.org/download/evil/x',
    } });
    expect(r.status).toBe(200);
    expect(r.body.file).toMatch(/com\.evil\.mp3$/);
    expect(r.body.file.startsWith(srv.music)).toBe(true);
  });
});

describe('other devices', () => {
  // With HOST opened to the network, other devices need the phone key like on the phone port.
  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  it.skipIf(!lanIp)('reach the main port only with the phone key', async () => {
    const open = await startServer({ port: 4764, name: 'tunes-open', env: { HOST: '0.0.0.0' } });
    try {
      const fromLan = await fetch(`http://${lanIp}:4764/api/state`);
      expect(fromLan.status).toBe(401);
      expect((await fetch('http://127.0.0.1:4764/api/state')).status).toBe(200); // the computer itself
    } finally { await open.stop(); }
  });
});

// Listening on a phone: a second listener on PORT+1 that only lets in devices with the key.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, client } from '../support/server.js';

let srv;
let api;
let lan;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The key is in db.json (written with a short delay); the API never shows it except in the QR link.
async function phoneToken() {
  for (let i = 0; i < 30; i++) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(srv.data, 'db.json'), 'utf8')).settings.phone?.token;
      if (t) return t;
    } catch { /* not written yet */ }
    await sleep(100);
  }
  throw new Error('No phone token in db.json');
}

beforeAll(async () => {
  srv = await startServer({ port: 4720, name: 'tunes-phone' });
  api = client(srv.url);
  lan = `http://127.0.0.1:${srv.port + 1}`;
});
afterAll(() => srv?.stop());

describe('phone access', () => {
  it('is off by default', async () => {
    expect((await api.get('/api/phone')).body).toMatchObject({ enabled: false, port: 4721, wifi: { url: null } });
    await expect(fetch(lan + '/')).rejects.toThrow();
  });

  it('turns on, and the LAN listener needs the key', async () => {
    const on = (await api.post('/api/phone', { enabled: true })).body;
    expect(on.enabled).toBe(true);
    await sleep(600); // db.json is written with a short delay
    const token = await phoneToken();
    if (on.wifi.url) {
      expect(on.wifi.url).toMatch(new RegExp(`^http://[\\d.]+:4721/\\?k=${token}$`));
      expect(on.wifi.qr).toContain('<svg');
    }
    expect(JSON.stringify((await api.get('/api/state')).body)).not.toContain(token);

    const denied = await fetch(lan + '/', { redirect: 'manual' });
    expect(denied.status).toBe(401);
    expect((await fetch(lan + '/api/state')).status).toBe(401);
    expect((await fetch(lan + '/?k=wrong', { redirect: 'manual' })).status).toBe(401);

    const login = await fetch(lan + `/?k=${token}`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe('/');
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toMatch(new RegExp(`^sl_k=${token}; Path=/; Max-Age=\\d+; HttpOnly; SameSite=Strict`));
    const deep = await fetch(lan + `/?x=1&k=${token}`, { redirect: 'manual' });
    expect(deep.headers.get('location')).toBe('/?x=1');

    const headers = { Cookie: `sl_k=${token}` };
    expect((await fetch(lan + '/', { headers })).status).toBe(200);
    expect((await fetch(lan + '/api/state', { headers })).status).toBe(200);
    // The home-screen app does not share Safari's cookies, so its start URL carries the key.
    const manifest = await (await fetch(lan + '/manifest.webmanifest', { headers })).json();
    expect(manifest.start_url).toBe(`/?k=${token}`);
    expect(manifest.id).toBe('/');
    // Only the computer can change phone access.
    const fromPhone = await fetch(lan + '/api/phone', { headers });
    expect(fromPhone.status).toBe(403);
    // The computer's own manifest has no key in it.
    expect(JSON.stringify((await api.get('/manifest.webmanifest')).body)).not.toContain(token);
    // Links for a device that already has the key.
    const links = (await fetch(lan + '/api/phone/links', { headers }).then((r) => r.json()));
    expect(links).toHaveProperty('wifi');
    expect(links).toHaveProperty('tailscaleRunning');
  });

  it('turning it off closes the port and changes the key', async () => {
    const old = await phoneToken();
    const off = (await api.post('/api/phone', { enabled: false })).body;
    expect(off.enabled).toBe(false);
    await sleep(600);
    expect(await phoneToken()).not.toBe(old);
    await expect(fetch(lan + '/', { headers: { Cookie: `sl_k=${old}` } })).rejects.toThrow();
  });
});

// Starts a separate Tunes server for tests: its own port, its own DATA_DIR with a generated
// music library, and the fake internet. The real server (port 4545) is never touched.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY, makeDataDir, makeLibrary } from './fixtures.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = path.join(ROOT, 'tests', 'support', 'fake-net-preload.js');
const ENTRY = process.env.TUNES_SERVER_ENTRY || 'server.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startServer({ port, name = 'tunes-test', settings = {}, waitForLibrary = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const music = makeLibrary(path.join(base, 'music'));
  const data = makeDataDir(path.join(base, 'data'), music, settings);
  const proc = spawn(process.execPath, ['--import', PRELOAD, ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => proc.once('exit', r));
  const url = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 20000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`Test server exited (${proc.exitCode}):\n${log}`);
    try {
      const r = await fetch(url + '/api/library');
      if (r.ok) {
        const lib = await r.json();
        if (!waitForLibrary || (lib.tracks.length === LIBRARY.length && !lib.scanning)) break;
      }
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) { proc.kill(); throw new Error(`Test server did not start on ${url}:\n${log}`); }
    await sleep(100);
  }

  return {
    url,
    port,
    base,
    music,
    data,
    proc,
    log: () => log,
    async stop() {
      if (proc.exitCode === null) { proc.kill('SIGTERM'); await exited; }
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

// Small JSON client for API tests.
export function client(url) {
  const call = async (method, p, bodyData, headers = {}) => {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (bodyData !== undefined) {
      init.body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      init.headers['Content-Type'] ??= 'application/json';
    }
    const res = await fetch(url + p, init);
    const type = res.headers.get('content-type') || '';
    const body = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, headers: res.headers, body };
  };
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    put: (p, b, h) => call('PUT', p, b, h),
    del: (p, b, h) => call('DELETE', p, b, h),
    raw: call,
  };
}

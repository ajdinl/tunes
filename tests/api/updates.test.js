// Open windows learn about a new build of the interface over SSE, without a server restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, ROOT } from '../support/server.js';
import { listen } from '../support/sse.js';

let srv;
let dist;

beforeAll(async () => {
  // A copy of the build, so the test can "rebuild" it.
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'tunes-dist-'));
  fs.cpSync(path.join(ROOT, 'web', 'dist'), dist, { recursive: true });
  srv = await startServer({ port: 4750, name: 'tunes-updates', env: { TUNES_WEB_DIST: dist } });
});
afterAll(async () => {
  await srv?.stop();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('interface updates', () => {
  it('tells every window which build is on disk, and when a new one appears', async () => {
    const index = path.join(dist, 'index.html');
    const html = fs.readFileSync(index, 'utf8');
    const current = /src="\/assets\/([^"]+\.js)"/.exec(html)[1];
    const sse = listen(srv.url);
    await sse.ready;
    expect((await sse.next('version')).data).toEqual({ id: current });
    // The page itself is served from the copy.
    expect(await (await fetch(srv.url + '/')).text()).toContain(current);

    fs.writeFileSync(index, html.replace(current, 'index-NEWBUILD.js'));
    expect((await sse.next('version', (d) => d.id === 'index-NEWBUILD.js', 8000)).data).toEqual({ id: 'index-NEWBUILD.js' });
    sse.close();
  });
});

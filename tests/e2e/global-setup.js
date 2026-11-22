// Starts the demo server (own DATA_DIR, generated music, fake internet) for the whole run.
import fs from 'node:fs';
import path from 'node:path';

import { startServer, ROOT } from '../support/server.js';
import { E2E_PORT } from '../../playwright.config.js';

export default async function globalSetup() {
  if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) throw new Error('Build the app first: npm run build');
  const srv = await startServer({ port: E2E_PORT, name: 'tunes-e2e' });
  process.env.TUNES_E2E_DATA = srv.data;
  process.env.TUNES_E2E_MUSIC = srv.music;
  return async () => {
    if (process.env.TUNES_E2E_LOG) console.log(srv.log());
    await srv.stop();
  };
}

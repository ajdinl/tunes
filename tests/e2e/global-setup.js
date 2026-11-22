// Starts the demo server (own DATA_DIR, generated music, fake internet) for the whole run.
import { startServer } from '../support/server.js';
import { E2E_PORT } from '../../playwright.config.js';

export default async function globalSetup() {
  const srv = await startServer({ port: E2E_PORT, name: 'tunes-e2e' });
  process.env.TUNES_E2E_DATA = srv.data;
  process.env.TUNES_E2E_MUSIC = srv.music;
  return async () => {
    if (process.env.TUNES_E2E_LOG) console.log(srv.log());
    await srv.stop();
  };
}

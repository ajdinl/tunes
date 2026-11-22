import { defineConfig } from '@playwright/test';

export const E2E_PORT = Number(process.env.TUNES_E2E_PORT) || 4730;

// The tests share one demo server (device sessions are global on the server), so they run
// one at a time. Set TUNES_BROWSER to use an installed Chromium browser (e.g. Brave) instead
// of Playwright's own (npx playwright install chromium).
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 8000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    locale: 'en-GB',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    // The service worker would answer some requests itself, out of reach of the test routes.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    launchOptions: {
      // phone.local reaches the test server under a non-localhost name, like a phone on Wi-Fi would.
      args: ['--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP phone.local 127.0.0.1'],
      ...(process.env.TUNES_BROWSER ? { executablePath: process.env.TUNES_BROWSER } : {}),
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

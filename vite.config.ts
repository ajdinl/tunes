import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React frontend lives in web/ and is built to web/dist, which server.ts serves.
// Icons, the manifest and the service worker stay in public/ and fonts in node_modules; the
// server serves them, so Vite does not copy a public folder.
// `npm run dev` starts Vite with hot reload and sends everything else to the Tunes server.
const API = `http://127.0.0.1:${process.env.PORT || 4545}`;

// /fonts and /icons are served by server.ts at runtime, so Vite can't find them while
// building. That is expected: don't print a warning about it on every start.
const logger = createLogger();
const expected = (msg: string) => /^\/(fonts|icons)\/.*(doesn't exist|didn't resolve) at build time/.test(msg.trim());
const { warn, warnOnce } = logger;
logger.warn = (msg, opts) => { if (!expected(msg)) warn(msg, opts); };
logger.warnOnce = (msg, opts) => { if (!expected(msg)) warnOnce(msg, opts); };

export default defineConfig({
  root: 'web',
  customLogger: logger,
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: Object.fromEntries(['/api', '/icons', '/fonts', '/manifest.webmanifest', '/sw.js'].map((p) => [p, { target: API, changeOrigin: false }])),
  },
});

import fs from 'node:fs';
import path from 'node:path';
import { createLogger, defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The React frontend lives in web/ and is built to web/dist, which server.ts serves.
// Icons, the manifest and the service worker stay in public/ and fonts in node_modules; the
// server serves them, so Vite does not copy a public folder.
// `npm run dev` starts Vite with hot reload and sends everything else to the Tunes server.
//
// `vite build --mode standalone` builds the phone-only version instead (web/dist-standalone,
// published on GitHub Pages under /tunes/): no server, so it carries its own icons, fonts,
// manifest and service worker (see standaloneFiles below).
const API = `http://127.0.0.1:${process.env.PORT || 4545}`;
const ROOT = import.meta.dirname;
const STANDALONE_BASE = '/tunes/';

// /fonts and /icons are served by server.ts at runtime, so Vite can't find them while
// building. That is expected: don't print a warning about it on every start.
const logger = createLogger();
const expected = (msg: string) => /^\/(fonts|icons)\/.*(doesn't exist|didn't resolve) at build time/.test(msg.trim());
const { warn, warnOnce } = logger;
logger.warn = (msg, opts) => { if (!expected(msg)) warn(msg, opts); };
logger.warnOnce = (msg, opts) => { if (!expected(msg)) warnOnce(msg, opts); };

// The files the server would otherwise provide, put next to the built app.
function standaloneFiles(base: string): Plugin {
  let outDir = '';
  return {
    name: 'tunes-standalone-files',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    // Links in index.html to /manifest…, /icons/…, /fonts/… point into the sub-path.
    transformIndexHtml: (html) => html.replace(/(href|src)="\/(manifest\.webmanifest|icons\/|fonts\/)/g, `$1="${base}$2`)
      .replace(`${base}icons/app.svg`, `${base}icons/dial/icon.svg`).replace(`${base}icons/app-512.png`, `${base}icons/dial/icon-512.png`),
    closeBundle() {
      const out = (p: string) => path.join(outDir, p);
      fs.cpSync(path.join(ROOT, 'public', 'icons'), out('icons'), { recursive: true });
      const fonts = path.join(ROOT, 'node_modules', '@fontsource-variable', 'bricolage-grotesque');
      fs.mkdirSync(out('fonts'), { recursive: true });
      fs.copyFileSync(path.join(fonts, 'standard.css'), out('fonts/standard.css'));
      fs.cpSync(path.join(fonts, 'files'), out('fonts/files'), { recursive: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'));
      Object.assign(manifest, {
        description: 'Free music on your phone: Audius, Internet Archive and internet radio, with songs saved for offline listening.',
        start_url: base, scope: base, id: base,
        icons: [
          { src: 'icons/dial/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/dial/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/dial/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      });
      fs.writeFileSync(out('manifest.webmanifest'), JSON.stringify(manifest, null, 2));
      // GitHub Pages answers unknown paths with 404.html: the app itself, which routes by path.
      fs.copyFileSync(out('index.html'), out('404.html'));
      // The service worker lists the built files, so the app opens without a connection.
      const files = fs.readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && !/\.(map|html)$/.test(d.name) && d.name !== 'sw.js')
        .map((d) => base + path.relative(outDir, path.join(d.parentPath, d.name)).split(path.sep).join('/'));
      const version = String(Date.now());
      const sw = fs.readFileSync(path.join(ROOT, 'web', 'standalone-sw.js'), 'utf8')
        .replace('__BASE__', JSON.stringify(base)).replace('__VERSION__', JSON.stringify(version)).replace('__FILES__', JSON.stringify(files));
      fs.writeFileSync(out('sw.js'), sw);
    },
  };
}

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    root: 'web',
    base: standalone ? STANDALONE_BASE : '/',
    customLogger: logger,
    publicDir: false,
    plugins: [react(), standalone ? standaloneFiles(STANDALONE_BASE) : null],
    build: {
      outDir: standalone ? 'dist-standalone' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
    },
    server: {
      port: 5173,
      fs: { allow: ['..'] },
      proxy: Object.fromEntries(['/api', '/icons', '/fonts', '/manifest.webmanifest', '/sw.js'].map((p) => [p, { target: API, changeOrigin: false }])),
    },
  };
});

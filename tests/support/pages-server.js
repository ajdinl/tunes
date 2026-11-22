// Serves a built phone-only version the way GitHub Pages does: files under a base path
// (/tunes/), and 404.html (the app itself) for any other path.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json',
};

export function startPages({ dir, base = '/tunes/', port }) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (p.startsWith(base)) {
      const rel = p.slice(base.length) || 'index.html';
      const f = path.join(dir, rel);
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) file = f;
    }
    const status = file ? 200 : 404;
    file ||= path.join(dir, '404.html');
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}${base}`, close: () => server.close() })));
}

// `node tests/support/pages-server.js [port]`: a quick look at web/dist-standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 4761;
  startPages({ dir: path.resolve('web/dist-standalone'), port }).then((s) => console.log('Phone-only version at', s.url));
}

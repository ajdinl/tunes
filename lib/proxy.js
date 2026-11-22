// Stream proxy: sav zvuk ide preko lokalnog servera, pa je za browser
// "isti izvor". Zato rade ekvalizer i vizualizacija spektra (Web Audio
// odbija da analizira zvuk sa tuđih servera bez CORS zaglavlja).
// Za radio stanice čita i ICY metapodatke (naziv pesme koja ide uživo).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Transform } from 'node:stream';

const UA = 'Tunes/1.0';
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

function fixType(type, url) {
  const t = (type || '').split(';')[0].trim().toLowerCase();
  if (t === 'audio/aacp' || t === 'audio/x-aac') return 'audio/aac';
  if (t === 'audio/x-mpeg' || t === 'audio/mp3') return 'audio/mpeg';
  if (!t || t === 'application/octet-stream' || t === 'binary/octet-stream') {
    if (/\.mp3(\?|$)/i.test(url)) return 'audio/mpeg';
    if (/\.(ogg|oga)(\?|$)/i.test(url)) return 'audio/ogg';
    if (/\.flac(\?|$)/i.test(url)) return 'audio/flac';
    if (/\.(m4a|mp4)(\?|$)/i.test(url)) return 'audio/mp4';
    return 'audio/mpeg';
  }
  return t;
}

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { headers: { 'User-Agent': UA, ...headers }, timeout: 15000 }, resolve);
    req.on('timeout', () => req.destroy(new Error('Server ne odgovara')));
    req.on('error', reject);
    req.end();
  });
}

// SHOUTcast v1 odgovara sa "ICY 200 OK" umesto "HTTP/1.x". Node to odbija,
// pa čitamo odgovor ručno preko običnog soketa.
function rawIcyRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    const sock = u.protocol === 'https:'
      ? tls.connect({ host: u.hostname, port, servername: u.hostname })
      : net.connect({ host: u.hostname, port });
    sock.setTimeout(15000, () => sock.destroy(new Error('Server ne odgovara')));
    sock.on('error', reject);
    sock.once(u.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      const lines = [`GET ${u.pathname}${u.search} HTTP/1.0`, `Host: ${u.host}`, `User-Agent: ${UA}`];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) { if (buf.length > 16384) sock.destroy(new Error('Neispravan odgovor')); return; }
      sock.off('data', onData);
      sock.pause();
      sock.setTimeout(0);
      const head = buf.subarray(0, end).toString('latin1').split('\r\n');
      const status = Number(head[0].split(' ')[1]) || 200;
      const hdrs = {};
      for (const line of head.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      const rest = buf.subarray(end + 4);
      if (rest.length) sock.unshift(rest);
      sock.statusCode = status;
      sock.headers = hdrs;
      resolve(sock);
    };
    sock.on('data', onData);
  });
}

async function open(url, headers, redirects = 0) {
  if (redirects > 6) throw new Error('Previše preusmeravanja');
  let up;
  try {
    up = await request(url, headers);
  } catch (e) {
    if (e.code === 'HPE_INVALID_CONSTANT' && headers['Icy-MetaData']) up = await rawIcyRequest(url, headers);
    else throw e;
  }
  if ([301, 302, 303, 307, 308].includes(up.statusCode) && up.headers.location) {
    up.resume?.();
    up.destroy?.();
    return open(new URL(up.headers.location, url).href, headers, redirects + 1);
  }
  return { up, finalUrl: url };
}

// Izbacuje ICY metapodatke iz audio toka i javlja naziv pesme.
class IcyStripper extends Transform {
  constructor(metaint, onTitle) {
    super();
    this.metaint = metaint;
    this.left = metaint; // bajtova zvuka do sledećeg bloka metapodataka
    this.metaLen = -1;   // -1: ne čitamo metapodatke
    this.meta = [];
    this.onTitle = onTitle;
  }
  _transform(chunk, _enc, cb) {
    let i = 0;
    while (i < chunk.length) {
      if (this.metaLen === -1) {
        const n = Math.min(this.left, chunk.length - i);
        if (n > 0) this.push(chunk.subarray(i, i + n));
        i += n;
        this.left -= n;
        if (this.left === 0 && i < chunk.length) {
          this.metaLen = chunk[i] * 16;
          i++;
          this.meta = [];
          if (this.metaLen === 0) { this.metaLen = -1; this.left = this.metaint; }
        } else if (this.left === 0) {
          this.metaLen = -2; // bajt dužine stiže u sledećem paketu
        }
      } else if (this.metaLen === -2) {
        this.metaLen = chunk[i] * 16;
        i++;
        this.meta = [];
        if (this.metaLen === 0) { this.metaLen = -1; this.left = this.metaint; }
      } else {
        const n = Math.min(this.metaLen, chunk.length - i);
        this.meta.push(chunk.subarray(i, i + n));
        i += n;
        this.metaLen -= n;
        if (this.metaLen === 0) {
          const text = Buffer.concat(this.meta).toString('utf8').replace(/\0+$/, '');
          const m = text.match(/StreamTitle='(.*?)';/);
          if (m) this.onTitle(m[1].trim());
          this.metaLen = -1;
          this.left = this.metaint;
        }
      }
    }
    cb();
  }
}

export async function proxyAudio(req, res, url, { icy = false, onTitle } = {}) {
  let u;
  try { u = new URL(url); } catch { res.writeHead(400).end('Neispravna adresa'); return; }
  if (!['http:', 'https:'].includes(u.protocol)) { res.writeHead(400).end('Nepodržan protokol'); return; }

  const headers = {};
  if (req.headers.range && !icy) headers.Range = req.headers.range;
  if (icy) headers['Icy-MetaData'] = '1';

  let up;
  try {
    ({ up } = await open(u.href, headers));
  } catch (e) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Izvor nije dostupan: ' + e.message);
    return;
  }

  const status = up.statusCode || 200;
  if (status >= 400) {
    up.destroy?.();
    res.writeHead(status === 404 ? 404 : 502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Izvor je vratio grešku ' + status);
    return;
  }

  const out = { 'Cache-Control': 'no-store' };
  const metaint = icy ? Number(up.headers['icy-metaint']) : 0;
  for (const h of PASS_HEADERS) {
    if (up.headers[h] && !(metaint && h === 'content-length')) out[h] = up.headers[h];
  }
  out['content-type'] = fixType(up.headers['content-type'], u.href);
  if (icy && up.headers['icy-name']) out['X-Station-Name'] = encodeURIComponent(up.headers['icy-name']);

  res.writeHead(status === 206 ? 206 : 200, out);
  const cleanup = () => up.destroy?.();
  req.on('close', cleanup);
  res.on('close', cleanup);
  up.on('error', () => res.destroy());

  if (metaint > 0 && onTitle) {
    up.pipe(new IcyStripper(metaint, onTitle)).pipe(res);
  } else {
    up.pipe(res);
  }
}

// The server fetches images and audio for the browser (lib/proxy.ts, /api/img). Those
// addresses come from outside (radio databases, uploaders), so the server only goes to the
// public internet: never to itself, the home network, or a cloud provider's internal services.
// TUNES_ALLOW_PRIVATE_UPSTREAM=1 lifts this (the proxy tests run a fake station on 127.0.0.1).
import dns from 'node:dns';
import net from 'node:net';

const allowPrivate = (): boolean => process.env.TUNES_ALLOW_PRIVATE_UPSTREAM === '1';

function v4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast/reserved
    || (a === 100 && b >= 64 && b <= 127)             // carrier-grade NAT (Tailscale)
    || (a === 169 && b === 254)                       // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));         // benchmarking
}

export function isPrivateIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(addr)) return v4Private(addr);
  if (!net.isIPv6(addr)) return true; // not an address at all: refuse
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return v4Private(mapped[1]);
  return addr === '::' || addr === '::1' || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || /^ff/.test(addr);
}

export class BlockedAddress extends Error {
  status = 403;
  code = 'EPRIVATE';
  constructor() { super('Address not allowed'); }
}

// For http.request / net.connect: resolves like the system does, but refuses private
// addresses. Used for every connection, so redirects and DNS tricks are covered too.
export const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) { (callback as (e: Error) => void)(err); return; }
    const list = addresses as dns.LookupAddress[];
    if (!allowPrivate() && list.some((a) => isPrivateIp(a.address))) { (callback as (e: Error) => void)(new BlockedAddress()); return; }
    if ((options as dns.LookupOptions).all) (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    else (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

// Throws for an address the server must not fetch. A name that doesn't resolve is let
// through: the request fails by itself.
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedAddress();
  if (allowPrivate()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new BlockedAddress();
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new BlockedAddress(); return u; }
  const found = await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (found.some((a) => isPrivateIp(a.address))) throw new BlockedAddress();
  return u;
}

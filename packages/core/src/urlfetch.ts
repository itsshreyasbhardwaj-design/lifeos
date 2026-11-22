/**
 * Fetching a URL the user captured — without becoming an SSRF proxy.
 *
 *  - http(s) on ports 80/443 only, no credentials in the URL.
 *  - Every hostname is resolved and *every* address checked against private,
 *    loopback, link-local, CGNAT, multicast and reserved ranges.
 *  - The socket connects to the address we checked (custom `lookup`), so a DNS
 *    answer cannot change between the check and the connection (rebinding).
 *  - Redirects are followed manually (max 3) and each hop is re-validated.
 *  - 8 s timeout, 1.5 MB cap, text/html or text/plain only.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { invalid } from './errors.ts';

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedAddress(mapped[1]!);
    if (/^(fc|fd)/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('2001:db8') || s.startsWith('64:ff9b') || s.startsWith('100::')) return true;
    return false;
  }
  return true;
}

export async function assertPublicUrl(raw: string, resolver: Resolver = defaultResolver): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('That is not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Only http and https links can be captured.');
  if (url.username || url.password) throw invalid('Links with embedded credentials are not accepted.');
  if (url.port && !['80', '443'].includes(url.port)) throw invalid('Links on non-standard ports are not fetched.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw invalid('Private network addresses are not fetched.');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host).catch(() => []);
  if (!addrs.length) throw invalid('That address could not be found.');
  if (addrs.some((a) => isBlockedAddress(a.address))) throw invalid('Private network addresses are not fetched.');
  return { url, address: addrs[0]!.address, family: addrs[0]!.family };
}

export interface FetchedPage {
  finalUrl: string;
  title: string | null;
  description: string | null;
  text: string;
  contentType: string;
}

const MAX_BYTES = 1_500_000;

export async function fetchPage(raw: string, opts: { resolver?: Resolver; timeoutMs?: number } = {}): Promise<FetchedPage> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const { url, address, family } = await assertPublicUrl(current, opts.resolver);
    const res = await request(url, address, family, opts.timeoutMs ?? 8000);
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, url).toString();
      continue;
    }
    if (res.status >= 400) throw invalid(`The page answered with HTTP ${res.status}.`);
    const ct = res.contentType.toLowerCase();
    if (!ct.startsWith('text/html') && !ct.startsWith('text/plain') && !ct.startsWith('application/xhtml')) throw invalid('Only web pages and plain text are read from links.');
    const body = res.body.toString('utf8');
    if (ct.startsWith('text/plain')) return { finalUrl: url.toString(), title: null, description: null, text: body.slice(0, 50_000), contentType: ct };
    return { finalUrl: url.toString(), ...htmlToText(body), contentType: ct };
  }
  throw invalid('Too many redirects.');
}

function request(url: URL, address: string, family: number, timeoutMs: number): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: 'GET',
        headers: { 'user-agent': 'LifeOS-LinkCapture/0.1 (+self-hosted)', accept: 'text/html,text/plain;q=0.9', 'accept-encoding': 'identity' },
        // Pin the connection to the address that passed the check.
        lookup: (_h: string, _o: unknown, cb: (err: Error | null, addr: string, fam: number) => void) => cb(null, address, family),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(invalid('The page is too large to capture.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
      },
    );
    req.on('timeout', () => req.destroy(invalid('The page took too long to respond.')));
    req.on('error', reject);
    req.end();
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): { title: string | null; description: string | null; text: string } {
  const meta = (name: string) => new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1] ?? null;
  const title = decode(meta('og:title') ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim() || null;
  const description = decode(meta('description') ?? meta('og:description') ?? '').trim() || null;
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 50_000);
  return { title, description, text };
}

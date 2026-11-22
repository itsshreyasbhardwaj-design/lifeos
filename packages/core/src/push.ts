/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption
 * (RFC 8291), implemented on node:crypto. No third-party push library.
 *
 * What this can promise: a 201 from the push service means the service
 * *accepted* the message. Whether the device shows it depends on the browser,
 * the OS, battery settings and whether the PWA is installed — LifeOS records
 * "accepted", never "seen".
 */
import { createCipheriv, createECDH, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Queryable } from './db.ts';
import { repoRoot } from './db.ts';
import { invalid } from './errors.ts';
import { newId } from './ids.ts';
import type { PushMessage, PushSender, PushSubscriptionRow } from './reminders.ts';

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

interface Vapid {
  publicKey: string; // base64url, 65-byte uncompressed point
  privatePem: string;
  subject: string;
}

let vapid: Vapid | null = null;

export function vapidKeys(): Vapid {
  if (vapid) return vapid;
  const subject = process.env.LIFEOS_VAPID_SUBJECT ?? 'mailto:admin@lifeos.invalid';
  if (process.env.LIFEOS_VAPID_PRIVATE_PEM && process.env.LIFEOS_VAPID_PUBLIC) {
    vapid = { publicKey: process.env.LIFEOS_VAPID_PUBLIC, privatePem: process.env.LIFEOS_VAPID_PRIVATE_PEM.replace(/\\n/g, '\n'), subject };
    return vapid;
  }
  const path = join(repoRoot(), 'data', 'vapid.json');
  if (!existsSync(path)) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ publicKey: b64u(raw), privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 });
  }
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { publicKey: string; privatePem: string };
  vapid = { ...saved, subject };
  return vapid;
}

export function vapidJwt(endpoint: string, now = Date.now()): string {
  const v = vapidKeys();
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })));
  const sig = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey(v.privatePem), dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(sig)}`;
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** RFC 8291 §3 + RFC 8188 single-record encoding. */
export function encryptPayload(plaintext: Buffer, uaPublicB64: string, authB64: string, opts: { salt?: Buffer; ecdh?: ReturnType<typeof createECDH> } = {}): Buffer {
  const uaPublic = unb64u(uaPublicB64);
  const authSecret = unb64u(authB64);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw invalid('Malformed push subscription keys.');
  const ecdh = opts.ecdh ?? createECDH('prime256v1');
  if (!opts.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const salt = opts.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/**
 * Push endpoints are user-supplied URLs the server will POST to, so they are
 * restricted to the browser vendors' push services (no SSRF into the network).
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/];

export function assertPushEndpoint(endpoint: string): void {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw invalid('Invalid push endpoint.');
  }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname))) throw invalid('Push endpoints must belong to a browser push service.');
}

export async function savePushSubscription(q: Queryable, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null): Promise<void> {
  assertPushEndpoint(sub.endpoint);
  if (unb64u(sub.keys.p256dh).length !== 65 || unb64u(sub.keys.auth).length !== 16) throw invalid('Malformed push subscription keys.');
  await q.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, disabled_at = NULL, failure_count = 0`,
    [newId('psh'), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
}

export async function removePushSubscription(q: Queryable, userId: string, endpoint: string): Promise<void> {
  await q.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}

/** The production sender: POSTs an encrypted message to the push service. */
export const webPushSender: PushSender = async (sub: PushSubscriptionRow, msg: PushMessage) => {
  assertPushEndpoint(sub.endpoint);
  const body = encryptPayload(Buffer.from(JSON.stringify(msg)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${vapidJwt(sub.endpoint)}, k=${vapidKeys().publicKey}` },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
};

export { createPublicKey };

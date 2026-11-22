/**
 * Password hashing, token hashing, HMAC and envelope encryption.
 * Pure JS / node:crypto only — no native builds.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argon2idAsync } from '@noble/hashes/argon2';
import { repoRoot } from './db.ts';

// OWASP floor for Argon2id: 19 MiB, 2 iterations, 1 lane. Tests may lower the
// cost with LIFEOS_ARGON_FAST=1 so suites stay fast; production refuses it.
const ARGON =
  process.env.LIFEOS_ARGON_FAST === '1' && process.env.NODE_ENV !== 'production'
    ? { m: 1024, t: 1, p: 1 }
    : { m: 19_456, t: 2, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2idAsync(password, salt, { ...ARGON, dkLen: 32 });
  return ['', 'argon2id', 'v=19', `m=${ARGON.m},t=${ARGON.t},p=${ARGON.p}`, salt.toString('base64'), Buffer.from(hash).toString('base64')].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$').filter(Boolean);
  if (parts.length !== 5 || parts[0] !== 'argon2id') return false;
  const params = Object.fromEntries(parts[2]!.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k!, Number(v)])) as { m: number; t: number; p: number };
  const salt = Buffer.from(parts[3]!, 'base64');
  const expected = Buffer.from(parts[4]!, 'base64');
  const actual = Buffer.from(await argon2idAsync(password, salt, { ...params, dkLen: expected.length }));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A precomputed hash so login timing does not reveal whether an email exists. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password-for-timing-only');
  return dummyHash;
}

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ------------------------------------------------------------------ server secret

let secret: Buffer | null = null;

/**
 * The server secret keys file encryption and HMACs. In production it must come
 * from LIFEOS_SECRET. In development one is generated once into data/ (git-ignored)
 * so a fresh clone runs without setup.
 */
export function serverSecret(): Buffer {
  if (secret) return secret;
  const fromEnv = process.env.LIFEOS_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('LIFEOS_SECRET must be at least 32 characters.');
    secret = Buffer.from(fromEnv, 'utf8');
    return secret;
  }
  if (process.env.NODE_ENV === 'production' && process.env.LIFEOS_ALLOW_GENERATED_SECRET !== '1') {
    throw new Error('LIFEOS_SECRET is required in production.');
  }
  const path = join(repoRoot(), 'data', 'secret.key');
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(48).toString('base64'), { mode: 0o600 });
  }
  secret = Buffer.from(readFileSync(path, 'utf8').trim(), 'utf8');
  return secret;
}

function subkey(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret(), Buffer.alloc(0), Buffer.from(`lifeos:${purpose}`), 32));
}

export function hmac(purpose: string, data: string): string {
  return createHmac('sha256', subkey(`hmac:${purpose}`)).update(data).digest('base64url');
}

// ------------------------------------------------------------------ envelope encryption

/**
 * File encryption at rest: each file gets a random data key; the data key is
 * wrapped with a key derived from the server secret. Format:
 *   'LOS1' | wrapIv(12) | wrapTag(16) | wrappedKey(32) | iv(12) | tag(16) | ciphertext
 * Rotating the server secret means re-wrapping 32-byte keys, not re-encrypting files.
 */
const MAGIC = Buffer.from('LOS1');

export function encryptBlob(plain: Buffer): Buffer {
  const dataKey = randomBytes(32);
  const wrapIv = randomBytes(12);
  const w = createCipheriv('aes-256-gcm', subkey('file-kek'), wrapIv);
  const wrapped = Buffer.concat([w.update(dataKey), w.final()]);
  const wrapTag = w.getAuthTag();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, wrapIv, wrapTag, wrapped, iv, c.getAuthTag(), body]);
}

export function decryptBlob(blob: Buffer): Buffer {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error('Unrecognised file format');
  let o = 4;
  const take = (n: number) => blob.subarray(o, (o += n));
  const wrapIv = take(12);
  const wrapTag = take(16);
  const wrapped = take(32);
  const iv = take(12);
  const tag = take(16);
  const body = blob.subarray(o);
  const w = createDecipheriv('aes-256-gcm', subkey('file-kek'), wrapIv);
  w.setAuthTag(wrapTag);
  const dataKey = Buffer.concat([w.update(wrapped), w.final()]);
  const d = createDecipheriv('aes-256-gcm', dataKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

/** Small-string encryption for secrets stored in the database (TOTP seeds). */
export function sealString(plain: string): string {
  return encryptBlob(Buffer.from(plain, 'utf8')).toString('base64');
}
export function openString(sealed: string): string {
  return decryptBlob(Buffer.from(sealed, 'base64')).toString('utf8');
}

// ------------------------------------------------------------------ TOTP (RFC 6238)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('bad base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function totp(secretB32: string, at = Date.now(), step = 30): string {
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** Accepts the current code and one step either side for clock drift. */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totp(secretB32, at + w * 30_000), c));
}

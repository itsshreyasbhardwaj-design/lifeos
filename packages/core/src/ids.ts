import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

/** Prefixed random id, e.g. `tsk_8f3k2m9q4v7x1c5b6n0p`. 100 bits of entropy. */
export function newId(prefix: string): string {
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += ALPHABET[bytes[i]! & 31];
  return `${prefix}_${out}`;
}

/** URL-safe secret token (sessions, invitations, API tokens). 256 bits. */
export function newToken(prefix = ''): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LIFEOS_ARGON_FAST = '1';
process.env.LIFEOS_SECRET ??= 'test-secret-test-secret-test-secret-0123456789';
process.env.LIFEOS_FILES_DIR ??= mkdtempSync(join(tmpdir(), 'lifeos-files-'));
process.env.LIFEOS_FETCH_URLS = '0';

const { connect } = await import('../src/db.ts');
const { register } = await import('../src/auth.ts');
const { ctxFor } = await import('../src/context.ts');
const { personalWorkspaceId } = await import('../src/access.ts');

export async function setup() {
  const db = await connect({ url: 'memory://' });
  let n = 0;
  async function user(name = `User ${++n}`, opts: { timezone?: string } = {}) {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Math.random().toString(36).slice(2, 8)}@example.test`;
    const s = await register(db, { email, password: 'correct horse battery', displayName: name, timezone: opts.timezone ?? 'Asia/Kolkata' });
    const ws = await personalWorkspaceId(db, s.userId);
    return { id: s.userId, email, ws, token: s.token, ctx: (now = new Date()) => ctxFor(db, s.userId, now) };
  }
  return { db, user };
}

export const at = (iso: string) => new Date(iso);

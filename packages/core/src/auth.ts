/**
 * Accounts, sessions, API tokens and TOTP second factor.
 *
 * Session tokens are random 256-bit values; only their SHA-256 is stored, so a
 * database leak does not yield usable sessions.
 */
import { z } from 'zod';
import type { Db, Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import { conflict, invalid, unauthorized } from './errors.ts';
import { newId, newToken } from './ids.ts';
import { audit } from './audit.ts';
import { dummyPasswordHash, hashPassword, newTotpSecret, openString, sealString, sha256, verifyPassword, verifyTotp } from './crypto.ts';
import { hit, resetLimit } from './ratelimit.ts';
import { ensureBillingRow } from './billing.ts';
import { isValidTimezone } from './time.ts';
import type { Q } from './context.ts';

export const SESSION_DAYS = 30;
export const SUPPORTED_LOCALES = ['en-IN', 'hi-IN', 'bn-IN', 'en-US', 'en-GB'] as const;

export interface User {
  id: string;
  email: string;
  display_name: string;
  locale: string;
  timezone: string;
  date_order: 'DMY' | 'MDY' | 'YMD';
  currency: string;
  default_reminder_time: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  onboarding_goals: string[];
  onboarded_at: Date | null;
  is_minor: boolean;
  mfa_enabled_at: Date | null;
  created_at: Date;
}

const USER_COLS = `id, email, display_name, locale, timezone, date_order, currency, to_char(default_reminder_time, 'HH24:MI') AS default_reminder_time,
  to_char(quiet_hours_start, 'HH24:MI') AS quiet_hours_start, to_char(quiet_hours_end, 'HH24:MI') AS quiet_hours_end,
  onboarding_goals, onboarded_at, is_minor, mfa_enabled_at, created_at`;

export async function getUser(q: Queryable, id: string): Promise<User | null> {
  return one<User>(q, `SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
}

export const passwordSchema = z.string().min(10, 'Use at least 10 characters.').max(200);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'Enter your name.').max(80),
  locale: z.enum(SUPPORTED_LOCALES).default('en-IN'),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone.').default('Asia/Kolkata'),
});

export interface SessionResult {
  token: string;
  userId: string;
  expiresAt: Date;
  mfaPending: boolean;
}

async function createSession(q: Queryable, userId: string, userAgent: string | null, mfaPending: boolean, now: Date): Promise<SessionResult> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await q.query('INSERT INTO sessions (id, user_id, expires_at, user_agent, mfa_pending, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$6)', [
    sha256(token), userId, expiresAt, userAgent?.slice(0, 300) ?? null, mfaPending, now,
  ]);
  return { token, userId, expiresAt, mfaPending };
}

export async function register(db: Q, input: z.input<typeof registerSchema>, meta: { userAgent?: string | null; ip?: string | null; now?: Date } = {}): Promise<SessionResult> {
  const now = meta.now ?? new Date();
  const data = registerSchema.parse(input);
  return withTx(db, async (q) => {
    if (meta.ip) await hit(q, `register:${sha256(meta.ip)}`, 10, 3600, now);
    const exists = await one(q, 'SELECT 1 FROM users WHERE lower(email) = $1', [data.email]);
    if (exists) throw conflict('An account with this email already exists.');
    const id = newId('usr');
    const order = data.locale === 'en-US' ? 'MDY' : 'DMY';
    await q.query('INSERT INTO users (id, email, password_hash, display_name, locale, timezone, date_order) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      id, data.email, await hashPassword(data.password), data.displayName, data.locale, data.timezone, order,
    ]);
    const ws = newId('wsp');
    await q.query(`INSERT INTO workspaces (id, kind, name, owner_id) VALUES ($1,'personal',$2,$3)`, [ws, 'Personal', id]);
    await q.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [ws, id]);
    await ensureBillingRow(q, id);
    await audit(q, { actorId: id, workspaceId: ws, action: 'auth.registered' });
    return createSession(q, id, meta.userAgent ?? null, false, now);
  });
}

export async function login(
  db: Q,
  input: { email: string; password: string },
  meta: { userAgent?: string | null; ip?: string | null; now?: Date } = {},
): Promise<SessionResult> {
  const now = meta.now ?? new Date();
  const email = String(input.email ?? '').trim().toLowerCase();
  const limitKey = `login:${sha256(email)}`;
  // Count attempts outside the main transaction so a failed login still counts.
  await hit(db as Queryable, limitKey, 8, 15 * 60, now);
  if (meta.ip) await hit(db as Queryable, `login-ip:${sha256(meta.ip)}`, 40, 15 * 60, now);
  const row = await one<{ id: string; password_hash: string; mfa_enabled_at: Date | null }>(db as Queryable, 'SELECT id, password_hash, mfa_enabled_at FROM users WHERE lower(email) = $1', [email]);
  const ok = await verifyPassword(String(input.password ?? ''), row?.password_hash ?? (await dummyPasswordHash()));
  if (!row || !ok) {
    await audit(db as Queryable, { action: 'auth.login_failed', meta: { known: Boolean(row) } });
    throw unauthorized('Email or password is incorrect.');
  }
  await resetLimit(db as Queryable, limitKey);
  const session = await createSession(db as Queryable, row.id, meta.userAgent ?? null, Boolean(row.mfa_enabled_at), now);
  await audit(db as Queryable, { actorId: row.id, action: 'auth.login', meta: { mfa: Boolean(row.mfa_enabled_at) } });
  return session;
}

export interface SessionInfo {
  sessionId: string;
  user: User;
  mfaPending: boolean;
}

/** Validates a session token. Sliding expiry: activity extends it. */
export async function authenticate(q: Queryable, token: string | undefined | null, now = new Date()): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const id = sha256(token);
  const s = await one<{ user_id: string; expires_at: Date; revoked_at: Date | null; mfa_pending: boolean; last_seen_at: Date }>(
    q, 'SELECT user_id, expires_at, revoked_at, mfa_pending, last_seen_at FROM sessions WHERE id = $1', [id],
  );
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() <= now.getTime()) return null;
  const user = await getUser(q, s.user_id);
  if (!user) return null;
  // Touch at most every 10 minutes to avoid a write per request.
  if (now.getTime() - new Date(s.last_seen_at).getTime() > 600_000) {
    await q.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1', [id, now, new Date(now.getTime() + SESSION_DAYS * 86_400_000)]);
  }
  return { sessionId: id, user, mfaPending: s.mfa_pending };
}

export async function logout(q: Queryable, token: string): Promise<void> {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sha256(token)]);
}

export async function listSessions(q: Queryable, userId: string) {
  return q.query<{ id: string; created_at: Date; last_seen_at: Date; user_agent: string | null }>(
    'SELECT id, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC',
    [userId],
  );
}

export async function revokeSession(q: Queryable, userId: string, sessionId: string): Promise<void> {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2', [sessionId, userId]);
  await audit(q, { actorId: userId, action: 'auth.session_revoked' });
}

export async function changePassword(db: Db, userId: string, current: string, next: string, keepSessionId: string | null): Promise<void> {
  passwordSchema.parse(next);
  await withTx(db, async (q) => {
    const row = await one<{ password_hash: string }>(q, 'SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!row || !(await verifyPassword(current, row.password_hash))) throw unauthorized('Current password is incorrect.');
    await q.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, await hashPassword(next)]);
    // Every other session is signed out.
    await q.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id IS DISTINCT FROM $2 AND revoked_at IS NULL', [userId, keepSessionId]);
    await audit(q, { actorId: userId, action: 'auth.password_changed' });
  });
}

// ------------------------------------------------------------------ TOTP

export async function beginMfaSetup(q: Queryable, userId: string): Promise<{ secret: string; otpauth: string }> {
  const u = await getUser(q, userId);
  if (!u) throw unauthorized();
  if (u.mfa_enabled_at) throw invalid('Two-step verification is already on.');
  const secret = newTotpSecret();
  await q.query('UPDATE users SET mfa_totp_secret = $2 WHERE id = $1', [userId, sealString(secret)]);
  return { secret, otpauth: `otpauth://totp/LifeOS:${encodeURIComponent(u.email)}?secret=${secret}&issuer=LifeOS&digits=6&period=30` };
}

export async function enableMfa(q: Queryable, userId: string, code: string, now = Date.now()): Promise<void> {
  const row = await one<{ mfa_totp_secret: string | null }>(q, 'SELECT mfa_totp_secret FROM users WHERE id = $1', [userId]);
  if (!row?.mfa_totp_secret || !verifyTotp(openString(row.mfa_totp_secret), code, now)) throw invalid('That code is not right. Check the time on your phone and try again.');
  await q.query('UPDATE users SET mfa_enabled_at = now() WHERE id = $1', [userId]);
  await audit(q, { actorId: userId, action: 'auth.mfa_enabled' });
}

export async function completeMfaLogin(q: Queryable, token: string, code: string, now = new Date()): Promise<void> {
  const id = sha256(token);
  const s = await one<{ user_id: string; mfa_pending: boolean }>(q, 'SELECT user_id, mfa_pending FROM sessions WHERE id = $1 AND revoked_at IS NULL', [id]);
  if (!s) throw unauthorized();
  if (!s.mfa_pending) return;
  await hit(q, `mfa:${id}`, 6, 900, now);
  const row = await one<{ mfa_totp_secret: string | null }>(q, 'SELECT mfa_totp_secret FROM users WHERE id = $1', [s.user_id]);
  if (!row?.mfa_totp_secret || !verifyTotp(openString(row.mfa_totp_secret), code, now.getTime())) throw unauthorized('That code is not right.');
  await q.query('UPDATE sessions SET mfa_pending = false WHERE id = $1', [id]);
  await audit(q, { actorId: s.user_id, action: 'auth.mfa_passed' });
}

// ------------------------------------------------------------------ API tokens (extension, mobile)

export const API_SCOPES = ['capture:write', 'tasks:write', 'read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export async function createApiToken(q: Queryable, userId: string, name: string, scopes: ApiScope[]): Promise<{ id: string; token: string }> {
  if (!scopes.length || scopes.some((s) => !API_SCOPES.includes(s))) throw invalid('Choose at least one valid scope.');
  const token = newToken('lfo_');
  const id = newId('tok');
  await q.query('INSERT INTO api_tokens (id, user_id, name, token_hash, scopes) VALUES ($1,$2,$3,$4,$5)', [id, userId, name.slice(0, 80) || 'Token', sha256(token), scopes]);
  await audit(q, { actorId: userId, action: 'auth.api_token_created', entityType: 'api_token', entityId: id, meta: { scopes } });
  return { id, token };
}

export async function authenticateApiToken(q: Queryable, token: string | null | undefined, scope: ApiScope): Promise<User | null> {
  if (!token?.startsWith('lfo_')) return null;
  const row = await one<{ id: string; user_id: string; scopes: string[] }>(q, 'SELECT id, user_id, scopes FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
  if (!row || !row.scopes.includes(scope)) return null;
  await q.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [row.id]);
  return getUser(q, row.user_id);
}

export async function listApiTokens(q: Queryable, userId: string) {
  return q.query('SELECT id, name, scopes, created_at, last_used_at FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC', [userId]);
}

export async function revokeApiToken(q: Queryable, userId: string, id: string): Promise<void> {
  await q.query('UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2', [id, userId]);
  await audit(q, { actorId: userId, action: 'auth.api_token_revoked', entityType: 'api_token', entityId: id });
}

// ------------------------------------------------------------------ preferences

export const preferencesSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone.').optional(),
  dateOrder: z.enum(['DMY', 'MDY', 'YMD']).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  defaultReminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  onboardingGoals: z.array(z.enum(['tasks', 'documents', 'purchases', 'subscriptions', 'commitments', 'family', 'events', 'everything'])).max(8).optional(),
  onboarded: z.boolean().optional(),
});

export async function updatePreferences(q: Queryable, userId: string, input: z.input<typeof preferencesSchema>): Promise<User> {
  const p = preferencesSchema.parse(input);
  const sets: string[] = [];
  const vals: unknown[] = [userId];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (p.displayName !== undefined) set('display_name', p.displayName);
  if (p.locale !== undefined) set('locale', p.locale);
  if (p.timezone !== undefined) set('timezone', p.timezone);
  if (p.dateOrder !== undefined) set('date_order', p.dateOrder);
  if (p.currency !== undefined) set('currency', p.currency);
  if (p.defaultReminderTime !== undefined) set('default_reminder_time', p.defaultReminderTime);
  if (p.quietHoursStart !== undefined) set('quiet_hours_start', p.quietHoursStart);
  if (p.quietHoursEnd !== undefined) set('quiet_hours_end', p.quietHoursEnd);
  if (p.onboardingGoals !== undefined) set('onboarding_goals', p.onboardingGoals);
  if (p.onboarded) sets.push('onboarded_at = COALESCE(onboarded_at, now())');
  if (sets.length) await q.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  return (await getUser(q, userId))!;
}

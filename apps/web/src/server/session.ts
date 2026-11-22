import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, type User } from '@lifeos/core/auth';
import { memberships, type Membership } from '@lifeos/core/access';
import { ctxFor, type Ctx } from '@lifeos/core/context';
import { getDb } from './runtime';

export const SESSION_COOKIE = 'lifeos_session';
export const WORKSPACE_COOKIE = 'lifeos_ws';

export interface Session {
  ctx: Ctx;
  user: User;
  sessionId: string;
  spaces: Membership[];
  active: Membership;
  token: string;
}

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const s = await authenticate(db, token);
  if (!s || s.mfaPending) return null;
  const spaces = await memberships(db, s.user.id);
  const wanted = jar.get(WORKSPACE_COOKIE)?.value;
  const active = spaces.find((m) => m.workspaceId === wanted) ?? spaces.find((m) => m.kind === 'personal') ?? spaces[0]!;
  return { ctx: ctxFor(db, s.user.id), user: s.user, sessionId: s.sessionId, spaces, active, token };
}

/** For pages under /app: redirects to sign-in when there is no valid session. */
export async function requireSession(): Promise<Session> {
  const s = await readSession();
  if (!s) {
    const h = await headers();
    const path = h.get('x-lifeos-path') ?? '/app';
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return s;
}

export function sessionCookie(token: string, expires: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.LIFEOS_INSECURE_COOKIES !== '1',
    path: '/',
    expires,
  };
}

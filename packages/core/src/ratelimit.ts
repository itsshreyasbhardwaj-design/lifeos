import type { Queryable } from './db.ts';
import { rateLimited } from './errors.ts';

/**
 * Fixed-window counter persisted in Postgres, so limits survive restarts and
 * hold across processes. Throws when the window's limit is exceeded.
 */
export async function hit(q: Queryable, key: string, limit: number, windowSeconds: number, now = new Date()): Promise<void> {
  const rows = await q.query<{ count: number; reset_at: Date }>(
    `INSERT INTO rate_limit_buckets (key, count, reset_at) VALUES ($1, 1, $2::timestamptz + make_interval(secs => $3))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit_buckets.reset_at <= $2 THEN 1 ELSE rate_limit_buckets.count + 1 END,
       reset_at = CASE WHEN rate_limit_buckets.reset_at <= $2 THEN $2::timestamptz + make_interval(secs => $3) ELSE rate_limit_buckets.reset_at END
     RETURNING count, reset_at`,
    [key, now, windowSeconds],
  );
  const r = rows[0]!;
  if (r.count > limit) throw rateLimited(Math.max(1, Math.ceil((new Date(r.reset_at).getTime() - now.getTime()) / 1000)));
}

export async function resetLimit(q: Queryable, key: string): Promise<void> {
  await q.query('DELETE FROM rate_limit_buckets WHERE key = $1', [key]);
}

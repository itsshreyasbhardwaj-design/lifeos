/**
 * Durable background jobs in Postgres. Claiming uses FOR UPDATE SKIP LOCKED,
 * so several workers can share the table without taking the same job.
 * Failed jobs back off exponentially and become `dead` after max_attempts.
 */
import type { Db, Queryable } from './db.ts';
import { newId } from './ids.ts';

export type JobHandler = (db: Db, payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJob(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export async function enqueue(q: Queryable, kind: string, payload: Record<string, unknown>, opts: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {}): Promise<string | null> {
  const rows = await q.query<{ id: string }>(
    `INSERT INTO background_jobs (id, kind, payload, dedupe_key, run_after, max_attempts) VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [newId('job'), kind, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAfter ?? null, opts.maxAttempts ?? 5],
  );
  return rows[0]?.id ?? null;
}

interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export async function claimJob(db: Db, workerId: string): Promise<JobRow | null> {
  return db.tx(async (q) => {
    const rows = await q.query<JobRow>(
      `UPDATE background_jobs SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
        WHERE id = (
          SELECT id FROM background_jobs
           WHERE (status IN ('queued', 'failed') AND run_after <= now())
              OR (status = 'running' AND locked_at < now() - interval '10 minutes')
           ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, kind, payload, attempts, max_attempts`,
      [workerId],
    );
    return rows[0] ?? null;
  });
}

/** Runs up to `limit` ready jobs. Returns how many ran and how many failed. */
export async function runJobs(db: Db, opts: { workerId?: string; limit?: number } = {}): Promise<{ ran: number; failed: number }> {
  const workerId = opts.workerId ?? `w-${process.pid}`;
  let ran = 0;
  let failed = 0;
  for (let i = 0; i < (opts.limit ?? 20); i++) {
    const job = await claimJob(db, workerId);
    if (!job) break;
    ran++;
    const handler = handlers.get(job.kind);
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
      // A job that never settles must not hold the loop: fail it after the timeout
      // (it is retried with backoff, then marked dead).
      const limit = Number(process.env.LIFEOS_JOB_TIMEOUT_MS ?? 180_000);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        handler(db, job.payload),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`job exceeded ${Math.round(limit / 1000)} s`)), limit);
        }),
      ]).finally(() => clearTimeout(timer));
      await db.query(`UPDATE background_jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = $1`, [job.id]);
    } catch (err) {
      failed++;
      const dead = job.attempts >= job.max_attempts;
      const backoffSec = Math.min(3600, 2 ** job.attempts * 15);
      await db.query(
        `UPDATE background_jobs SET status = $2, last_error = $3, run_after = now() + make_interval(secs => $4), updated_at = now() WHERE id = $1`,
        [job.id, dead ? 'dead' : 'failed', String((err as Error).message ?? err).slice(0, 1000), backoffSec],
      );
    }
  }
  return { ran, failed };
}

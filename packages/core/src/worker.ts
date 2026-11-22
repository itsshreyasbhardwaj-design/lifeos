/**
 * The background loops: durable jobs, reminder delivery, routine reminders and
 * automation evaluation. Runs in-process next to the web server (embedded
 * PostgreSQL) or as `pnpm worker` against a PostgreSQL server.
 *
 * Jobs and reminders run on separate loops, so a slow OCR job can never
 * delay a reminder.
 */
import type { Db } from './db.ts';
import { runJobs } from './jobs.ts';
import { deliverDue, type PushSender } from './reminders.ts';
import { scheduleRoutineReminders } from './planning.ts';
import { evaluateAutomations } from './intelligence.ts';
import './captures.ts';
import './documents.ts';

export interface TickReport {
  jobs: { ran: number; failed: number };
  reminders: Awaited<ReturnType<typeof deliverDue>>;
  routines: number;
  proposals: number;
}

let lastHourly = 0;

async function hourly(db: Db, now: Date, force = false): Promise<{ routines: number; proposals: number }> {
  if (!force && now.getTime() - lastHourly < 3_600_000) return { routines: 0, proposals: 0 };
  lastHourly = now.getTime();
  return { routines: await scheduleRoutineReminders(db, now), proposals: await evaluateAutomations(db, now) };
}

/** One pass of everything — used by tests and the cron endpoint. */
export async function tick(db: Db, now = new Date(), opts: { push?: PushSender; forceHourly?: boolean } = {}): Promise<TickReport> {
  const jobs = await runJobs(db, { limit: 10 });
  const reminders = await deliverDue(db, now, { push: opts.push });
  const h = await hourly(db, now, opts.forceHourly);
  return { jobs, reminders, ...h };
}

function loop(intervalMs: number, fn: () => Promise<void>, log?: (m: string) => void, name = 'loop'): () => void {
  let running = false;
  let stopped = false;
  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      log?.(`[lifeos-worker] ${name} failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function startWorker(getDb: () => Promise<Db>, opts: { intervalMs?: number; push?: PushSender; log?: (m: string) => void } = {}): () => void {
  const every = opts.intervalMs ?? 3000;
  const stops = [
    loop(every, async () => {
      const r = await runJobs(await getDb(), { limit: 5 });
      if (r.ran) opts.log?.(`[lifeos-worker] jobs ran=${r.ran} failed=${r.failed}`);
    }, opts.log, 'jobs'),
    loop(every, async () => {
      const db = await getDb();
      const r = await deliverDue(db, new Date(), { push: opts.push });
      if (r.delivered || r.cancelled || r.deferred) opts.log?.(`[lifeos-worker] reminders delivered=${r.delivered} cancelled=${r.cancelled} deferred=${r.deferred}`);
      await hourly(db, new Date());
    }, opts.log, 'reminders'),
  ];
  return () => stops.forEach((s) => s());
}

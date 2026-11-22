/**
 * The background loop: durable jobs, reminder delivery, routine reminders and
 * automation evaluation. Runs in-process next to the web server (single-node
 * / embedded Postgres) or as `pnpm worker` against a Postgres server.
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

export async function tick(db: Db, now = new Date(), opts: { push?: PushSender; forceHourly?: boolean } = {}): Promise<TickReport> {
  const jobs = await runJobs(db, { limit: 10 });
  const reminders = await deliverDue(db, now, { push: opts.push });
  let routines = 0;
  let proposals = 0;
  if (opts.forceHourly || now.getTime() - lastHourly > 3_600_000) {
    lastHourly = now.getTime();
    routines = await scheduleRoutineReminders(db, now);
    proposals = await evaluateAutomations(db, now);
  }
  return { jobs, reminders, routines, proposals };
}

export function startWorker(getDb: () => Promise<Db>, opts: { intervalMs?: number; push?: PushSender; log?: (m: string) => void } = {}): () => void {
  let running = false;
  let stopped = false;
  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      const r = await tick(await getDb(), new Date(), { push: opts.push });
      if (r.jobs.ran || r.reminders.delivered || r.reminders.cancelled) opts.log?.(`[lifeos-worker] jobs=${r.jobs.ran} delivered=${r.reminders.delivered} cancelled=${r.reminders.cancelled} deferred=${r.reminders.deferred}`);
    } catch (err) {
      opts.log?.(`[lifeos-worker] tick failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 3000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

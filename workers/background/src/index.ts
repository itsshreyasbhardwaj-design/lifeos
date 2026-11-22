/**
 * Standalone background worker for deployments with a PostgreSQL server
 * (DATABASE_URL=postgres://…). It runs the same loop the web server runs
 * in-process for embedded PostgreSQL: durable jobs, reminder delivery, routine
 * reminders and automation evaluation.
 *
 * With embedded PostgreSQL (PGlite) do NOT run this alongside the web server:
 * PGlite is single-process. The web server runs the loop itself.
 */
import { connect } from '../../../packages/core/src/db.ts';
import { startWorker } from '../../../packages/core/src/worker.ts';
import { webPushSender } from '../../../packages/core/src/push.ts';

if (!process.env.DATABASE_URL?.startsWith('postgres')) {
  console.error('The standalone worker needs DATABASE_URL=postgres://… . With embedded PostgreSQL the web server runs the worker in-process.');
  process.exit(1);
}
const db = await connect();
const stop = startWorker(async () => db, {
  intervalMs: Number(process.env.LIFEOS_WORKER_INTERVAL_MS ?? 3000),
  push: process.env.LIFEOS_PUSH === '0' ? undefined : webPushSender,
  log: (m) => console.log(new Date().toISOString(), m),
});
console.log('LifeOS worker running.');
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stop();
    await db.close();
    process.exit(0);
  });
}
await new Promise(() => {});

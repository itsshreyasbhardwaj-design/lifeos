import 'server-only';
import { connect, type Db } from '@lifeos/core/db';
import { startWorker } from '@lifeos/core/worker';
import { webPushSender } from '@lifeos/core/push';

/**
 * One database handle per process, shared across route bundles via globalThis.
 * This matters for embedded PostgreSQL: two PGlite instances on one data
 * directory would corrupt it.
 */
const KEY = Symbol.for('lifeos.runtime');
interface Runtime {
  db?: Promise<Db>;
  stopWorker?: () => void;
}
const g = globalThis as unknown as Record<symbol, Runtime | undefined>;

export function getDb(): Promise<Db> {
  const rt = (g[KEY] ??= {});
  rt.db ??= connect().catch((err: unknown) => {
    delete rt.db;
    throw err;
  });
  return rt.db;
}

/** Starts the in-process background worker once per server process. */
export function ensureWorker(): void {
  const rt = (g[KEY] ??= {});
  if (rt.stopWorker || process.env.LIFEOS_INPROCESS_WORKER === '0') return;
  rt.stopWorker = startWorker(getDb, {
    intervalMs: Number(process.env.LIFEOS_WORKER_INTERVAL_MS ?? 3000),
    push: process.env.LIFEOS_PUSH === '0' ? undefined : webPushSender,
    log: (m) => console.log(m),
  });
}

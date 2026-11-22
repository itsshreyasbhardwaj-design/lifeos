/**
 * Offline synchronisation. The PWA queues operations while offline and sends
 * them here in order. Rules (invariant 17):
 *   - creates carry a client id and are idempotent: replaying never duplicates;
 *   - updates carry the version they were based on; if the server moved on,
 *     nothing is overwritten — a conflict is stored for the user to resolve.
 */
import { z } from 'zod';
import type { Ctx } from './context.ts';
import { AppError } from './errors.ts';
import { newId } from './ids.ts';
import { one } from './db.ts';
import { createCapture } from './captures.ts';
import { createTask, setTaskStatus, taskInput, updateTask, type Task } from './tasks.ts';
import { loadScoped } from './access.ts';

const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const syncOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('capture.create'), clientId, workspaceId: z.string(), payload: z.object({ text: z.string().max(100_000).nullish(), url: z.string().max(2000).nullish(), title: z.string().max(300).nullish(), sourceType: z.enum(['text', 'note', 'paste', 'url']).default('note') }) }),
  z.object({ op: z.literal('task.create'), clientId, workspaceId: z.string(), payload: taskInput }),
  z.object({ op: z.literal('task.update'), id: z.string(), baseVersion: z.number().int(), payload: taskInput.partial() }),
  z.object({ op: z.literal('task.status'), id: z.string(), baseVersion: z.number().int(), status: z.enum(['open', 'in_progress', 'waiting', 'completed', 'cancelled']) }),
]);
export type SyncOp = z.infer<typeof syncOp>;

export type SyncResult =
  | { index: number; result: 'applied' | 'already_applied'; id: string }
  | { index: number; result: 'conflict'; id: string; conflictId: string }
  | { index: number; result: 'error'; error: string };

export async function syncBatch(ctx: Ctx, rawOps: unknown[]): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const [index, raw] of rawOps.slice(0, 200).entries()) {
    const parsed = syncOp.safeParse(raw);
    if (!parsed.success) {
      out.push({ index, result: 'error', error: 'Malformed operation' });
      continue;
    }
    const op = parsed.data;
    try {
      if (op.op === 'capture.create') {
        const r = await createCapture(ctx, op.workspaceId, { ...op.payload, clientId: op.clientId, sourceApp: 'pwa-offline' });
        out.push({ index, result: r.deduplicated ? 'already_applied' : 'applied', id: r.capture.id });
      } else if (op.op === 'task.create') {
        const existing = await one<{ id: string }>(ctx.db, 'SELECT id FROM tasks WHERE workspace_id = $1 AND created_by = $2 AND client_id = $3', [op.workspaceId, ctx.userId, op.clientId]);
        if (existing) {
          out.push({ index, result: 'already_applied', id: existing.id });
          continue;
        }
        const t = await createTask(ctx, op.workspaceId, op.payload);
        await ctx.db.query('UPDATE tasks SET client_id = $2 WHERE id = $1', [t.id, op.clientId]);
        out.push({ index, result: 'applied', id: t.id });
      } else {
        const cur = await loadScoped<Task>(ctx.db, ctx.userId, 'tasks', op.id, 'write', 'Task');
        if (op.op === 'task.status' && cur.status === op.status) {
          out.push({ index, result: 'already_applied', id: op.id });
          continue;
        }
        if (cur.version !== op.baseVersion) {
          const conflictId = newId('cnf');
          await ctx.db.query(
            `INSERT INTO sync_conflicts (id, user_id, workspace_id, entity_type, entity_id, base_version, server_version, client_payload, server_payload) VALUES ($1,$2,$3,'task',$4,$5,$6,$7,$8)`,
            [conflictId, ctx.userId, cur.workspace_id, op.id, op.baseVersion, cur.version, JSON.stringify(op.op === 'task.status' ? { status: op.status } : op.payload), JSON.stringify({ title: cur.title, status: cur.status, due_date: cur.due_date, due_time: cur.due_time, notes: cur.notes, priority: cur.priority })],
          );
          out.push({ index, result: 'conflict', id: op.id, conflictId });
          continue;
        }
        if (op.op === 'task.update') await updateTask(ctx, op.id, { ...op.payload, expectedVersion: op.baseVersion });
        else await setTaskStatus(ctx, op.id, { status: op.status });
        out.push({ index, result: 'applied', id: op.id });
      }
    } catch (err) {
      out.push({ index, result: 'error', error: err instanceof AppError ? err.message : 'Could not apply this change.' });
    }
  }
  return out;
}

export async function openConflicts(ctx: Ctx) {
  return ctx.db.query(`SELECT c.*, t.title AS current_title FROM sync_conflicts c LEFT JOIN tasks t ON t.id = c.entity_id WHERE c.user_id = $1 AND c.status = 'open' ORDER BY c.created_at`, [ctx.userId]);
}

/** The user decides. "mine" re-applies their offline change on top of the current version. */
export async function resolveConflict(ctx: Ctx, conflictId: string, keep: 'mine' | 'server') {
  const c = await one<{ entity_id: string; client_payload: Record<string, unknown>; status: string }>(ctx.db, 'SELECT * FROM sync_conflicts WHERE id = $1 AND user_id = $2', [conflictId, ctx.userId]);
  if (!c || c.status !== 'open') throw new AppError('not_found', 404, 'Conflict not found.');
  if (keep === 'mine') {
    const cur = await loadScoped<Task>(ctx.db, ctx.userId, 'tasks', c.entity_id, 'write', 'Task');
    if ('status' in c.client_payload && Object.keys(c.client_payload).length === 1) await setTaskStatus(ctx, c.entity_id, { status: c.client_payload.status as 'completed' });
    else await updateTask(ctx, c.entity_id, { ...(c.client_payload as object), expectedVersion: cur.version });
  }
  await ctx.db.query(`UPDATE sync_conflicts SET status = $2, resolved_at = now() WHERE id = $1`, [conflictId, keep === 'mine' ? 'kept_mine' : 'kept_server']);
}

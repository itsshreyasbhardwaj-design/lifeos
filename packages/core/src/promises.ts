/**
 * Promise Tracker / WaitingOS. Three directions: what I promised, what someone
 * promised me, and what I am waiting on. LifeOS records what the user says
 * happened; it never marks something fulfilled on its own.
 */
import { z } from 'zod';
import { isIsoDate } from '@lifeos/extract';
import type { Queryable } from './db.ts';
import { withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { invalid } from './errors.ts';
import { newId } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { loadScoped, requireRole } from './access.ts';
import { indexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { todayIn } from './time.ts';

const isoDate = z.string().refine(isIsoDate, 'Use a full date.');

export const promiseInput = z.object({
  direction: z.enum(['i_promised', 'they_promised', 'waiting_on']),
  description: z.string().trim().min(1).max(1000),
  counterparty: z.string().trim().max(200).nullish(),
  recordedOn: isoDate.nullish(),
  expectedBy: isoDate.nullish(),
  notes: z.string().max(5000).nullish(),
  followUpOn: isoDate.nullish(),
  sourceCaptureId: z.string().nullish(),
});

export interface PromiseRow {
  id: string; workspace_id: string; direction: string; description: string; counterparty: string | null; recorded_on: string; expected_by: string | null;
  status: string; notes: string | null; resolution_note: string | null; resolved_at: Date | null; source_capture_id: string | null; version: number; created_by: string | null; created_at: Date;
}

const DIRECTION_LABEL: Record<string, string> = { i_promised: 'You promised', they_promised: 'Promised to you', waiting_on: 'Waiting on' };

async function reindex(q: Queryable, p: PromiseRow) {
  await indexRecord(q, { entityType: 'promise', entityId: p.id, workspaceId: p.workspace_id, title: p.description, body: [DIRECTION_LABEL[p.direction], p.counterparty, p.notes].filter(Boolean).join('\n'), occursOn: p.expected_by, status: p.status });
}

export async function createPromise(ctx: Ctx, workspaceId: string, input: z.input<typeof promiseInput>, q: Queryable = ctx.db): Promise<PromiseRow> {
  const d = promiseInput.parse(input);
  return withTx(q, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const tz = (await tx.query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [ctx.userId]))[0]!.timezone;
    const id = newId('prm');
    const rows = await tx.query<PromiseRow>(
      `INSERT INTO promises (id, workspace_id, direction, description, counterparty, recorded_on, expected_by, notes, source_capture_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, workspaceId, d.direction, d.description, d.counterparty ?? null, d.recordedOn ?? todayIn(tz, ctx.now), d.expectedBy ?? null, d.notes ?? null, d.sourceCaptureId ?? null, ctx.userId],
    );
    const p = rows[0]!;
    const followUp = d.followUpOn ?? d.expectedBy;
    if (followUp) {
      await scheduleReminder(tx, {
        workspaceId, userId: ctx.userId, targetType: 'promise', targetId: id, kind: 'follow_up',
        title: d.direction === 'i_promised' ? `You promised: ${d.description}` : `Follow up: ${d.description}`,
        note: d.counterparty ? `With ${d.counterparty}` : null, anchorDate: followUp, anchorTime: null, createdBy: ctx.userId,
      });
    }
    await recordHistory(tx, { workspaceId, entityType: 'promise', entityId: id, action: 'created', changes: { direction: d.direction }, actorId: ctx.userId });
    await reindex(tx, p);
    return p;
  });
}

/**
 * Resolving a promise closes it and cancels its follow-ups. "fulfilled" means
 * the *user* says it was done — the record says so ("user-reported").
 */
export async function resolvePromise(ctx: Ctx, id: string, outcome: 'fulfilled' | 'not_fulfilled' | 'cancelled', note?: string | null): Promise<PromiseRow> {
  return withTx(ctx.db, async (tx) => {
    const cur = await loadScoped<PromiseRow>(tx, ctx.userId, 'promises', id, 'write', 'Promise');
    if (cur.status !== 'open') throw invalid('This is already resolved.');
    const rows = await tx.query<PromiseRow>(`UPDATE promises SET status = $2, resolution_note = $3, resolved_at = $4, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, outcome, note ?? null, ctx.now]);
    const cancelled = await cancelRemindersFor(tx, 'promise', id, `promise_${outcome}`);
    await recordHistory(tx, { workspaceId: cur.workspace_id, entityType: 'promise', entityId: id, action: `resolved:${outcome}`, changes: { note: note ?? null, reminders_cancelled: cancelled }, actorId: ctx.userId });
    await audit(tx, { actorId: ctx.userId, workspaceId: cur.workspace_id, action: 'promise.resolved', entityType: 'promise', entityId: id, meta: { outcome } });
    await reindex(tx, rows[0]!);
    return rows[0]!;
  });
}

export async function reopenPromise(ctx: Ctx, id: string): Promise<PromiseRow> {
  const cur = await loadScoped<PromiseRow>(ctx.db, ctx.userId, 'promises', id, 'write', 'Promise');
  const rows = await ctx.db.query<PromiseRow>(`UPDATE promises SET status = 'open', resolved_at = NULL, resolution_note = NULL, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id]);
  await recordHistory(ctx.db, { workspaceId: cur.workspace_id, entityType: 'promise', entityId: id, action: 'reopened', actorId: ctx.userId });
  await reindex(ctx.db, rows[0]!);
  return rows[0]!;
}

export async function addFollowUp(ctx: Ctx, id: string, on: string): Promise<void> {
  if (!isIsoDate(on)) throw invalid('Use a full date.');
  const p = await loadScoped<PromiseRow>(ctx.db, ctx.userId, 'promises', id, 'write', 'Promise');
  if (p.status !== 'open') throw invalid('Reopen it before adding a follow-up.');
  await scheduleReminder(ctx.db, { workspaceId: p.workspace_id, userId: ctx.userId, targetType: 'promise', targetId: id, kind: 'follow_up', title: `Follow up: ${p.description}`, anchorDate: on, anchorTime: null, createdBy: ctx.userId });
  await recordHistory(ctx.db, { workspaceId: p.workspace_id, entityType: 'promise', entityId: id, action: 'follow_up_added', changes: { on }, actorId: ctx.userId });
}

export async function listPromises(ctx: Ctx, filter: { direction?: string; status?: string } = {}) {
  const tz = (await ctx.db.query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [ctx.userId]))[0]!.timezone;
  return ctx.db.query<PromiseRow & { overdue: boolean; next_follow_up: Date | null }>(
    `SELECT p.*, (p.status = 'open' AND p.expected_by < $4::date) AS overdue,
            (SELECT min(r.fire_at) FROM reminders r WHERE r.target_type = 'promise' AND r.target_id = p.id AND r.status = 'scheduled') AS next_follow_up
       FROM promises p JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      WHERE ($2::text IS NULL OR p.direction = $2) AND ($3::text IS NULL OR p.status = $3)
      ORDER BY (p.status = 'open') DESC, p.expected_by NULLS LAST, p.created_at DESC`,
    [ctx.userId, filter.direction ?? null, filter.status ?? null, todayIn(tz, ctx.now)],
  );
}

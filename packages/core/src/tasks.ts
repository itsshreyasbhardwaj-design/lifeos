/**
 * TaskOS + FollowThrough.
 *
 * Stored statuses are the ones a person sets (open, in progress, waiting,
 * completed, cancelled, skipped, archived). "Due", "overdue", "upcoming" and
 * "scheduled" are derived from dates at read time, so they can never be stale.
 * "Suggested" and "needs confirmation" live on extraction candidates — a task
 * row only exists once someone confirmed it.
 */
import { z } from 'zod';
import { type IsoDate, type RecurrenceRule, addDays, isIsoDate } from '@lifeos/extract';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { audit, diff, recordHistory } from './audit.ts';
import { loadScoped, requireRole, roleIn } from './access.ts';
import { indexRecord, unindexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { nextOccurrence, recurrenceSchema } from './recurrence.ts';
import { todayIn } from './time.ts';

export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'completed' | 'cancelled' | 'skipped' | 'archived';
const OPEN: TaskStatus[] = ['open', 'in_progress', 'waiting'];

export interface Task {
  id: string;
  workspace_id: string;
  list_id: string | null;
  parent_id: string | null;
  series_id: string | null;
  occurrence_date: string | null;
  kind: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: number;
  category: string | null;
  tags: string[];
  due_date: string | null;
  due_time: string | null;
  timezone: string;
  start_date: string | null;
  estimate_minutes: number | null;
  waiting_on: string | null;
  waiting_since: string | null;
  recurrence: RecurrenceRule | null;
  reminder_offsets: number[];
  assignee_id: string | null;
  assignment_status: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  completion_note: string | null;
  cancelled_reason: string | null;
  source_capture_id: string | null;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const isoDate = z.string().refine(isIsoDate, 'Use a full date (YYYY-MM-DD).');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');

export const taskInput = z.object({
  title: z.string().trim().min(1, 'Give the task a title.').max(500),
  notes: z.string().max(20_000).nullish(),
  kind: z.enum(['task', 'follow_up', 'refund_follow_up', 'deadline', 'family_task', 'admin_step', 'warranty_claim']).default('task'),
  listId: z.string().nullish(),
  parentId: z.string().nullish(),
  priority: z.number().int().min(0).max(3).default(0),
  category: z.string().max(60).nullish(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(20).default([]),
  dueDate: isoDate.nullish(),
  dueTime: hhmm.nullish(),
  startDate: isoDate.nullish(),
  estimateMinutes: z.number().int().positive().max(100_000).nullish(),
  recurrence: recurrenceSchema.nullish(),
  reminderOffsets: z.array(z.number().int().min(-60 * 24 * 60).max(60 * 24 * 30)).max(5).default([]),
  assigneeId: z.string().nullish(),
  waitingOn: z.string().max(200).nullish(),
  sourceCaptureId: z.string().nullish(),
});
export type TaskInput = z.input<typeof taskInput>;

export const taskPatch = taskInput.partial().extend({ expectedVersion: z.number().int().optional() });

async function userTz(q: Queryable, userId: string): Promise<string> {
  return (await one<{ timezone: string }>(q, 'SELECT timezone FROM users WHERE id = $1', [userId]))?.timezone ?? 'Asia/Kolkata';
}

async function index(q: Queryable, t: Task): Promise<void> {
  await indexRecord(q, { entityType: 'task', entityId: t.id, workspaceId: t.workspace_id, title: t.title, body: [t.notes, t.tags.join(' '), t.waiting_on, t.category].filter(Boolean).join('\n'), occursOn: t.due_date, status: t.status });
}

/** (Re)creates reminders for an open task from its offsets. */
async function syncReminders(q: Queryable, t: Task, actorId: string | null): Promise<void> {
  await cancelRemindersFor(q, 'task', t.id, 'rescheduled');
  if (!OPEN.includes(t.status) || !t.due_date || t.reminder_offsets.length === 0) return;
  const recipient = t.assignee_id && t.assignment_status !== 'declined' ? t.assignee_id : t.created_by;
  if (!recipient) return;
  for (const offset of t.reminder_offsets) {
    await scheduleReminder(q, {
      workspaceId: t.workspace_id, userId: recipient, targetType: 'task', targetId: t.id,
      kind: offset < 0 ? 'advance' : 'due', title: t.title, note: t.due_time ? `Due ${t.due_date} ${t.due_time}` : `Due ${t.due_date}`,
      anchorDate: t.due_date, anchorTime: t.due_time, offsetMinutes: offset, createdBy: actorId,
    });
  }
}

export async function getTask(q: Queryable, userId: string, id: string): Promise<Task & { _role: string }> {
  return loadScoped<Task>(q, userId, 'tasks', id, 'read', 'Task');
}

export async function createTask(ctx: Ctx, workspaceId: string, input: TaskInput, q: Queryable = ctx.db): Promise<Task> {
  const d = taskInput.parse(input);
  if (d.dueTime && !d.dueDate) throw invalid('A time needs a date.');
  return withTx(q, async (tx) => {
    const role = await requireRole(tx, ctx.userId, workspaceId, 'write');
    if (d.parentId) {
      const parent = await getTask(tx, ctx.userId, d.parentId);
      if (parent.workspace_id !== workspaceId) throw invalid('A subtask must be in the same space as its parent.');
    }
    if (d.assigneeId) {
      const r = await roleIn(tx, d.assigneeId, workspaceId);
      if (!r) throw invalid('That person is not a member of this space.');
    }
    if (d.listId) {
      const l = await one<{ workspace_id: string }>(tx, 'SELECT workspace_id FROM task_lists WHERE id = $1', [d.listId]);
      if (!l || l.workspace_id !== workspaceId) throw invalid('Unknown list.');
    }
    void role;
    const id = newId('tsk');
    const recurring = Boolean(d.recurrence && d.dueDate);
    const tz = await userTz(tx, ctx.userId);
    const rows = await tx.query<Task>(
      `INSERT INTO tasks (id, workspace_id, list_id, parent_id, series_id, occurrence_date, kind, title, notes, priority, category, tags, due_date, due_time, timezone,
                          start_date, estimate_minutes, recurrence, reminder_offsets, assignee_id, assignment_status, waiting_on, waiting_since, status, source_capture_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
      [id, workspaceId, d.listId ?? null, d.parentId ?? null, recurring ? id : null, recurring ? d.dueDate : null, d.kind, d.title, d.notes ?? null, d.priority,
        d.category ?? null, d.tags, d.dueDate ?? null, d.dueTime ?? null, tz, d.startDate ?? null, d.estimateMinutes ?? null,
        d.recurrence ? JSON.stringify(d.recurrence) : null, d.reminderOffsets, d.assigneeId ?? null,
        d.assigneeId && d.assigneeId !== ctx.userId ? 'pending' : d.assigneeId ? 'accepted' : null,
        d.waitingOn ?? null, d.waitingOn ? todayIn(tz, ctx.now) : null, d.waitingOn ? 'waiting' : 'open', d.sourceCaptureId ?? null, ctx.userId],
    );
    const t = rows[0]!;
    await recordHistory(tx, { workspaceId, entityType: 'task', entityId: id, action: 'created', changes: { title: t.title, due_date: t.due_date }, actorId: ctx.userId });
    await index(tx, t);
    await syncReminders(tx, t, ctx.userId);
    return t;
  });
}

export async function updateTask(ctx: Ctx, id: string, patch: z.input<typeof taskPatch>, q: Queryable = ctx.db): Promise<Task> {
  const p = taskPatch.parse(patch);
  return withTx(q, async (tx) => {
    const cur = await loadScoped<Task>(tx, ctx.userId, 'tasks', id, 'write', 'Task');
    if (cur._role === 'limited') throw forbidden('You can complete tasks assigned to you, but not edit them.');
    if (p.expectedVersion !== undefined && p.expectedVersion !== cur.version) {
      throw conflict('This task changed somewhere else since you opened it.', { server: stripRole(cur) });
    }
    const next = {
      title: p.title ?? cur.title,
      notes: p.notes !== undefined ? p.notes : cur.notes,
      priority: p.priority ?? cur.priority,
      category: p.category !== undefined ? p.category : cur.category,
      tags: p.tags ?? cur.tags,
      due_date: p.dueDate !== undefined ? p.dueDate : cur.due_date,
      due_time: p.dueTime !== undefined ? p.dueTime : cur.due_time,
      start_date: p.startDate !== undefined ? p.startDate : cur.start_date,
      estimate_minutes: p.estimateMinutes !== undefined ? p.estimateMinutes : cur.estimate_minutes,
      list_id: p.listId !== undefined ? p.listId : cur.list_id,
      reminder_offsets: p.reminderOffsets ?? cur.reminder_offsets,
      recurrence: p.recurrence !== undefined ? p.recurrence : cur.recurrence,
      waiting_on: p.waitingOn !== undefined ? p.waitingOn : cur.waiting_on,
      assignee_id: p.assigneeId !== undefined ? p.assigneeId : cur.assignee_id,
    };
    if (next.due_time && !next.due_date) throw invalid('A time needs a date.');
    if (next.assignee_id && next.assignee_id !== cur.assignee_id && !(await roleIn(tx, next.assignee_id, cur.workspace_id))) throw invalid('That person is not a member of this space.');
    const assignmentStatus = next.assignee_id !== cur.assignee_id ? (next.assignee_id ? (next.assignee_id === ctx.userId ? 'accepted' : 'pending') : null) : cur.assignment_status;
    const series = next.recurrence && next.due_date ? (cur.series_id ?? cur.id) : null;
    const rows = await tx.query<Task>(
      `UPDATE tasks SET title=$2, notes=$3, priority=$4, category=$5, tags=$6, due_date=$7, due_time=$8, start_date=$9, estimate_minutes=$10, list_id=$11,
              reminder_offsets=$12, recurrence=$13, waiting_on=$14, assignee_id=$15, assignment_status=$16,
              series_id=$17, occurrence_date=$18,
              status = CASE WHEN $14::text IS NOT NULL AND status = 'open' THEN 'waiting' WHEN $14::text IS NULL AND status = 'waiting' THEN 'open' ELSE status END,
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, next.title, next.notes, next.priority, next.category, next.tags, next.due_date, next.due_time, next.start_date, next.estimate_minutes, next.list_id,
        next.reminder_offsets, next.recurrence ? JSON.stringify(next.recurrence) : null, next.waiting_on, next.assignee_id, assignmentStatus,
        series, series ? (cur.occurrence_date ?? next.due_date) : null],
    );
    const t = rows[0]!;
    const changes = diff(stripRole(cur) as unknown as Record<string, unknown>, t as unknown as Record<string, unknown>);
    delete changes.version;
    delete changes.updated_at;
    const rescheduled = 'due_date' in changes || 'due_time' in changes;
    if (Object.keys(changes).length) {
      await recordHistory(tx, { workspaceId: t.workspace_id, entityType: 'task', entityId: id, action: rescheduled ? 'rescheduled' : 'updated', changes, actorId: ctx.userId });
    }
    await index(tx, t);
    if (rescheduled || 'reminder_offsets' in changes || 'assignee_id' in changes) await syncReminders(tx, t, ctx.userId);
    return t;
  });
}

function stripRole<T extends { _role?: unknown }>(t: T): Omit<T, '_role'> {
  const { _role, ...rest } = t;
  void _role;
  return rest;
}

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'waiting', 'completed', 'cancelled', 'skipped'],
  in_progress: ['open', 'waiting', 'completed', 'cancelled', 'skipped'],
  waiting: ['open', 'in_progress', 'completed', 'cancelled'],
  completed: ['open', 'archived'],
  cancelled: ['open', 'archived'],
  skipped: ['open', 'archived'],
  archived: ['open'],
};

export interface StatusChange {
  status: TaskStatus;
  note?: string | null;
  /** Documents or captures attached as completion evidence. */
  evidence?: { type: 'document' | 'capture'; id: string }[];
}

/**
 * Changes status. Completing or skipping a recurring occurrence creates the
 * next one exactly once (unique on series + date). Closing a task cancels its
 * future reminders (invariant 6); reopening restores them.
 */
export async function setTaskStatus(ctx: Ctx, id: string, change: StatusChange, q: Queryable = ctx.db): Promise<{ task: Task; next: Task | null }> {
  return withTx(q, async (tx) => {
    const cur = await loadScoped<Task>(tx, ctx.userId, 'tasks', id, 'write', 'Task');
    const to = change.status;
    if (cur._role === 'limited' && to !== 'completed' && to !== 'open') throw forbidden();
    if (cur.status === to) return { task: stripRole(cur) as Task, next: null };
    if (!TRANSITIONS[cur.status].includes(to)) throw invalid(`A ${cur.status.replace('_', ' ')} task cannot become ${to.replace('_', ' ')}.`);
    if (to === 'skipped' && !cur.series_id) throw invalid('Only an occurrence of a repeating task can be skipped.');
    if (to === 'completed') {
      const blockers = await tx.query<{ title: string }>(
        `SELECT t.title FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = $1 AND t.status NOT IN ('completed','cancelled','skipped','archived')`, [id],
      );
      if (blockers.length) throw invalid(`Finish first: ${blockers.map((b) => b.title).join(', ')}.`, { blockers });
    }
    const rows = await tx.query<Task>(
      `UPDATE tasks SET status = $2,
              completed_at = CASE WHEN $2 = 'completed' THEN $3::timestamptz WHEN $2 = 'archived' THEN completed_at ELSE NULL END,
              completed_by = CASE WHEN $2 = 'completed' THEN $4 WHEN $2 = 'archived' THEN completed_by ELSE NULL END,
              completion_note = CASE WHEN $2 IN ('completed','skipped') THEN $5 WHEN $2 = 'archived' THEN completion_note ELSE NULL END,
              cancelled_reason = CASE WHEN $2 = 'cancelled' THEN $5 ELSE cancelled_reason END,
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, to, ctx.now, ctx.userId, change.note ?? null],
    );
    const t = rows[0]!;
    await recordHistory(tx, { workspaceId: t.workspace_id, entityType: 'task', entityId: id, action: `status:${to}`, changes: { from: cur.status, to, note: change.note ?? null }, actorId: ctx.userId });
    for (const e of change.evidence ?? []) {
      const { link } = await import('./links.ts');
      await link(tx, { workspaceId: t.workspace_id, fromType: e.type, fromId: e.id, toType: 'task', toId: id, relation: 'evidence_for', provenance: { source: 'user' }, actorId: ctx.userId });
    }
    await index(tx, t);
    if (OPEN.includes(to)) await syncReminders(tx, t, ctx.userId);
    else await cancelRemindersFor(tx, 'task', id, `task_${to}`);

    let next: Task | null = null;
    if ((to === 'completed' || to === 'skipped') && t.series_id && t.recurrence && t.occurrence_date) {
      const seriesStart = (await one<{ d: string }>(tx, `SELECT min(occurrence_date)::text AS d FROM tasks WHERE series_id = $1`, [t.series_id]))!.d;
      const nd = nextOccurrence(t.recurrence, seriesStart, t.occurrence_date);
      if (nd) {
        const nid = newId('tsk');
        const ins = await tx.query<Task>(
          `INSERT INTO tasks (id, workspace_id, list_id, series_id, occurrence_date, kind, title, notes, priority, category, tags, due_date, due_time, timezone,
                              estimate_minutes, recurrence, reminder_offsets, assignee_id, assignment_status, status, created_by)
           SELECT $1, workspace_id, list_id, series_id, $2, kind, title, notes, priority, category, tags, $2, due_time, timezone,
                  estimate_minutes, recurrence, reminder_offsets, assignee_id, assignment_status, 'open', created_by
             FROM tasks WHERE id = $3
           ON CONFLICT (series_id, occurrence_date) WHERE series_id IS NOT NULL DO NOTHING RETURNING *`,
          [nid, nd, id],
        );
        if (ins[0]) {
          next = ins[0];
          await index(tx, next);
          await syncReminders(tx, next, ctx.userId);
          await recordHistory(tx, { workspaceId: t.workspace_id, entityType: 'task', entityId: nid, action: 'created', changes: { from_series: t.series_id, occurrence_date: nd }, actorId: ctx.userId });
        }
      }
    }
    await audit(tx, { actorId: ctx.userId, workspaceId: t.workspace_id, action: `task.${to}`, entityType: 'task', entityId: id });
    return { task: t, next };
  });
}

export async function respondToAssignment(ctx: Ctx, id: string, accept: boolean): Promise<Task> {
  return withTx(ctx.db, async (tx) => {
    const t = await one<Task>(tx, 'SELECT * FROM tasks WHERE id = $1', [id]);
    if (!t || t.assignee_id !== ctx.userId) throw notFound('Task');
    const rows = await tx.query<Task>(`UPDATE tasks SET assignment_status = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, accept ? 'accepted' : 'declined']);
    await recordHistory(tx, { workspaceId: t.workspace_id, entityType: 'task', entityId: id, action: accept ? 'assignment_accepted' : 'assignment_declined', actorId: ctx.userId });
    await syncReminders(tx, rows[0]!, ctx.userId);
    return rows[0]!;
  });
}

export async function deleteTask(ctx: Ctx, id: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const t = await loadScoped<Task>(tx, ctx.userId, 'tasks', id, 'write', 'Task');
    if (t._role === 'limited') throw forbidden();
    await cancelRemindersFor(tx, 'task', id, 'task_deleted');
    await tx.query(`DELETE FROM life_links WHERE (from_type = 'task' AND from_id = $1) OR (to_type = 'task' AND to_id = $1)`, [id]);
    await tx.query(`DELETE FROM checklist_items WHERE owner_type = 'task' AND owner_id = $1`, [id]);
    await unindexRecord(tx, 'task', id);
    for (const sub of await tx.query<{ id: string }>('SELECT id FROM tasks WHERE parent_id = $1', [id])) await unindexRecord(tx, 'task', sub.id);
    await tx.query('DELETE FROM tasks WHERE id = $1', [id]);
    await audit(tx, { actorId: ctx.userId, workspaceId: t.workspace_id, action: 'task.deleted', entityType: 'task', entityId: id });
  });
}

// ------------------------------------------------------------------ dependencies

export async function addDependency(ctx: Ctx, taskId: string, dependsOnId: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const a = await loadScoped<Task>(tx, ctx.userId, 'tasks', taskId, 'write', 'Task');
    const b = await loadScoped<Task>(tx, ctx.userId, 'tasks', dependsOnId, 'read', 'Task');
    if (a.workspace_id !== b.workspace_id) throw invalid('Dependencies must be in the same space.');
    // Refuse cycles: does dependsOn (transitively) depend on task?
    const cycle = await tx.query(
      `WITH RECURSIVE chain(id) AS (SELECT depends_on_id FROM task_dependencies WHERE task_id = $1
         UNION SELECT d.depends_on_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id)
       SELECT 1 FROM chain WHERE id = $2 LIMIT 1`, [dependsOnId, taskId],
    );
    if (cycle.length || taskId === dependsOnId) throw invalid('That would make the tasks wait on each other forever.');
    await tx.query('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [taskId, dependsOnId]);
    await recordHistory(tx, { workspaceId: a.workspace_id, entityType: 'task', entityId: taskId, action: 'dependency_added', changes: { depends_on: dependsOnId }, actorId: ctx.userId });
  });
}

export async function removeDependency(ctx: Ctx, taskId: string, dependsOnId: string): Promise<void> {
  await loadScoped<Task>(ctx.db, ctx.userId, 'tasks', taskId, 'write', 'Task');
  await ctx.db.query('DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2', [taskId, dependsOnId]);
}

export async function dependencies(q: Queryable, taskId: string) {
  return q.query<{ id: string; title: string; status: string }>(`SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = $1`, [taskId]);
}

// ------------------------------------------------------------------ views

export type TaskView = 'today' | 'tomorrow' | 'week' | 'upcoming' | 'overdue' | 'waiting' | 'completed' | 'all' | 'no_date' | 'assigned_to_me';

export interface TaskQuery {
  view?: TaskView;
  workspaceIds?: string[];
  listId?: string;
  tag?: string;
  search?: string;
  sort?: 'due' | 'priority' | 'created' | 'title';
  limit?: number;
  includeSubtasks?: boolean;
}

/**
 * Lists tasks across the caller's spaces. Scoping is in SQL: personal spaces
 * by ownership, family spaces by membership, and limited members only see
 * tasks assigned to them.
 */
export async function listTasks(ctx: Ctx, query: TaskQuery = {}, q: Queryable = ctx.db): Promise<(Task & { workspace_name: string; workspace_kind: string; assignee_name: string | null; subtask_count: number; subtasks_done: number })[]> {
  const tz = await userTz(q, ctx.userId);
  const today = todayIn(tz, ctx.now);
  const params: unknown[] = [ctx.userId, today];
  const where: string[] = [];
  const add = (sql: string, v?: unknown) => {
    if (v !== undefined) params.push(v);
    where.push(sql.replace('$?', `$${params.length}`));
  };
  const view = query.view ?? 'all';
  const openSql = `t.status IN ('open','in_progress','waiting')`;
  if (view === 'today') add(`${openSql} AND t.due_date IS NOT NULL AND t.due_date <= $2`);
  else if (view === 'tomorrow') add(`${openSql} AND t.due_date = $?::date`, addDays(today, 1));
  else if (view === 'week') add(`${openSql} AND t.due_date BETWEEN $2 AND $?::date`, addDays(today, 6));
  else if (view === 'upcoming') add(`${openSql} AND t.due_date > $2`);
  else if (view === 'overdue') add(`${openSql} AND t.due_date < $2`);
  else if (view === 'waiting') add(`t.status = 'waiting'`);
  else if (view === 'completed') add(`t.status = 'completed'`);
  else if (view === 'no_date') add(`${openSql} AND t.due_date IS NULL`);
  else if (view === 'assigned_to_me') add(`${openSql} AND t.assignee_id = $1`);
  else add(`t.status NOT IN ('archived','skipped')`);
  if (!query.includeSubtasks) add('t.parent_id IS NULL');
  if (query.workspaceIds?.length) add('t.workspace_id = ANY($?)', query.workspaceIds);
  if (query.listId) add('t.list_id = $?', query.listId);
  if (query.tag) add('$? = ANY(t.tags)', query.tag.toLowerCase());
  if (query.search) add(`(t.title ILIKE $? OR t.notes ILIKE $${params.length + 1})`, `%${query.search}%`), params.push(`%${query.search}%`);
  const order = query.sort === 'priority' ? 't.priority DESC, t.due_date NULLS LAST' : query.sort === 'created' ? 't.created_at DESC' : query.sort === 'title' ? 't.title' : view === 'completed' ? 't.completed_at DESC' : 't.due_date NULLS LAST, t.due_time NULLS LAST, t.priority DESC, t.created_at';
  params.push(Math.min(query.limit ?? 300, 1000));
  return q.query(
    `SELECT t.*, w.name AS workspace_name, w.kind AS workspace_kind, au.display_name AS assignee_name,
            (SELECT count(*)::int FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
            (SELECT count(*)::int FROM tasks s WHERE s.parent_id = t.id AND s.status = 'completed') AS subtasks_done
       FROM tasks t
       JOIN memberships m ON m.workspace_id = t.workspace_id AND m.user_id = $1
       JOIN workspaces w ON w.id = t.workspace_id
       LEFT JOIN users au ON au.id = t.assignee_id
      WHERE (m.role <> 'limited' OR t.assignee_id = $1) AND $2::date IS NOT NULL AND ${where.join(' AND ')}
      ORDER BY ${order} LIMIT $${params.length}`,
    params,
  );
}

export async function subtasks(q: Queryable, parentId: string) {
  return q.query<Task>(`SELECT * FROM tasks WHERE parent_id = $1 ORDER BY created_at`, [parentId]);
}

/** Bulk complete / cancel / move — each task goes through the same checks as a single change. */
export async function bulkTasks(ctx: Ctx, ids: string[], action: { kind: 'complete' } | { kind: 'cancel' } | { kind: 'move'; listId: string | null } | { kind: 'reschedule'; dueDate: IsoDate }): Promise<{ ok: string[]; failed: { id: string; error: string }[] }> {
  const ok: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids.slice(0, 200)) {
    try {
      if (action.kind === 'complete') await setTaskStatus(ctx, id, { status: 'completed' });
      else if (action.kind === 'cancel') await setTaskStatus(ctx, id, { status: 'cancelled' });
      else if (action.kind === 'move') await updateTask(ctx, id, { listId: action.listId });
      else await updateTask(ctx, id, { dueDate: action.dueDate });
      ok.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }
  return { ok, failed };
}

// ------------------------------------------------------------------ lists

export async function createList(ctx: Ctx, workspaceId: string, name: string): Promise<{ id: string }> {
  await requireRole(ctx.db, ctx.userId, workspaceId, 'write');
  const id = newId('lst');
  await ctx.db.query('INSERT INTO task_lists (id, workspace_id, name, created_by) VALUES ($1,$2,$3,$4)', [id, workspaceId, name.trim().slice(0, 80) || 'List', ctx.userId]);
  return { id };
}

export async function lists(ctx: Ctx) {
  return ctx.db.query<{ id: string; name: string; workspace_id: string; open_count: number }>(
    `SELECT l.id, l.name, l.workspace_id, (SELECT count(*)::int FROM tasks t WHERE t.list_id = l.id AND t.status IN ('open','in_progress','waiting')) AS open_count
       FROM task_lists l JOIN memberships m ON m.workspace_id = l.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      WHERE l.archived_at IS NULL ORDER BY l.created_at`,
    [ctx.userId],
  );
}

// ------------------------------------------------------------------ checklists

export type ChecklistOwner = 'task' | 'admin_workflow' | 'life_event' | 'subscription' | 'warranty';

const OWNER_TABLE: Record<ChecklistOwner, string> = { task: 'tasks', admin_workflow: 'admin_workflows', life_event: 'life_events', subscription: 'service_subscriptions', warranty: 'warranties' };

async function ownerWorkspace(q: Queryable, userId: string, owner: ChecklistOwner, ownerId: string, perm: 'read' | 'write'): Promise<string> {
  const row = await loadScoped<{ workspace_id: string }>(q, userId, OWNER_TABLE[owner], ownerId, perm);
  return row.workspace_id;
}

export async function checklist(q: Queryable, userId: string, owner: ChecklistOwner, ownerId: string) {
  await ownerWorkspace(q, userId, owner, ownerId, 'read');
  return q.query<{ id: string; label: string; done: boolean; group_name: string; kind: string; note: string | null; done_at: Date | null; position: number }>(
    `SELECT id, label, done, group_name, kind, note, done_at, position FROM checklist_items WHERE owner_type = $1 AND owner_id = $2 ORDER BY group_name, position, created_at`, [owner, ownerId],
  );
}

export async function addChecklistItems(ctx: Ctx, owner: ChecklistOwner, ownerId: string, items: { label: string; group?: string; kind?: 'item' | 'document' | 'step'; note?: string }[], q: Queryable = ctx.db): Promise<void> {
  const ws = await ownerWorkspace(q, ctx.userId, owner, ownerId, 'write');
  const base = (await one<{ n: number }>(q, `SELECT COALESCE(max(position), 0)::int AS n FROM checklist_items WHERE owner_type = $1 AND owner_id = $2`, [owner, ownerId]))!.n;
  let i = 0;
  for (const it of items.slice(0, 100)) {
    const label = it.label.trim().slice(0, 300);
    if (!label) continue;
    await q.query(`INSERT INTO checklist_items (id, workspace_id, owner_type, owner_id, group_name, kind, label, note, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      newId('chk'), ws, owner, ownerId, it.group ?? '', it.kind ?? 'item', label, it.note ?? null, base + ++i,
    ]);
  }
}

export async function toggleChecklistItem(ctx: Ctx, itemId: string, done: boolean): Promise<void> {
  const item = await one<{ owner_type: ChecklistOwner; owner_id: string; workspace_id: string; label: string }>(ctx.db, 'SELECT owner_type, owner_id, workspace_id, label FROM checklist_items WHERE id = $1', [itemId]);
  if (!item) throw notFound('Checklist item');
  await ownerWorkspace(ctx.db, ctx.userId, item.owner_type, item.owner_id, 'write');
  await ctx.db.query(`UPDATE checklist_items SET done = $2, done_at = CASE WHEN $2 THEN now() ELSE NULL END, done_by = CASE WHEN $2 THEN $3 ELSE NULL END WHERE id = $1`, [itemId, done, ctx.userId]);
  await recordHistory(ctx.db, { workspaceId: item.workspace_id, entityType: item.owner_type, entityId: item.owner_id, action: done ? 'checklist_done' : 'checklist_undone', changes: { item: item.label }, actorId: ctx.userId });
}

export async function deleteChecklistItem(ctx: Ctx, itemId: string): Promise<void> {
  const item = await one<{ owner_type: ChecklistOwner; owner_id: string }>(ctx.db, 'SELECT owner_type, owner_id FROM checklist_items WHERE id = $1', [itemId]);
  if (!item) throw notFound('Checklist item');
  await ownerWorkspace(ctx.db, ctx.userId, item.owner_type, item.owner_id, 'write');
  await ctx.db.query('DELETE FROM checklist_items WHERE id = $1', [itemId]);
}

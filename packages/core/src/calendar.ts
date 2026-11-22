/**
 * Life Calendar: events plus a read-only overlay of every dated commitment
 * (task due dates, bills, renewals, warranty and return deadlines, document
 * expiries, life events). Overlay items are computed, not copied, so the
 * calendar can never disagree with the record it shows.
 *
 * Fixed appointments, hard deadlines and flexible plans are distinct kinds.
 * External calendars are never modified.
 */
import { z } from 'zod';
import { type IsoDate, type RecurrenceRule, addDays, isIsoDate } from '@lifeos/extract';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { conflict, invalid } from './errors.ts';
import { newId } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { loadScoped, requireRole } from './access.ts';
import { indexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { occurrencesBetween, recurrenceSchema } from './recurrence.ts';
import { localParts, zonedToUtc } from './time.ts';
import { parseIcs, toIcs, type ExportEvent } from './ics.ts';

const isoDate = z.string().refine(isIsoDate, 'Use a full date.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const eventInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10_000).nullish(),
    location: z.string().max(500).nullish(),
    kind: z.enum(['appointment', 'deadline', 'flexible', 'time_block']).default('appointment'),
    allDay: z.boolean().default(false),
    date: isoDate,
    endDate: isoDate.nullish(),
    startTime: hhmm.nullish(),
    endTime: hhmm.nullish(),
    timezone: z.string().nullish(),
    bufferMinutes: z.number().int().min(0).max(240).default(0),
    recurrence: recurrenceSchema.nullish(),
    remindMinutesBefore: z.array(z.number().int().min(0).max(60 * 24 * 14)).max(3).default([]),
    taskId: z.string().nullish(),
    expectedVersion: z.number().int().optional(),
  })
  .refine((v) => v.allDay || v.startTime, { message: 'Give a start time or mark it all-day.', path: ['startTime'] });

export interface CalendarEvent {
  id: string; workspace_id: string; title: string; description: string | null; location: string | null; kind: string; all_day: boolean;
  starts_at: Date | null; ends_at: Date | null; start_date: string | null; end_date: string | null; timezone: string; buffer_minutes: number;
  recurrence: RecurrenceRule | null; source: string; external_uid: string | null; task_id: string | null; cancelled_at: Date | null; version: number; updated_at: Date;
}

function timing(d: z.infer<typeof eventInput>, tz: string) {
  if (d.allDay) return { all_day: true, starts_at: null, ends_at: null, start_date: d.date, end_date: d.endDate ?? d.date };
  const startsAt = zonedToUtc(d.date, d.startTime!, tz);
  let endsAt = d.endTime ? zonedToUtc(d.endDate ?? d.date, d.endTime, tz) : new Date(startsAt.getTime() + 60 * 60_000);
  if (endsAt < startsAt) endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return { all_day: false, starts_at: startsAt, ends_at: endsAt, start_date: null, end_date: null };
}

async function index(q: Queryable, e: CalendarEvent) {
  const date = e.start_date ?? (e.starts_at ? localParts(new Date(e.starts_at), e.timezone).date : null);
  await indexRecord(q, { entityType: 'calendar_event', entityId: e.id, workspaceId: e.workspace_id, title: e.title, body: [e.location, e.description, e.kind, 'appointment event'].filter(Boolean).join('\n'), occursOn: date, status: e.cancelled_at ? 'cancelled' : null });
}

async function reminders(q: Queryable, e: CalendarEvent, minutes: number[], userId: string) {
  await cancelRemindersFor(q, 'calendar_event', e.id, 'rescheduled');
  if (e.cancelled_at) return;
  for (const m of minutes) {
    if (e.all_day && e.start_date) {
      await scheduleReminder(q, { workspaceId: e.workspace_id, userId, targetType: 'calendar_event', targetId: e.id, kind: 'advance', title: e.title, note: `On ${e.start_date}`, anchorDate: e.start_date, anchorTime: null, offsetMinutes: -m, createdBy: userId });
    } else if (e.starts_at) {
      const local = localParts(new Date(e.starts_at), e.timezone);
      await scheduleReminder(q, { workspaceId: e.workspace_id, userId, targetType: 'calendar_event', targetId: e.id, kind: 'advance', title: e.title, note: e.location ? `At ${e.location}` : null, anchorDate: local.date, anchorTime: local.time, offsetMinutes: -m, createdBy: userId });
    }
  }
}

/** Timed events in the same spaces that overlap [start, end), buffers included. */
export async function conflicts(q: Queryable, userId: string, startsAt: Date, endsAt: Date, bufferMinutes: number, excludeId?: string) {
  const s = new Date(startsAt.getTime() - bufferMinutes * 60_000);
  const e = new Date(endsAt.getTime() + bufferMinutes * 60_000);
  return q.query<{ id: string; title: string; starts_at: Date; ends_at: Date }>(
    `SELECT c.id, c.title, c.starts_at, c.ends_at FROM calendar_events c
       JOIN memberships m ON m.workspace_id = c.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      WHERE c.cancelled_at IS NULL AND NOT c.all_day AND c.recurrence IS NULL AND c.kind <> 'flexible'
        AND c.starts_at - make_interval(mins => c.buffer_minutes) < $3 AND c.ends_at + make_interval(mins => c.buffer_minutes) > $2
        AND ($4::text IS NULL OR c.id <> $4)
      ORDER BY c.starts_at LIMIT 10`,
    [userId, s, e, excludeId ?? null],
  );
}

export async function createEvent(ctx: Ctx, workspaceId: string, input: z.input<typeof eventInput>, q: Queryable = ctx.db, source: 'manual' | 'capture' | 'task' = 'manual') {
  const d = eventInput.parse(input);
  return withTx(q, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const tz = d.timezone ?? (await one<{ timezone: string }>(tx, 'SELECT timezone FROM users WHERE id = $1', [ctx.userId]))!.timezone;
    const t = timing(d, tz);
    const id = newId('evt');
    const rows = await tx.query<CalendarEvent>(
      `INSERT INTO calendar_events (id, workspace_id, title, description, location, kind, all_day, starts_at, ends_at, start_date, end_date, timezone, buffer_minutes, recurrence, source, task_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [id, workspaceId, d.title, d.description ?? null, d.location ?? null, d.kind, t.all_day, t.starts_at, t.ends_at, t.start_date, t.end_date, tz, d.bufferMinutes,
        d.recurrence ? JSON.stringify(d.recurrence) : null, source, d.taskId ?? null, ctx.userId],
    );
    const e = rows[0]!;
    await index(tx, e);
    await reminders(tx, e, d.remindMinutesBefore, ctx.userId);
    await recordHistory(tx, { workspaceId, entityType: 'calendar_event', entityId: id, action: 'created', actorId: ctx.userId });
    const clash = t.starts_at && t.ends_at && d.kind !== 'flexible' ? await conflicts(tx, ctx.userId, t.starts_at, t.ends_at, d.bufferMinutes, id) : [];
    return { event: e, conflicts: clash };
  });
}

export async function updateEvent(ctx: Ctx, id: string, input: z.input<typeof eventInput>) {
  const d = eventInput.parse(input);
  return withTx(ctx.db, async (tx) => {
    const cur = await loadScoped<CalendarEvent>(tx, ctx.userId, 'calendar_events', id, 'write', 'Event');
    if (cur.source === 'ics' && cur.external_uid) {
      // Imported events are copies; editing ours never edits the original calendar.
    }
    if (d.expectedVersion !== undefined && d.expectedVersion !== cur.version) throw conflict('This event changed somewhere else.', { server: cur });
    const tz = d.timezone ?? cur.timezone;
    const t = timing(d, tz);
    const rows = await tx.query<CalendarEvent>(
      `UPDATE calendar_events SET title=$2, description=$3, location=$4, kind=$5, all_day=$6, starts_at=$7, ends_at=$8, start_date=$9, end_date=$10, timezone=$11, buffer_minutes=$12, recurrence=$13, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, d.title, d.description ?? null, d.location ?? null, d.kind, t.all_day, t.starts_at, t.ends_at, t.start_date, t.end_date, tz, d.bufferMinutes, d.recurrence ? JSON.stringify(d.recurrence) : null],
    );
    const e = rows[0]!;
    await index(tx, e);
    await reminders(tx, e, d.remindMinutesBefore, ctx.userId);
    await recordHistory(tx, { workspaceId: e.workspace_id, entityType: 'calendar_event', entityId: id, action: 'rescheduled', changes: { from: cur.starts_at ?? cur.start_date, to: e.starts_at ?? e.start_date }, actorId: ctx.userId });
    const clash = t.starts_at && t.ends_at && d.kind !== 'flexible' ? await conflicts(tx, ctx.userId, t.starts_at, t.ends_at, d.bufferMinutes, id) : [];
    return { event: e, conflicts: clash };
  });
}

/** Drag-and-drop: move to a new start keeping the duration. */
export async function moveEvent(ctx: Ctx, id: string, to: { date: string; startTime?: string | null }, expectedVersion?: number) {
  const cur = await loadScoped<CalendarEvent>(ctx.db, ctx.userId, 'calendar_events', id, 'write', 'Event');
  if (cur.all_day || !cur.starts_at || !cur.ends_at) {
    const span = cur.start_date && cur.end_date ? Math.round((Date.parse(cur.end_date) - Date.parse(cur.start_date)) / 86_400_000) : 0;
    return updateEvent(ctx, id, { title: cur.title, description: cur.description, location: cur.location, kind: cur.kind as 'appointment', allDay: true, date: to.date, endDate: addDays(to.date, span), bufferMinutes: cur.buffer_minutes, recurrence: cur.recurrence, expectedVersion });
  }
  const durMin = Math.round((new Date(cur.ends_at).getTime() - new Date(cur.starts_at).getTime()) / 60_000);
  const startTime = to.startTime ?? localParts(new Date(cur.starts_at), cur.timezone).time;
  const startsAt = zonedToUtc(to.date, startTime, cur.timezone);
  const end = localParts(new Date(startsAt.getTime() + durMin * 60_000), cur.timezone);
  return updateEvent(ctx, id, { title: cur.title, description: cur.description, location: cur.location, kind: cur.kind as 'appointment', allDay: false, date: to.date, startTime, endDate: end.date, endTime: end.time, timezone: cur.timezone, bufferMinutes: cur.buffer_minutes, recurrence: cur.recurrence, expectedVersion });
}

export async function cancelEvent(ctx: Ctx, id: string) {
  await withTx(ctx.db, async (tx) => {
    const cur = await loadScoped<CalendarEvent>(tx, ctx.userId, 'calendar_events', id, 'write', 'Event');
    await tx.query('UPDATE calendar_events SET cancelled_at = now(), version = version + 1, updated_at = now() WHERE id = $1', [id]);
    await cancelRemindersFor(tx, 'calendar_event', id, 'event_cancelled');
    await recordHistory(tx, { workspaceId: cur.workspace_id, entityType: 'calendar_event', entityId: id, action: 'cancelled', actorId: ctx.userId });
    await index(tx, { ...cur, cancelled_at: new Date() });
  });
}

// ------------------------------------------------------------------ agenda overlay

export interface AgendaItem {
  type: 'event' | 'task' | 'bill' | 'renewal' | 'trial_end' | 'warranty_end' | 'return_deadline' | 'document_expiry' | 'life_event' | 'admin_deadline' | 'promise_due';
  id: string;
  title: string;
  date: IsoDate;
  startsAt?: Date | null;
  endsAt?: Date | null;
  allDay: boolean;
  nature: 'fixed' | 'deadline' | 'flexible';
  status?: string | null;
  workspaceId: string;
  workspaceName: string;
  link: string;
  location?: string | null;
  recurring?: boolean;
  version?: number;
}

export async function agenda(ctx: Ctx, from: IsoDate, to: IsoDate, opts: { workspaceIds?: string[]; types?: AgendaItem['type'][] } = {}): Promise<AgendaItem[]> {
  const tz = (await one<{ timezone: string }>(ctx.db, 'SELECT timezone FROM users WHERE id = $1', [ctx.userId]))!.timezone;
  const ws = opts.workspaceIds?.length ? opts.workspaceIds : null;
  const want = (t: AgendaItem['type']) => !opts.types || opts.types.includes(t);
  const items: AgendaItem[] = [];
  const fromUtc = zonedToUtc(from, '00:00', tz);
  const toUtc = zonedToUtc(addDays(to, 1), '00:00', tz);
  const scope = `JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 JOIN workspaces w ON w.id = x.workspace_id`;
  const wsFilter = `AND ($4::text[] IS NULL OR x.workspace_id = ANY($4))`;

  if (want('event')) {
    const evs = await ctx.db.query<CalendarEvent & { workspace_name: string; role: string }>(
      `SELECT x.*, w.name AS workspace_name, m.role FROM calendar_events x ${scope}
        WHERE x.cancelled_at IS NULL ${wsFilter} AND (
          x.recurrence IS NOT NULL OR (x.all_day AND x.start_date <= $3::date AND COALESCE(x.end_date, x.start_date) >= $2::date)
          OR (NOT x.all_day AND x.starts_at < $6 AND x.ends_at > $5))`,
      [ctx.userId, from, to, ws, fromUtc, toUtc],
    );
    for (const e of evs) {
      const nature = e.kind === 'deadline' ? 'deadline' : e.kind === 'flexible' || e.kind === 'time_block' ? 'flexible' : 'fixed';
      const base = { type: 'event' as const, id: e.id, title: e.title, nature, workspaceId: e.workspace_id, workspaceName: e.workspace_name, link: `/app/calendar?event=${e.id}`, location: e.location, version: e.version } as const;
      if (e.recurrence) {
        const startDate = e.all_day ? e.start_date! : localParts(new Date(e.starts_at!), e.timezone).date;
        const startTime = e.all_day ? null : localParts(new Date(e.starts_at!), e.timezone).time;
        const dur = e.all_day ? 0 : new Date(e.ends_at!).getTime() - new Date(e.starts_at!).getTime();
        for (const d of occurrencesBetween(e.recurrence, startDate, from, to)) {
          const s = startTime ? zonedToUtc(d, startTime, e.timezone) : null;
          items.push({ ...base, date: d, allDay: e.all_day, startsAt: s, endsAt: s ? new Date(s.getTime() + dur) : null, recurring: true });
        }
      } else if (e.all_day) {
        items.push({ ...base, date: e.start_date! < from ? from : e.start_date!, allDay: true });
      } else {
        items.push({ ...base, date: localParts(new Date(e.starts_at!), tz).date, allDay: false, startsAt: e.starts_at, endsAt: e.ends_at });
      }
    }
  }

  const overlay = async (type: AgendaItem['type'], sql: string, map: (r: Record<string, unknown>) => Partial<AgendaItem>) => {
    if (!want(type)) return;
    const rows = await ctx.db.query<Record<string, unknown>>(sql, [ctx.userId, from, to, ws]);
    for (const r of rows) items.push({ type, allDay: true, nature: 'deadline', workspaceId: String(r.workspace_id), workspaceName: String(r.workspace_name), ...map(r) } as AgendaItem);
  };
  await overlay('task', `SELECT x.id, x.title, x.due_date::text AS d, x.due_time, x.timezone, x.status, x.workspace_id, w.name AS workspace_name FROM tasks x ${scope} WHERE x.due_date BETWEEN $2 AND $3 AND x.status NOT IN ('archived','skipped','cancelled') AND (m.role <> 'limited' OR x.assignee_id = $1) ${wsFilter}`, (r) => ({
    id: String(r.id), title: String(r.title), date: String(r.d), status: String(r.status), link: `/app/tasks/${r.id}`, allDay: !r.due_time,
    startsAt: r.due_time ? zonedToUtc(String(r.d), String(r.due_time), String(r.timezone)) : null, nature: 'deadline',
  }));
  const notLimited = `AND m.role <> 'limited'`;
  await overlay('bill', `SELECT o.id, x.name AS title, o.due_date::text AS d, o.status, x.workspace_id, w.name AS workspace_name FROM bill_occurrences o JOIN bills x ON x.id = o.bill_id ${scope} WHERE o.due_date BETWEEN $2 AND $3 AND o.status <> 'cancelled' ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Bill due: ${r.title}`, date: String(r.d), status: String(r.status), link: `/app/bills#${r.id}` }));
  await overlay('renewal', `SELECT x.id, x.name AS title, x.next_renewal_date::text AS d, x.status, x.workspace_id, w.name AS workspace_name FROM service_subscriptions x ${scope} WHERE x.next_renewal_date BETWEEN $2 AND $3 AND x.status IN ('active','trial') ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Renews: ${r.title}`, date: String(r.d), link: `/app/subscriptions#${r.id}` }));
  await overlay('trial_end', `SELECT x.id, x.name AS title, x.trial_ends_on::text AS d, x.workspace_id, w.name AS workspace_name FROM service_subscriptions x ${scope} WHERE x.trial_ends_on BETWEEN $2 AND $3 AND x.status = 'trial' ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Trial ends: ${r.title}`, date: String(r.d), link: `/app/subscriptions#${r.id}` }));
  await overlay('warranty_end', `SELECT x.id, p.product_name AS title, x.ends_on::text AS d, x.workspace_id, w.name AS workspace_name, p.id AS pid FROM warranties x JOIN purchases p ON p.id = x.purchase_id ${scope} WHERE x.ends_on BETWEEN $2 AND $3 ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Warranty ends: ${r.title}`, date: String(r.d), link: `/app/purchases/${r.pid}` }));
  await overlay('return_deadline', `SELECT x.id, p.product_name AS title, x.deadline::text AS d, x.status, x.workspace_id, w.name AS workspace_name, p.id AS pid FROM return_windows x JOIN purchases p ON p.id = x.purchase_id ${scope} WHERE x.deadline BETWEEN $2 AND $3 AND x.status = 'open' ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Last day to return: ${r.title}`, date: String(r.d), link: `/app/purchases/${r.pid}` }));
  await overlay('document_expiry', `SELECT x.id, x.title, x.expires_on::text AS d, x.workspace_id, w.name AS workspace_name FROM documents x ${scope} WHERE x.expires_on BETWEEN $2 AND $3 ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Expires: ${r.title}`, date: String(r.d), link: `/app/vault/${r.id}` }));
  await overlay('life_event', `SELECT x.id, x.title, x.starts_on::text AS d, x.status, x.workspace_id, w.name AS workspace_name FROM life_events x ${scope} WHERE x.starts_on BETWEEN $2 AND $3 AND x.status <> 'cancelled' ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: String(r.title), date: String(r.d), nature: 'fixed', link: `/app/events/${r.id}` }));
  await overlay('admin_deadline', `SELECT x.id, x.title, x.deadline::text AS d, x.status, x.workspace_id, w.name AS workspace_name FROM admin_workflows x ${scope} WHERE x.deadline BETWEEN $2 AND $3 AND x.status NOT IN ('confirmed_completed','cancelled','rejected') ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `Deadline: ${r.title}`, date: String(r.d), link: `/app/admin/${r.id}` }));
  await overlay('promise_due', `SELECT x.id, x.description AS title, x.expected_by::text AS d, x.direction, x.workspace_id, w.name AS workspace_name FROM promises x ${scope} WHERE x.expected_by BETWEEN $2 AND $3 AND x.status = 'open' ${notLimited} ${wsFilter}`, (r) => ({ id: String(r.id), title: `${r.direction === 'i_promised' ? 'You promised' : 'Expected'}: ${r.title}`, date: String(r.d), link: `/app/promises#${r.id}` }));

  return items.sort((a, b) => a.date.localeCompare(b.date) || Number(a.allDay) - Number(b.allDay) || (a.startsAt ? new Date(a.startsAt).getTime() : 0) - (b.startsAt ? new Date(b.startsAt).getTime() : 0));
}

// ------------------------------------------------------------------ ICS

export async function importIcs(ctx: Ctx, workspaceId: string, filename: string, text: string) {
  if (text.length > 5_000_000) throw invalid('That calendar file is too large.');
  const tz = (await one<{ timezone: string }>(ctx.db, 'SELECT timezone FROM users WHERE id = $1', [ctx.userId]))!.timezone;
  const { events, warnings } = parseIcs(text, tz);
  if (!events.length && warnings.length) throw invalid(warnings[0]!);
  return withTx(ctx.db, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const importId = newId('imp');
    await tx.query(`INSERT INTO calendar_imports (id, workspace_id, filename, imported_count, updated_count, skipped_count, created_by) VALUES ($1,$2,$3,0,0,0,$4)`, [importId, workspaceId, filename.slice(0, 200), ctx.userId]);
    let imported = 0;
    let updated = 0;
    const skipped = 0;
    for (const e of events.slice(0, 5000)) {
      const existing = await one<{ id: string }>(tx, 'SELECT id FROM calendar_events WHERE workspace_id = $1 AND external_uid = $2', [workspaceId, e.uid]);
      const vals = [e.title, e.description, e.location, e.allDay, e.startsAt ?? null, e.endsAt ?? null, e.startDate ?? null, e.endDate ?? null, e.timezone ?? tz, e.recurrence ? JSON.stringify(e.recurrence) : null];
      let row: CalendarEvent;
      if (existing) {
        row = (await tx.query<CalendarEvent>(`UPDATE calendar_events SET title=$2, description=$3, location=$4, all_day=$5, starts_at=$6, ends_at=$7, start_date=$8, end_date=$9, timezone=$10, recurrence=$11, cancelled_at = NULL, import_id=$12, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [existing.id, ...vals, importId]))[0]!;
        updated++;
      } else {
        row = (await tx.query<CalendarEvent>(`INSERT INTO calendar_events (id, workspace_id, title, description, location, all_day, starts_at, ends_at, start_date, end_date, timezone, recurrence, source, external_uid, import_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ics',$13,$14,$15) RETURNING *`, [newId('evt'), workspaceId, ...vals, e.uid, importId, ctx.userId]))[0]!;
        imported++;
      }
      warnings.push(...e.warnings);
      await index(tx, row);
    }
    await tx.query('UPDATE calendar_imports SET imported_count = $2, updated_count = $3, skipped_count = $4 WHERE id = $1', [importId, imported, updated, skipped]);
    await audit(tx, { actorId: ctx.userId, workspaceId, action: 'calendar.imported', meta: { imported, updated } });
    return { importId, imported, updated, skipped, warnings };
  });
}

export async function exportIcs(ctx: Ctx, workspaceIds?: string[]): Promise<string> {
  const rows = await ctx.db.query<CalendarEvent>(
    `SELECT c.* FROM calendar_events c JOIN memberships m ON m.workspace_id = c.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      WHERE c.cancelled_at IS NULL AND ($2::text[] IS NULL OR c.workspace_id = ANY($2)) ORDER BY c.created_at`,
    [ctx.userId, workspaceIds?.length ? workspaceIds : null],
  );
  const events: ExportEvent[] = rows.map((e) => ({ id: e.id, title: e.title, description: e.description, location: e.location, allDay: e.all_day, startDate: e.start_date, endDate: e.end_date, startsAt: e.starts_at, endsAt: e.ends_at, recurrence: e.recurrence, updatedAt: e.updated_at }));
  return toIcs(events, ctx.now);
}

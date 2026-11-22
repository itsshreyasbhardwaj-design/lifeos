/**
 * LifeAdmin workflows, Life Events and Routines — the multi-step parts of life.
 *
 * Templates are starting checklists, written generically. They are labelled as
 * suggestions to check against the official source; LifeOS does not know any
 * institution's real requirements and never submits anything.
 */
import { z } from 'zod';
import { type IsoDate, addDays, isIsoDate } from '@lifeos/extract';
import type { Db, Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { invalid } from './errors.ts';
import { newId } from './ids.ts';
import { recordHistory } from './audit.ts';
import { loadScoped, requireRole } from './access.ts';
import { requireWorkspaceFeature } from './billing.ts';
import { indexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { addChecklistItems } from './tasks.ts';
import { occurrencesBetween, recurrenceSchema } from './recurrence.ts';
import { todayIn } from './time.ts';
import type { RecurrenceRule } from '@lifeos/extract';

const isoDate = z.string().refine(isIsoDate, 'Use a full date.');

interface TemplateItem {
  label: string;
  group?: string;
  kind?: 'item' | 'document' | 'step';
}
interface Template {
  key: string;
  name: string;
  description: string;
  items: TemplateItem[];
}

const doc = (label: string): TemplateItem => ({ label, kind: 'document', group: 'Documents to gather' });
const step = (label: string): TemplateItem => ({ label, kind: 'step', group: 'Steps' });

export const ADMIN_TEMPLATES: Template[] = [
  { key: 'university_application', name: 'University application', description: 'Gather documents and track an application to a college or university.', items: [
    step('Note the official deadline from the university’s own website'), step('Check the programme’s eligibility requirements'), doc('Mark sheets / transcripts'), doc('Identity document'),
    doc('Passport-size photographs'), doc('Statement of purpose or essay'), doc('Recommendation letters'), doc('Entrance or language test scores (if required)'),
    step('Fill in the application form'), step('Pay the application fee (you do this on the official site)'), step('Submit the application'), step('Save the confirmation or application number'),
  ] },
  { key: 'school_registration', name: 'School registration', description: 'Admission or annual registration for a child’s school.', items: [
    step('Confirm dates and requirements with the school'), doc('Birth certificate'), doc('Previous school records / transfer certificate'), doc('Address proof'), doc('Photographs'),
    doc('Medical or vaccination record (if the school asks)'), step('Fill in the form'), step('Pay fees with the school'), step('Keep the receipt and admission number'),
  ] },
  { key: 'membership_renewal', name: 'Membership renewal', description: 'Renew a club, professional or library membership.', items: [
    step('Find the renewal date and fee'), doc('Membership number / card'), step('Update any changed details'), step('Renew on the official channel'), step('Save the confirmation'),
  ] },
  { key: 'travel_documents', name: 'Travel documents', description: 'Prepare documents for a trip abroad.', items: [
    step('Check passport validity against the destination’s official rules'), step('Check visa requirements on the official government site'), doc('Passport'), doc('Visa or e-visa approval'),
    doc('Flight and hotel bookings'), doc('Travel insurance policy'), step('Make copies stored separately'),
  ] },
  { key: 'event_registration', name: 'Event registration', description: 'Register for a race, conference, exam or course.', items: [
    step('Note the registration deadline'), step('Register on the organiser’s site'), doc('Registration confirmation'), doc('Ticket or hall pass'), step('Add the event date to the calendar'),
  ] },
  { key: 'household_paperwork', name: 'Household paperwork', description: 'Address change, utility transfers and similar.', items: [
    step('List every account that needs the new details'), doc('New address proof'), step('Update bank'), step('Update utilities'), step('Update insurance'), step('Keep acknowledgements'),
  ] },
  { key: 'service_application', name: 'Service application', description: 'Any application to a service provider or office.', items: [
    step('Read the official requirements'), doc('Identity proof'), doc('Address proof'), step('Fill in the form'), step('Submit through the official channel'),
    step('Record the reference number'), step('Follow up if there is no response'),
  ] },
  { key: 'custom', name: 'Start from scratch', description: 'An empty workflow you build yourself.', items: [] },
];

export const EVENT_TEMPLATES: Template[] = [
  { key: 'travel', name: 'Travel', description: 'A trip with bookings, documents and packing.', items: [
    { label: 'Book transport', group: 'Before you go' }, { label: 'Book stay', group: 'Before you go' }, { label: 'Tell someone your plans', group: 'Before you go' },
    { label: 'ID / passport', group: 'Documents', kind: 'document' }, { label: 'Tickets', group: 'Documents', kind: 'document' }, { label: 'Hotel confirmation', group: 'Documents', kind: 'document' },
    { label: 'Clothes', group: 'Packing' }, { label: 'Chargers', group: 'Packing' }, { label: 'Medicines', group: 'Packing' }, { label: 'Toiletries', group: 'Packing' }, { label: 'Cash and cards', group: 'Packing' },
  ] },
  { key: 'moving_home', name: 'Moving home', description: 'Packing, utilities and address changes.', items: [
    { label: 'Get moving quotes', group: 'Planning' }, { label: 'Book movers', group: 'Planning' }, { label: 'Notice to current landlord', group: 'Planning' },
    { label: 'Transfer electricity', group: 'Utilities' }, { label: 'Transfer internet', group: 'Utilities' }, { label: 'Transfer gas', group: 'Utilities' },
    { label: 'Update address with bank', group: 'Address change' }, { label: 'Update address on IDs', group: 'Address change' }, { label: 'Pack room by room', group: 'Moving day' },
  ] },
  { key: 'starting_school', name: 'Starting school', description: 'A child’s first days at a new school.', items: [
    { label: 'Uniform', group: 'Buy' }, { label: 'Books and stationery', group: 'Buy' }, { label: 'School bag', group: 'Buy' }, { label: 'Arrange transport', group: 'Arrange' }, { label: 'Note timings and holidays', group: 'Arrange' },
  ] },
  { key: 'starting_university', name: 'Starting university', description: 'Accommodation, documents and setup.', items: [
    { label: 'Accommodation', group: 'Arrange' }, { label: 'Fee payment receipt', group: 'Documents', kind: 'document' }, { label: 'Admission letter', group: 'Documents', kind: 'document' },
    { label: 'Open student bank account', group: 'Arrange' }, { label: 'Bedding and essentials', group: 'Buy' },
  ] },
  { key: 'event_planning', name: 'Event planning', description: 'Plan any gathering.', items: [
    { label: 'Fix the date', group: 'Plan' }, { label: 'Guest list', group: 'Plan' }, { label: 'Venue', group: 'Book' }, { label: 'Food', group: 'Book' }, { label: 'Send invitations', group: 'Invite' },
  ] },
  { key: 'celebration', name: 'Celebration', description: 'Birthday, anniversary or festival.', items: [
    { label: 'Gift', group: 'Buy' }, { label: 'Cake / sweets', group: 'Buy' }, { label: 'Decorations', group: 'Buy' }, { label: 'Invite family', group: 'Invite' },
  ] },
  { key: 'purchase_delivery', name: 'Big purchase & delivery', description: 'Track a large purchase until it is installed.', items: [
    { label: 'Compare options', group: 'Before' }, { label: 'Save the invoice', group: 'After', kind: 'document' }, { label: 'Be home for delivery', group: 'Delivery' },
    { label: 'Check the item on arrival', group: 'Delivery' }, { label: 'Register the warranty', group: 'After' },
  ] },
  { key: 'admin_project', name: 'Personal admin project', description: 'Any multi-step personal project.', items: [] },
];

// ------------------------------------------------------------------ LifeAdmin

export const ADMIN_STATUSES = ['not_started', 'documents_needed', 'preparing', 'ready_for_review', 'awaiting_approval', 'ready_for_submission', 'user_reported_submitted', 'awaiting_confirmation', 'confirmed_completed', 'rejected', 'cancelled'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export const workflowInput = z.object({
  title: z.string().trim().min(1).max(300),
  templateKey: z.string().max(60).nullish(),
  officialUrl: z.string().url().max(2000).refine((u) => /^https?:/i.test(u), 'Use an http(s) link.').nullish(),
  referenceNumber: z.string().trim().max(120).nullish(),
  deadline: isoDate.nullish(),
  notes: z.string().max(20_000).nullish(),
});

export async function createWorkflow(ctx: Ctx, workspaceId: string, input: z.input<typeof workflowInput>) {
  const d = workflowInput.parse(input);
  const tpl = ADMIN_TEMPLATES.find((t) => t.key === (d.templateKey ?? 'custom'));
  if (d.templateKey && !tpl) throw invalid('Unknown template.');
  return withTx(ctx.db, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    await requireWorkspaceFeature(tx, workspaceId, ctx.userId, 'lifeadmin', ctx.now);
    const id = newId('adm');
    await tx.query(`INSERT INTO admin_workflows (id, workspace_id, title, template_key, official_url, reference_number, deadline, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      id, workspaceId, d.title, tpl?.key ?? null, d.officialUrl ?? null, d.referenceNumber ?? null, d.deadline ?? null, d.notes ?? null, ctx.userId,
    ]);
    if (tpl?.items.length) await addChecklistItems(ctx, 'admin_workflow', id, tpl.items, tx);
    if (d.deadline) {
      for (const days of [7, 1]) await scheduleReminder(tx, { workspaceId, userId: ctx.userId, targetType: 'admin_workflow', targetId: id, kind: 'advance', title: `${d.title}: deadline in ${days} day${days === 1 ? '' : 's'}`, anchorDate: addDays(d.deadline, -days), anchorTime: null, createdBy: ctx.userId });
    }
    await recordHistory(tx, { workspaceId, entityType: 'admin_workflow', entityId: id, action: 'created', changes: { template: tpl?.key ?? null }, actorId: ctx.userId });
    await indexRecord(tx, { entityType: 'admin_workflow', entityId: id, workspaceId, title: d.title, body: [tpl?.name, d.notes, d.referenceNumber].filter(Boolean).join('\n'), occursOn: d.deadline ?? null, status: 'not_started' });
    return { id };
  });
}

/**
 * Status changes. "user_reported_submitted" and "confirmed_completed" are what
 * the user tells LifeOS; neither means an institution has accepted anything.
 */
export async function setWorkflowStatus(ctx: Ctx, id: string, status: AdminStatus, input: { note?: string | null; on?: string | null; referenceNumber?: string | null } = {}) {
  if (!ADMIN_STATUSES.includes(status)) throw invalid('Unknown status.');
  return withTx(ctx.db, async (tx) => {
    const w = await loadScoped<{ workspace_id: string; status: string; title: string; reference_number: string | null }>(tx, ctx.userId, 'admin_workflows', id, 'write', 'Workflow');
    const on = input.on && isIsoDate(input.on) ? input.on : todayIn('UTC', ctx.now);
    await tx.query(
      `UPDATE admin_workflows SET status = $2, reference_number = COALESCE($3, reference_number),
              submitted_on = CASE WHEN $2 = 'user_reported_submitted' THEN $4::date ELSE submitted_on END,
              confirmed_on = CASE WHEN $2 = 'confirmed_completed' THEN $4::date ELSE confirmed_on END,
              version = version + 1, updated_at = now() WHERE id = $1`,
      [id, status, input.referenceNumber ?? null, on],
    );
    if (['confirmed_completed', 'rejected', 'cancelled'].includes(status)) await cancelRemindersFor(tx, 'admin_workflow', id, `workflow_${status}`);
    await recordHistory(tx, { workspaceId: w.workspace_id, entityType: 'admin_workflow', entityId: id, action: `status:${status}`, changes: { from: w.status, to: status, note: input.note ?? null, on }, actorId: ctx.userId });
    await indexRecord(tx, { entityType: 'admin_workflow', entityId: id, workspaceId: w.workspace_id, title: w.title, body: [input.referenceNumber ?? w.reference_number].filter(Boolean).join('\n'), status });
  });
}

export async function listWorkflows(ctx: Ctx) {
  return ctx.db.query(
    `SELECT a.*, (SELECT count(*)::int FROM checklist_items c WHERE c.owner_type = 'admin_workflow' AND c.owner_id = a.id) AS items,
            (SELECT count(*)::int FROM checklist_items c WHERE c.owner_type = 'admin_workflow' AND c.owner_id = a.id AND c.done) AS done_items
       FROM admin_workflows a JOIN memberships m ON m.workspace_id = a.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      ORDER BY (a.status IN ('confirmed_completed','cancelled','rejected')), a.deadline NULLS LAST, a.created_at DESC`,
    [ctx.userId],
  );
}

// ------------------------------------------------------------------ Life Events

export const lifeEventInput = z.object({
  title: z.string().trim().min(1).max(300),
  templateKey: z.string().max(60).nullish(),
  startsOn: isoDate.nullish(),
  endsOn: isoDate.nullish(),
  location: z.string().max(300).nullish(),
  notes: z.string().max(20_000).nullish(),
});

export async function createLifeEvent(ctx: Ctx, workspaceId: string, input: z.input<typeof lifeEventInput>) {
  const d = lifeEventInput.parse(input);
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) throw invalid('The end cannot be before the start.');
  const tpl = EVENT_TEMPLATES.find((t) => t.key === (d.templateKey ?? 'admin_project'));
  if (d.templateKey && !tpl) throw invalid('Unknown template.');
  return withTx(ctx.db, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const id = newId('lev');
    await tx.query(`INSERT INTO life_events (id, workspace_id, title, template_key, starts_on, ends_on, location, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, workspaceId, d.title, tpl?.key ?? null, d.startsOn ?? null, d.endsOn ?? null, d.location ?? null, d.notes ?? null, ctx.userId]);
    if (tpl?.items.length) await addChecklistItems(ctx, 'life_event', id, tpl.items, tx);
    if (d.startsOn) await scheduleReminder(tx, { workspaceId, userId: ctx.userId, targetType: 'life_event', targetId: id, kind: 'advance', title: `${d.title} starts in 7 days`, anchorDate: addDays(d.startsOn, -7), anchorTime: null, createdBy: ctx.userId });
    await recordHistory(tx, { workspaceId, entityType: 'life_event', entityId: id, action: 'created', changes: { template: tpl?.key ?? null }, actorId: ctx.userId });
    await indexRecord(tx, { entityType: 'life_event', entityId: id, workspaceId, title: d.title, body: [tpl?.name, d.location, d.notes].filter(Boolean).join('\n'), occursOn: d.startsOn ?? null, status: 'planning' });
    return { id };
  });
}

export async function addParticipant(ctx: Ctx, eventId: string, input: { name: string; userId?: string | null; responsibility?: string | null }) {
  const e = await loadScoped<{ workspace_id: string }>(ctx.db, ctx.userId, 'life_events', eventId, 'write', 'Event');
  const id = newId('epa');
  await ctx.db.query('INSERT INTO event_participants (id, life_event_id, workspace_id, name, user_id, responsibility) VALUES ($1,$2,$3,$4,$5,$6)', [id, eventId, e.workspace_id, input.name.trim().slice(0, 120), input.userId ?? null, input.responsibility?.slice(0, 300) ?? null]);
  return { id };
}

export async function setLifeEventStatus(ctx: Ctx, eventId: string, status: 'planning' | 'in_progress' | 'done' | 'cancelled') {
  const e = await loadScoped<{ workspace_id: string; title: string }>(ctx.db, ctx.userId, 'life_events', eventId, 'write', 'Event');
  await ctx.db.query('UPDATE life_events SET status = $2, updated_at = now() WHERE id = $1', [eventId, status]);
  if (status === 'done' || status === 'cancelled') await cancelRemindersFor(ctx.db, 'life_event', eventId, `event_${status}`);
  await recordHistory(ctx.db, { workspaceId: e.workspace_id, entityType: 'life_event', entityId: eventId, action: `status:${status}`, actorId: ctx.userId });
}

export async function listLifeEvents(ctx: Ctx) {
  return ctx.db.query(
    `SELECT e.*, (SELECT count(*)::int FROM checklist_items c WHERE c.owner_type = 'life_event' AND c.owner_id = e.id) AS items,
            (SELECT count(*)::int FROM checklist_items c WHERE c.owner_type = 'life_event' AND c.owner_id = e.id AND c.done) AS done_items
       FROM life_events e JOIN memberships m ON m.workspace_id = e.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      ORDER BY (e.status IN ('done','cancelled')), e.starts_on NULLS LAST`,
    [ctx.userId],
  );
}

export async function lifeEventDetail(ctx: Ctx, id: string) {
  const e = await loadScoped<Record<string, unknown> & { workspace_id: string }>(ctx.db, ctx.userId, 'life_events', id, 'read', 'Event');
  const participants = await ctx.db.query('SELECT id, name, user_id, responsibility FROM event_participants WHERE life_event_id = $1 ORDER BY created_at', [id]);
  return { event: e, participants };
}

// ------------------------------------------------------------------ Routines

export const routineInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  recurrence: recurrenceSchema,
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  startsOn: isoDate.nullish(),
  reminderEnabled: z.boolean().default(false),
});

export interface Routine {
  id: string; workspace_id: string; title: string; description: string | null; recurrence: RecurrenceRule; time_of_day: string | null; timezone: string;
  starts_on: string; reminder_enabled: boolean; paused_at: Date | null; archived_at: Date | null; created_by: string | null;
}

export async function createRoutine(ctx: Ctx, workspaceId: string, input: z.input<typeof routineInput>) {
  const d = routineInput.parse(input);
  await requireRole(ctx.db, ctx.userId, workspaceId, 'write');
  const tz = (await one<{ timezone: string }>(ctx.db, 'SELECT timezone FROM users WHERE id = $1', [ctx.userId]))!.timezone;
  const id = newId('rtn');
  await ctx.db.query(`INSERT INTO routines (id, workspace_id, title, description, recurrence, time_of_day, timezone, starts_on, reminder_enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
    id, workspaceId, d.title, d.description ?? null, JSON.stringify(d.recurrence), d.timeOfDay ?? null, tz, d.startsOn ?? todayIn(tz, ctx.now), d.reminderEnabled, ctx.userId,
  ]);
  await indexRecord(ctx.db, { entityType: 'routine', entityId: id, workspaceId, title: d.title, body: [d.description, 'routine habit'].filter(Boolean).join('\n') });
  await scheduleRoutineReminders(ctx.db, ctx.now);
  return { id };
}

/** Done or skipped for one day. Recording twice for the same day updates, never duplicates. */
export async function recordRoutine(ctx: Ctx, routineId: string, on: IsoDate, status: 'done' | 'skipped', note?: string | null) {
  if (!isIsoDate(on)) throw invalid('Use a full date.');
  const r = await loadScoped<Routine>(ctx.db, ctx.userId, 'routines', routineId, 'write', 'Routine');
  if (!occurrencesBetween(r.recurrence, r.starts_on, on, on).length) throw invalid('This routine is not scheduled for that day.');
  await ctx.db.query(
    `INSERT INTO routine_occurrences (id, routine_id, workspace_id, occurs_on, status, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (routine_id, occurs_on) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, recorded_at = now()`,
    [newId('rto'), routineId, r.workspace_id, on, status, note ?? null, ctx.userId],
  );
}

export async function setRoutineState(ctx: Ctx, routineId: string, state: 'pause' | 'resume' | 'archive') {
  await loadScoped<Routine>(ctx.db, ctx.userId, 'routines', routineId, 'write', 'Routine');
  const sql = state === 'pause' ? 'paused_at = now()' : state === 'resume' ? 'paused_at = NULL' : 'archived_at = now()';
  await ctx.db.query(`UPDATE routines SET ${sql}, updated_at = now() WHERE id = $1`, [routineId]);
  if (state !== 'resume') await cancelRemindersFor(ctx.db, 'routine', routineId, `routine_${state}`);
}

/** Routines with this week's occurrences and what was recorded. No streaks, no scores. */
export async function routinesOverview(ctx: Ctx, from: IsoDate, to: IsoDate) {
  const rows = await ctx.db.query<Routine>(`SELECT r.* FROM routines r JOIN memberships m ON m.workspace_id = r.workspace_id AND m.user_id = $1 AND m.role <> 'limited' WHERE r.archived_at IS NULL ORDER BY r.created_at`, [ctx.userId]);
  const recorded = rows.length ? await ctx.db.query<{ routine_id: string; occurs_on: string; status: string }>(`SELECT routine_id, occurs_on, status FROM routine_occurrences WHERE routine_id = ANY($1) AND occurs_on BETWEEN $2 AND $3`, [rows.map((r) => r.id), from, to]) : [];
  return rows.map((r) => ({
    ...r,
    occurrences: r.paused_at ? [] : occurrencesBetween(r.recurrence, r.starts_on, from, to).map((d) => ({ date: d, status: recorded.find((x) => x.routine_id === r.id && x.occurs_on === d)?.status ?? null })),
  }));
}

/** Idempotent: schedules reminders for routine occurrences in the next 48 hours. */
export async function scheduleRoutineReminders(db: Db | Queryable, now = new Date()): Promise<number> {
  const rows = await db.query<Routine>(`SELECT * FROM routines WHERE reminder_enabled AND paused_at IS NULL AND archived_at IS NULL`);
  let n = 0;
  for (const r of rows) {
    const from = todayIn(r.timezone, now);
    for (const d of occurrencesBetween(r.recurrence, r.starts_on, from, addDays(from, 2), 3)) {
      // Any reminder ever made for this occurrence — delivered, dismissed or
      // cancelled — means we must not make another (no repeat notifications).
      const exists = await db.query(`SELECT 1 FROM reminders WHERE target_type = 'routine' AND target_id = $1 AND anchor_date = $2 LIMIT 1`, [r.id, d]);
      const recorded = await db.query(`SELECT 1 FROM routine_occurrences WHERE routine_id = $1 AND occurs_on = $2`, [r.id, d]);
      if (exists.length || recorded.length) continue;
      const id = await scheduleReminder(db as Queryable, { workspaceId: r.workspace_id, userId: r.created_by!, targetType: 'routine', targetId: r.id, kind: 'routine', title: r.title, anchorDate: d, anchorTime: r.time_of_day, createdBy: null });
      if (id) n++;
    }
  }
  return n;
}

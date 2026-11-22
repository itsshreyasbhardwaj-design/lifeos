/**
 * SubscriptionOS and bills. LifeOS organises recurring commitments; it does
 * not move money. "Paid" is always what the user reported, and a renewal is
 * only advanced when the user confirms it happened.
 */
import { z } from 'zod';
import { type IsoDate, addDays, addMonths, isIsoDate } from '@lifeos/extract';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { invalid } from './errors.ts';
import { newId } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { loadScoped, requireRole } from './access.ts';
import { indexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { todayIn } from './time.ts';

const isoDate = z.string().refine(isIsoDate, 'Use a full date.');
export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export function advance(date: IsoDate, cycle: Cycle | 'once'): IsoDate | null {
  if (cycle === 'weekly') return addDays(date, 7);
  if (cycle === 'monthly') return addMonths(date, 1);
  if (cycle === 'quarterly') return addMonths(date, 3);
  if (cycle === 'yearly') return addMonths(date, 12);
  return null;
}

/** Normalised monthly cost, for summaries only. */
export function monthlyEquivalent(amountMinor: number, cycle: Cycle): number {
  return Math.round(cycle === 'weekly' ? (amountMinor * 52) / 12 : cycle === 'quarterly' ? amountMinor / 3 : cycle === 'yearly' ? amountMinor / 12 : amountMinor);
}

// ------------------------------------------------------------------ subscriptions

export const subscriptionInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).nullish(),
  amountMinor: z.number().int().min(0).max(1e12).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  cycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  nextRenewalDate: isoDate.nullish(),
  trialEndsOn: isoDate.nullish(),
  accountLabel: z.string().trim().max(120).nullish(),
  remindDaysBefore: z.number().int().min(0).max(60).default(3),
});

export interface Subscription {
  id: string; workspace_id: string; name: string; category: string | null; amount_minor: number | null; currency: string; cycle: Cycle; next_renewal_date: string | null;
  trial_ends_on: string | null; account_label: string | null; status: string; cancellation_notes: string | null; cancelled_on: string | null; version: number;
}

async function subReminders(q: Queryable, s: Subscription, userId: string, daysBefore: number) {
  await cancelRemindersFor(q, 'subscription', s.id, 'rescheduled');
  if (!['trial', 'active'].includes(s.status)) return;
  if (s.next_renewal_date) {
    await scheduleReminder(q, { workspaceId: s.workspace_id, userId, targetType: 'subscription', targetId: s.id, kind: 'renewal', title: `${s.name} renews ${daysBefore ? `in ${daysBefore} days` : 'today'}`, note: `Renews ${s.next_renewal_date}`, anchorDate: addDays(s.next_renewal_date, -daysBefore), anchorTime: null, createdBy: userId });
  }
  if (s.trial_ends_on) {
    await scheduleReminder(q, { workspaceId: s.workspace_id, userId, targetType: 'subscription', targetId: s.id, kind: 'expiry', title: `${s.name} free trial ends in 2 days`, note: `Trial ends ${s.trial_ends_on}`, anchorDate: addDays(s.trial_ends_on, -2), anchorTime: null, createdBy: userId });
  }
}

async function subIndex(q: Queryable, s: Subscription) {
  await indexRecord(q, { entityType: 'subscription', entityId: s.id, workspaceId: s.workspace_id, title: s.name, body: [s.category, s.account_label, s.cycle, 'subscription renewal', s.cancellation_notes].filter(Boolean).join('\n'), occursOn: s.next_renewal_date, status: s.status });
}

export async function createSubscription(ctx: Ctx, workspaceId: string, input: z.input<typeof subscriptionInput>, q: Queryable = ctx.db): Promise<Subscription> {
  const d = subscriptionInput.parse(input);
  return withTx(q, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const id = newId('sub');
    const rows = await tx.query<Subscription>(
      `INSERT INTO service_subscriptions (id, workspace_id, name, category, amount_minor, currency, cycle, next_renewal_date, trial_ends_on, account_label, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, workspaceId, d.name, d.category ?? null, d.amountMinor ?? null, d.currency, d.cycle, d.nextRenewalDate ?? null, d.trialEndsOn ?? null, d.accountLabel ?? null, d.trialEndsOn ? 'trial' : 'active', ctx.userId],
    );
    const s = rows[0]!;
    await tx.query(`INSERT INTO subscription_events (id, subscription_id, workspace_id, kind, new_amount_minor, occurred_on, created_by) VALUES ($1,$2,$3,'created',$4,$5,$6)`, [newId('sev'), id, workspaceId, d.amountMinor ?? null, todayIn('UTC', ctx.now), ctx.userId]);
    await subReminders(tx, s, ctx.userId, d.remindDaysBefore);
    await subIndex(tx, s);
    return s;
  });
}

/** The user confirms a renewal happened; the next date advances by one cycle. */
export async function confirmRenewal(ctx: Ctx, id: string, opts: { newAmountMinor?: number | null } = {}): Promise<Subscription> {
  return withTx(ctx.db, async (tx) => {
    const s = await loadScoped<Subscription>(tx, ctx.userId, 'service_subscriptions', id, 'write', 'Subscription');
    if (!s.next_renewal_date) throw invalid('Set the renewal date first.');
    if (!['active', 'trial'].includes(s.status)) throw invalid('Only active subscriptions renew.');
    const next = advance(s.next_renewal_date, s.cycle)!;
    const priceChanged = opts.newAmountMinor !== undefined && opts.newAmountMinor !== null && opts.newAmountMinor !== s.amount_minor;
    const rows = await tx.query<Subscription>(`UPDATE service_subscriptions SET next_renewal_date = $2, status = 'active', trial_ends_on = NULL, amount_minor = COALESCE($3, amount_minor), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, next, priceChanged ? opts.newAmountMinor : null]);
    await tx.query(`INSERT INTO subscription_events (id, subscription_id, workspace_id, kind, occurred_on, note, created_by) VALUES ($1,$2,$3,'renewed',$4,'confirmed by user',$5)`, [newId('sev'), id, s.workspace_id, s.next_renewal_date, ctx.userId]);
    if (priceChanged) await tx.query(`INSERT INTO subscription_events (id, subscription_id, workspace_id, kind, old_amount_minor, new_amount_minor, occurred_on, note, created_by) VALUES ($1,$2,$3,'price_changed',$4,$5,$6,'confirmed by user',$7)`, [newId('sev'), id, s.workspace_id, s.amount_minor, opts.newAmountMinor, s.next_renewal_date, ctx.userId]);
    await subReminders(tx, rows[0]!, ctx.userId, 3);
    await subIndex(tx, rows[0]!);
    return rows[0]!;
  });
}

export const CANCELLATION_CHECKLIST = [
  'Find where to cancel (account settings or the provider’s help page)',
  'Check whether cancelling ends access now or at the end of the period',
  'Download anything you want to keep',
  'Turn off auto-pay / UPI mandate for this service if one exists',
  'Save the cancellation confirmation (email or screenshot)',
];

/**
 * Cancellation is organised, not performed: LifeOS has no access to the
 * provider. Step 1 records intent and a checklist; step 2 records the user's
 * confirmation (optionally with evidence). Future renewal reminders stop at
 * step 2 — and also at step 1 if the user says access already ended.
 */
export async function requestCancellation(ctx: Ctx, id: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const s = await loadScoped<Subscription>(tx, ctx.userId, 'service_subscriptions', id, 'write', 'Subscription');
    await tx.query(`UPDATE service_subscriptions SET status = 'cancellation_pending', version = version + 1, updated_at = now() WHERE id = $1`, [id]);
    const existing = await tx.query(`SELECT 1 FROM checklist_items WHERE owner_type = 'subscription' AND owner_id = $1 LIMIT 1`, [id]);
    if (!existing.length) {
      let i = 0;
      for (const label of CANCELLATION_CHECKLIST) await tx.query(`INSERT INTO checklist_items (id, workspace_id, owner_type, owner_id, label, position) VALUES ($1,$2,'subscription',$3,$4,$5)`, [newId('chk'), s.workspace_id, id, label, ++i]);
    }
    await tx.query(`INSERT INTO subscription_events (id, subscription_id, workspace_id, kind, occurred_on, created_by) VALUES ($1,$2,$3,'cancellation_requested',$4,$5)`, [newId('sev'), id, s.workspace_id, todayIn('UTC', ctx.now), ctx.userId]);
  });
}

export async function confirmCancellation(ctx: Ctx, id: string, input: { cancelledOn: string; notes?: string | null; evidenceDocumentId?: string | null }): Promise<Subscription> {
  if (!isIsoDate(input.cancelledOn)) throw invalid('Use a full date.');
  return withTx(ctx.db, async (tx) => {
    const s = await loadScoped<Subscription>(tx, ctx.userId, 'service_subscriptions', id, 'write', 'Subscription');
    const rows = await tx.query<Subscription>(`UPDATE service_subscriptions SET status = 'cancelled', cancelled_on = $2, cancellation_notes = $3, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, input.cancelledOn, input.notes ?? null]);
    const n = await cancelRemindersFor(tx, 'subscription', id, 'subscription_cancelled');
    await tx.query(`INSERT INTO subscription_events (id, subscription_id, workspace_id, kind, occurred_on, note, created_by) VALUES ($1,$2,$3,'cancelled',$4,$5,$6)`, [newId('sev'), id, s.workspace_id, input.cancelledOn, 'user-reported', ctx.userId]);
    if (input.evidenceDocumentId) {
      const { link } = await import('./links.ts');
      await link(tx, { workspaceId: s.workspace_id, fromType: 'document', fromId: input.evidenceDocumentId, toType: 'subscription', toId: id, relation: 'evidence_for', provenance: { source: 'user' }, actorId: ctx.userId });
    }
    await audit(tx, { actorId: ctx.userId, workspaceId: s.workspace_id, action: 'subscription.cancelled', entityType: 'subscription', entityId: id, meta: { reminders_cancelled: n } });
    await subIndex(tx, rows[0]!);
    return rows[0]!;
  });
}

export async function listSubscriptions(ctx: Ctx) {
  const tz = (await ctx.db.query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [ctx.userId]))[0]!.timezone;
  const rows = await ctx.db.query<Subscription & { renewal_unconfirmed: boolean }>(
    `SELECT s.*, (s.status IN ('active','trial') AND s.next_renewal_date < $2::date) AS renewal_unconfirmed
       FROM service_subscriptions s JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
      ORDER BY (s.status = 'cancelled'), s.next_renewal_date NULLS LAST`,
    [ctx.userId, todayIn(tz, ctx.now)],
  );
  // Totals per currency; never summed across currencies.
  const totals = new Map<string, { monthly: number; yearly: number; count: number; unknownAmount: number }>();
  for (const s of rows) {
    if (!['active', 'trial', 'cancellation_pending'].includes(s.status)) continue;
    const t = totals.get(s.currency) ?? { monthly: 0, yearly: 0, count: 0, unknownAmount: 0 };
    t.count++;
    if (s.amount_minor === null) t.unknownAmount++;
    else {
      const m = monthlyEquivalent(s.amount_minor, s.cycle);
      t.monthly += m;
      t.yearly += m * 12;
    }
    totals.set(s.currency, t);
  }
  return { subscriptions: rows, totals: [...totals.entries()].map(([currency, t]) => ({ currency, ...t })) };
}

export async function subscriptionHistory(ctx: Ctx, id: string) {
  await loadScoped(ctx.db, ctx.userId, 'service_subscriptions', id, 'read', 'Subscription');
  return ctx.db.query('SELECT kind, old_amount_minor, new_amount_minor, occurred_on, note, created_at FROM subscription_events WHERE subscription_id = $1 ORDER BY created_at', [id]);
}

// ------------------------------------------------------------------ bills

export const billInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(['rent', 'electricity', 'water', 'gas', 'internet', 'mobile', 'education', 'insurance', 'membership', 'maintenance', 'other']).default('other'),
  payee: z.string().trim().max(200).nullish(),
  amountMinor: z.number().int().min(0).max(1e12).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  cycle: z.enum(['once', 'monthly', 'quarterly', 'yearly']),
  nextDueDate: isoDate,
  notes: z.string().max(5000).nullish(),
  remindDaysBefore: z.number().int().min(0).max(30).default(3),
});

async function billOccurrence(q: Queryable, ctx: Ctx, bill: { id: string; workspace_id: string; name: string; amount_minor: number | null }, due: IsoDate, daysBefore: number) {
  const id = newId('bocc');
  const ins = await q.query<{ id: string }>(`INSERT INTO bill_occurrences (id, bill_id, workspace_id, due_date, amount_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bill_id, due_date) DO NOTHING RETURNING id`, [id, bill.id, bill.workspace_id, due, bill.amount_minor]);
  if (!ins[0]) return null;
  for (const days of [...new Set([daysBefore, 0])]) {
    await scheduleReminder(q, { workspaceId: bill.workspace_id, userId: ctx.userId, targetType: 'bill_occurrence', targetId: id, kind: days ? 'advance' : 'due', title: days ? `${bill.name} due in ${days} days` : `${bill.name} is due today`, note: `Due ${due}`, anchorDate: addDays(due, -days), anchorTime: null, createdBy: ctx.userId });
  }
  return id;
}

export async function createBill(ctx: Ctx, workspaceId: string, input: z.input<typeof billInput>, q: Queryable = ctx.db) {
  const d = billInput.parse(input);
  return withTx(q, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const id = newId('bil');
    const rows = await tx.query<{ id: string; workspace_id: string; name: string; amount_minor: number | null }>(
      `INSERT INTO bills (id, workspace_id, name, category, payee, amount_minor, currency, cycle, next_due_date, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, workspaceId, d.name, d.category, d.payee ?? null, d.amountMinor ?? null, d.currency, d.cycle, d.nextDueDate, d.notes ?? null, ctx.userId],
    );
    const occurrenceId = await billOccurrence(tx, ctx, rows[0]!, d.nextDueDate, d.remindDaysBefore);
    await indexRecord(tx, { entityType: 'bill', entityId: id, workspaceId, title: d.name, body: [d.category, d.payee, d.notes, 'bill payment due'].filter(Boolean).join('\n'), occursOn: d.nextDueDate });
    return { id, occurrenceId };
  });
}

/**
 * The user reports a bill paid. The occurrence is marked user-reported (never
 * "verified"), its reminders stop, and the next occurrence is created once.
 */
export async function reportBillPaid(ctx: Ctx, occurrenceId: string, input: { paidOn: string; note?: string | null }) {
  if (!isIsoDate(input.paidOn)) throw invalid('Use a full date.');
  return withTx(ctx.db, async (tx) => {
    const occ = await loadScoped<{ workspace_id: string; bill_id: string; due_date: string; status: string }>(tx, ctx.userId, 'bill_occurrences', occurrenceId, 'write', 'Bill');
    if (occ.status !== 'upcoming') throw invalid('This bill is already recorded as paid or cancelled.');
    await tx.query(`UPDATE bill_occurrences SET status = 'user_reported_paid', paid_reported_on = $2, paid_note = $3 WHERE id = $1`, [occurrenceId, input.paidOn, input.note ?? null]);
    await cancelRemindersFor(tx, 'bill_occurrence', occurrenceId, 'bill_paid');
    const bill = await one<{ id: string; workspace_id: string; name: string; amount_minor: number | null; cycle: Cycle | 'once'; status: string }>(tx, 'SELECT * FROM bills WHERE id = $1', [occ.bill_id]);
    let nextId: string | null = null;
    const next = bill && bill.status === 'active' ? advance(occ.due_date, bill.cycle) : null;
    if (bill && next) {
      await tx.query('UPDATE bills SET next_due_date = $2, updated_at = now() WHERE id = $1', [bill.id, next]);
      nextId = await billOccurrence(tx, ctx, bill, next, 3);
    }
    await recordHistory(tx, { workspaceId: occ.workspace_id, entityType: 'bill', entityId: occ.bill_id, action: 'user_reported_paid', changes: { due_date: occ.due_date, paid_on: input.paidOn }, actorId: ctx.userId });
    return { nextOccurrenceId: nextId };
  });
}

export async function cancelBill(ctx: Ctx, billId: string) {
  await withTx(ctx.db, async (tx) => {
    const b = await loadScoped<{ workspace_id: string }>(tx, ctx.userId, 'bills', billId, 'write', 'Bill');
    await tx.query(`UPDATE bills SET status = 'cancelled', updated_at = now() WHERE id = $1`, [billId]);
    for (const o of await tx.query<{ id: string }>(`UPDATE bill_occurrences SET status = 'cancelled' WHERE bill_id = $1 AND status = 'upcoming' RETURNING id`, [billId])) {
      await cancelRemindersFor(tx, 'bill_occurrence', o.id, 'bill_cancelled');
    }
    await recordHistory(tx, { workspaceId: b.workspace_id, entityType: 'bill', entityId: billId, action: 'cancelled', actorId: ctx.userId });
  });
}

export async function listBills(ctx: Ctx) {
  const tz = (await ctx.db.query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [ctx.userId]))[0]!.timezone;
  const today = todayIn(tz, ctx.now);
  return ctx.db.query(
    `SELECT b.id AS bill_id, b.name, b.category, b.payee, b.cycle, b.currency, b.status AS bill_status, o.id AS occurrence_id, o.due_date, o.amount_minor, o.status, o.paid_reported_on,
            CASE WHEN o.status = 'upcoming' AND o.due_date < $2::date THEN 'overdue' WHEN o.status = 'upcoming' AND o.due_date = $2::date THEN 'due' ELSE o.status END AS display_status
       FROM bills b JOIN memberships m ON m.workspace_id = b.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
       JOIN bill_occurrences o ON o.bill_id = b.id
      ORDER BY (o.status = 'upcoming') DESC, o.due_date`,
    [ctx.userId, today],
  );
}

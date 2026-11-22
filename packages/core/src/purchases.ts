/**
 * Purchase Protection OS: purchases, receipts, warranties, return windows,
 * refund follow-ups and service history.
 *
 * Warranty and return terms come only from what the user entered or confirmed
 * from their own document (`basis`). LifeOS never assumes a manufacturer's or
 * merchant's policy.
 */
import { z } from 'zod';
import { addDays, addMonths, isIsoDate } from '@lifeos/extract';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { invalid, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { loadScoped, requireRole } from './access.ts';
import { requireWorkspaceFeature } from './billing.ts';
import { indexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { link } from './links.ts';
import { createTask } from './tasks.ts';
import { todayIn } from './time.ts';

const isoDate = z.string().refine(isIsoDate, 'Use a full date.');
const currency = z.string().regex(/^[A-Z]{3}$/).default('INR');

export const purchaseInput = z.object({
  productName: z.string().trim().min(1, 'What did you buy?').max(300),
  merchant: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(60).nullish(),
  purchaseDate: isoDate.nullish(),
  amountMinor: z.number().int().min(0).max(1e13).nullish(),
  currency,
  orderRef: z.string().trim().max(120).nullish(),
  deliveryDate: isoDate.nullish(),
  notes: z.string().max(10_000).nullish(),
  receiptDocumentId: z.string().nullish(),
  sourceCaptureId: z.string().nullish(),
});

export const warrantyInput = z.object({
  startsOn: isoDate,
  endsOn: isoDate.nullish(),
  months: z.number().int().min(1).max(600).nullish(),
  provider: z.string().max(200).nullish(),
  terms: z.string().max(5000).nullish(),
  basis: z.enum(['user_entered', 'document_confirmed']).default('user_entered'),
  remindDaysBefore: z.array(z.number().int().min(0).max(365)).max(3).default([30, 7]),
});

export const returnInput = z.object({
  deadline: isoDate,
  basis: z.enum(['user_entered', 'document_confirmed']).default('user_entered'),
  eligibilityNotes: z.string().max(5000).nullish(),
  remindDaysBefore: z.array(z.number().int().min(0).max(60)).max(3).default([2, 0]),
});

export interface Purchase {
  id: string; workspace_id: string; product_name: string; merchant: string | null; category: string | null; purchase_date: string | null; amount_minor: number | null;
  currency: string; order_ref: string | null; delivery_date: string | null; notes: string | null; receipt_document_id: string | null; source_capture_id: string | null; version: number; created_at: Date;
}

async function reindex(q: Queryable, p: Purchase) {
  await indexRecord(q, { entityType: 'purchase', entityId: p.id, workspaceId: p.workspace_id, title: p.product_name, body: [p.merchant, p.category, p.order_ref, p.notes, 'purchase receipt invoice'].filter(Boolean).join('\n'), occursOn: p.purchase_date });
}

export async function createPurchase(ctx: Ctx, workspaceId: string, input: z.input<typeof purchaseInput>, q: Queryable = ctx.db): Promise<Purchase> {
  const d = purchaseInput.parse(input);
  return withTx(q, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    await requireWorkspaceFeature(tx, workspaceId, ctx.userId, 'purchase_protection', ctx.now);
    const id = newId('pur');
    const rows = await tx.query<Purchase>(
      `INSERT INTO purchases (id, workspace_id, product_name, merchant, category, purchase_date, amount_minor, currency, order_ref, delivery_date, notes, receipt_document_id, source_capture_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, workspaceId, d.productName, d.merchant ?? null, d.category ?? null, d.purchaseDate ?? null, d.amountMinor ?? null, d.currency, d.orderRef ?? null, d.deliveryDate ?? null, d.notes ?? null, d.receiptDocumentId ?? null, d.sourceCaptureId ?? null, ctx.userId],
    );
    const p = rows[0]!;
    if (d.receiptDocumentId) await link(tx, { workspaceId, fromType: 'document', fromId: d.receiptDocumentId, toType: 'purchase', toId: id, relation: 'receipt_for', provenance: { source: 'user' }, actorId: ctx.userId });
    await recordHistory(tx, { workspaceId, entityType: 'purchase', entityId: id, action: 'created', actorId: ctx.userId });
    await reindex(tx, p);
    return p;
  });
}

export async function updatePurchase(ctx: Ctx, id: string, input: Partial<z.input<typeof purchaseInput>>): Promise<Purchase> {
  return withTx(ctx.db, async (tx) => {
    const cur = await loadScoped<Purchase>(tx, ctx.userId, 'purchases', id, 'write', 'Purchase');
    const d = purchaseInput.partial().parse(input);
    const pick = <T>(v: T | undefined, c: T) => (v === undefined ? c : v);
    const rows = await tx.query<Purchase>(
      `UPDATE purchases SET product_name=$2, merchant=$3, category=$4, purchase_date=$5, amount_minor=$6, currency=$7, order_ref=$8, delivery_date=$9, notes=$10, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, pick(d.productName, cur.product_name), pick(d.merchant, cur.merchant), pick(d.category, cur.category), pick(d.purchaseDate, cur.purchase_date), pick(d.amountMinor, cur.amount_minor),
        pick(d.currency, cur.currency), pick(d.orderRef, cur.order_ref), pick(d.deliveryDate, cur.delivery_date), pick(d.notes, cur.notes)],
    );
    await recordHistory(tx, { workspaceId: cur.workspace_id, entityType: 'purchase', entityId: id, action: 'updated', changes: d as Record<string, unknown>, actorId: ctx.userId });
    await reindex(tx, rows[0]!);
    return rows[0]!;
  });
}

export async function attachReceipt(ctx: Ctx, purchaseId: string, documentId: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const p = await loadScoped<Purchase>(tx, ctx.userId, 'purchases', purchaseId, 'write', 'Purchase');
    const doc = await loadScoped<{ workspace_id: string }>(tx, ctx.userId, 'documents', documentId, 'read', 'Document');
    if (doc.workspace_id !== p.workspace_id) throw invalid('The receipt must be in the same space as the purchase.');
    await tx.query('UPDATE purchases SET receipt_document_id = $2, updated_at = now() WHERE id = $1', [purchaseId, documentId]);
    await link(tx, { workspaceId: p.workspace_id, fromType: 'document', fromId: documentId, toType: 'purchase', toId: purchaseId, relation: 'receipt_for', provenance: { source: 'user' }, actorId: ctx.userId });
  });
}

export async function addWarranty(ctx: Ctx, purchaseId: string, input: z.input<typeof warrantyInput>, q: Queryable = ctx.db, provenance: { candidateId?: string; captureId?: string } = {}) {
  const d = warrantyInput.parse(input);
  const endsOn = d.endsOn ?? (d.months ? addDays(addMonths(d.startsOn, d.months), -1) : null);
  if (!endsOn) throw invalid('Give the warranty end date or its length in months.');
  if (endsOn < d.startsOn) throw invalid('The warranty cannot end before it starts.');
  return withTx(q, async (tx) => {
    const p = await loadScoped<Purchase>(tx, ctx.userId, 'purchases', purchaseId, 'write', 'Purchase');
    await requireWorkspaceFeature(tx, p.workspace_id, ctx.userId, 'purchase_protection', ctx.now);
    const id = newId('war');
    await tx.query(`INSERT INTO warranties (id, workspace_id, purchase_id, starts_on, ends_on, provider, terms, basis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      id, p.workspace_id, purchaseId, d.startsOn, endsOn, d.provider ?? null, d.terms ?? null, d.basis,
    ]);
    await link(tx, { workspaceId: p.workspace_id, fromType: 'warranty', fromId: id, toType: 'purchase', toId: purchaseId, relation: 'warranty_of', provenance: { source: provenance.candidateId ? 'confirmed_extraction' : 'user', ...provenance }, actorId: ctx.userId });
    for (const days of d.remindDaysBefore) {
      await scheduleReminder(tx, { workspaceId: p.workspace_id, userId: ctx.userId, targetType: 'warranty', targetId: id, kind: 'expiry', title: `Warranty ends ${days === 0 ? 'today' : `in ${days} days`}: ${p.product_name}`, note: `Ends ${endsOn}`, anchorDate: addDays(endsOn, -days), anchorTime: null, createdBy: ctx.userId });
    }
    await indexRecord(tx, { entityType: 'warranty', entityId: id, workspaceId: p.workspace_id, title: `Warranty — ${p.product_name}`, body: [p.merchant, d.provider, d.terms, 'warranty guarantee'].filter(Boolean).join('\n'), occursOn: endsOn });
    await recordHistory(tx, { workspaceId: p.workspace_id, entityType: 'purchase', entityId: purchaseId, action: 'warranty_added', changes: { ends_on: endsOn, basis: d.basis }, actorId: ctx.userId });
    return { id, endsOn };
  });
}

export async function addReturnWindow(ctx: Ctx, purchaseId: string, input: z.input<typeof returnInput>, q: Queryable = ctx.db, provenance: { candidateId?: string; captureId?: string } = {}) {
  const d = returnInput.parse(input);
  return withTx(q, async (tx) => {
    const p = await loadScoped<Purchase>(tx, ctx.userId, 'purchases', purchaseId, 'write', 'Purchase');
    await requireWorkspaceFeature(tx, p.workspace_id, ctx.userId, 'purchase_protection', ctx.now);
    const id = newId('ret');
    await tx.query(`INSERT INTO return_windows (id, workspace_id, purchase_id, deadline, basis, eligibility_notes) VALUES ($1,$2,$3,$4,$5,$6)`, [id, p.workspace_id, purchaseId, d.deadline, d.basis, d.eligibilityNotes ?? null]);
    await link(tx, { workspaceId: p.workspace_id, fromType: 'return_window', fromId: id, toType: 'purchase', toId: purchaseId, relation: 'return_window_of', provenance: { source: provenance.candidateId ? 'confirmed_extraction' : 'user', ...provenance }, actorId: ctx.userId });
    for (const days of d.remindDaysBefore) {
      await scheduleReminder(tx, { workspaceId: p.workspace_id, userId: ctx.userId, targetType: 'return_window', targetId: id, kind: 'expiry', title: `Last day to return ${days === 0 ? 'is today' : `in ${days} days`}: ${p.product_name}`, note: `Return by ${d.deadline}`, anchorDate: addDays(d.deadline, -days), anchorTime: null, createdBy: ctx.userId });
    }
    await indexRecord(tx, { entityType: 'return_window', entityId: id, workspaceId: p.workspace_id, title: `Return window — ${p.product_name}`, body: [p.merchant, d.eligibilityNotes, 'return refund replacement'].filter(Boolean).join('\n'), occursOn: d.deadline, status: 'open' });
    return { id };
  });
}

export const RETURN_STATUSES = ['open', 'return_requested', 'returned', 'refund_pending', 'refunded', 'closed'] as const;

/**
 * Moving a return to "refund pending" offers a follow-up task linked to the
 * purchase, so waiting on a refund has a date attached to it.
 */
export async function setReturnStatus(ctx: Ctx, returnId: string, status: (typeof RETURN_STATUSES)[number], opts: { refundFollowUpOn?: string; note?: string } = {}) {
  return withTx(ctx.db, async (tx) => {
    const r = await loadScoped<{ workspace_id: string; purchase_id: string; status: string }>(tx, ctx.userId, 'return_windows', returnId, 'write', 'Return window');
    if (!RETURN_STATUSES.includes(status)) throw invalid('Unknown return status.');
    await tx.query('UPDATE return_windows SET status = $2, updated_at = now() WHERE id = $1', [returnId, status]);
    await recordHistory(tx, { workspaceId: r.workspace_id, entityType: 'return_window', entityId: returnId, action: `status:${status}`, changes: { from: r.status, note: opts.note ?? null }, actorId: ctx.userId });
    if (['returned', 'refunded', 'closed'].includes(status)) await cancelRemindersFor(tx, 'return_window', returnId, `return_${status}`);
    let followUpTaskId: string | null = null;
    if (status === 'refund_pending' && opts.refundFollowUpOn) {
      const p = await one<{ product_name: string; merchant: string | null }>(tx, 'SELECT product_name, merchant FROM purchases WHERE id = $1', [r.purchase_id]);
      const t = await createTask(ctx, r.workspace_id, { title: `Check refund for ${p!.product_name}${p!.merchant ? ` (${p!.merchant})` : ''}`, kind: 'refund_follow_up', dueDate: opts.refundFollowUpOn, reminderOffsets: [0], waitingOn: p!.merchant ?? 'Seller' }, tx);
      await link(tx, { workspaceId: r.workspace_id, fromType: 'task', fromId: t.id, toType: 'purchase', toId: r.purchase_id, relation: 'refund_follow_up_for', provenance: { source: 'user' }, actorId: ctx.userId });
      followUpTaskId = t.id;
    }
    await indexRecord(tx, { entityType: 'return_window', entityId: returnId, workspaceId: r.workspace_id, title: `Return window`, body: '', status }).catch(() => undefined);
    return { followUpTaskId };
  });
}

export async function addServiceRecord(ctx: Ctx, purchaseId: string, input: { serviceDate: string; description: string; provider?: string | null; costMinor?: number | null; currency?: string }) {
  if (!isIsoDate(input.serviceDate)) throw invalid('Use a full date.');
  const p = await loadScoped<Purchase>(ctx.db, ctx.userId, 'purchases', purchaseId, 'write', 'Purchase');
  const id = newId('svc');
  await ctx.db.query(`INSERT INTO service_records (id, workspace_id, purchase_id, service_date, description, provider, cost_minor, currency, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    id, p.workspace_id, purchaseId, input.serviceDate, input.description.slice(0, 2000), input.provider ?? null, input.costMinor ?? null, input.currency ?? p.currency, ctx.userId,
  ]);
  await link(ctx.db, { workspaceId: p.workspace_id, fromType: 'service_record', fromId: id, toType: 'purchase', toId: purchaseId, relation: 'service_of', provenance: { source: 'user' }, actorId: ctx.userId });
  return { id };
}

export const CLAIM_CHECKLIST = [
  'Find the receipt or invoice',
  'Note the serial / IMEI number from the product',
  'Write down what is wrong and when it started',
  'Take photos or a short video of the problem',
  'Check the warranty card for where to raise a claim',
  'Record the claim or complaint number you are given',
];

/** Starts a warranty claim: a checklist the user works through. Nothing is filed for them. */
export async function startWarrantyClaim(ctx: Ctx, warrantyId: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const w = await loadScoped<{ workspace_id: string; claim_status: string }>(tx, ctx.userId, 'warranties', warrantyId, 'write', 'Warranty');
    await tx.query(`UPDATE warranties SET claim_status = 'preparing', updated_at = now() WHERE id = $1`, [warrantyId]);
    const existing = await tx.query(`SELECT 1 FROM checklist_items WHERE owner_type = 'warranty' AND owner_id = $1 LIMIT 1`, [warrantyId]);
    if (!existing.length) {
      let i = 0;
      for (const label of CLAIM_CHECKLIST) await tx.query(`INSERT INTO checklist_items (id, workspace_id, owner_type, owner_id, label, position) VALUES ($1,$2,'warranty',$3,$4,$5)`, [newId('chk'), w.workspace_id, warrantyId, label, ++i]);
    }
    await recordHistory(tx, { workspaceId: w.workspace_id, entityType: 'warranty', entityId: warrantyId, action: 'claim_started', actorId: ctx.userId });
  });
}

export async function setClaimStatus(ctx: Ctx, warrantyId: string, status: 'none' | 'preparing' | 'submitted' | 'resolved') {
  const w = await loadScoped<{ workspace_id: string }>(ctx.db, ctx.userId, 'warranties', warrantyId, 'write', 'Warranty');
  await ctx.db.query('UPDATE warranties SET claim_status = $2, updated_at = now() WHERE id = $1', [warrantyId, status]);
  await recordHistory(ctx.db, { workspaceId: w.workspace_id, entityType: 'warranty', entityId: warrantyId, action: `claim:${status}`, actorId: ctx.userId });
}

export async function listPurchases(ctx: Ctx, opts: { search?: string } = {}) {
  const tz = (await ctx.db.query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [ctx.userId]))[0]!.timezone;
  return ctx.db.query(
    `SELECT p.*, w.id AS warranty_id, w.ends_on AS warranty_ends_on, w.claim_status, r.id AS return_id, r.deadline AS return_deadline, r.status AS return_status,
            (w.ends_on IS NOT NULL AND w.ends_on < $3::date) AS warranty_expired,
            (r.id IS NOT NULL AND r.status = 'open' AND r.deadline < $3::date) AS return_lapsed
       FROM purchases p JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = $1 AND m.role <> 'limited'
       LEFT JOIN LATERAL (SELECT * FROM warranties WHERE purchase_id = p.id ORDER BY ends_on DESC LIMIT 1) w ON true
       LEFT JOIN LATERAL (SELECT * FROM return_windows WHERE purchase_id = p.id ORDER BY deadline DESC LIMIT 1) r ON true
      WHERE ($2::text IS NULL OR p.product_name ILIKE '%' || $2 || '%' OR p.merchant ILIKE '%' || $2 || '%')
      ORDER BY p.purchase_date DESC NULLS LAST, p.created_at DESC`,
    [ctx.userId, opts.search ?? null, todayIn(tz, ctx.now)],
  );
}

export async function purchaseDetail(ctx: Ctx, id: string) {
  const p = await loadScoped<Purchase>(ctx.db, ctx.userId, 'purchases', id, 'read', 'Purchase');
  const [warranties, returns, services] = await Promise.all([
    ctx.db.query('SELECT * FROM warranties WHERE purchase_id = $1 ORDER BY ends_on', [id]),
    ctx.db.query('SELECT * FROM return_windows WHERE purchase_id = $1 ORDER BY deadline', [id]),
    ctx.db.query('SELECT * FROM service_records WHERE purchase_id = $1 ORDER BY service_date DESC', [id]),
  ]);
  return { purchase: p, warranties, returns, services };
}

export async function deletePurchase(ctx: Ctx, id: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const p = await loadScoped<Purchase>(tx, ctx.userId, 'purchases', id, 'write', 'Purchase');
    for (const w of await tx.query<{ id: string }>('SELECT id FROM warranties WHERE purchase_id = $1', [id])) await cancelRemindersFor(tx, 'warranty', w.id, 'purchase_deleted');
    for (const r of await tx.query<{ id: string }>('SELECT id FROM return_windows WHERE purchase_id = $1', [id])) await cancelRemindersFor(tx, 'return_window', r.id, 'purchase_deleted');
    await tx.query(`DELETE FROM search_index WHERE (entity_type = 'purchase' AND entity_id = $1) OR (entity_type IN ('warranty','return_window') AND entity_id IN (SELECT id FROM warranties WHERE purchase_id = $1 UNION SELECT id FROM return_windows WHERE purchase_id = $1))`, [id]);
    await tx.query(`DELETE FROM life_links WHERE (to_type = 'purchase' AND to_id = $1) OR (from_type = 'purchase' AND from_id = $1)`, [id]);
    await tx.query('DELETE FROM purchases WHERE id = $1', [id]);
    await audit(tx, { actorId: ctx.userId, workspaceId: p.workspace_id, action: 'purchase.deleted', entityType: 'purchase', entityId: id });
  });
}

export function todayFor(tz: string, now: Date) {
  return todayIn(tz, now);
}

export { notFound };

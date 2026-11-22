/**
 * Plans, entitlements and usage metering — all enforced on the server.
 *
 * Prices are hypotheses (see docs/BILLING.md) and every allowance is
 * configurable with LIFEOS_PLANS_JSON. Basic tasks, reminders, calendar,
 * capture, search and export are never paywalled.
 */
import { createHmac } from 'node:crypto';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import { invalid, notFound, planRequired, quotaExceeded } from './errors.ts';
import { newId } from './ids.ts';
import { audit } from './audit.ts';
import { safeEqual } from './crypto.ts';
import type { Q } from './context.ts';

export type PlanId = 'free' | 'plus' | 'family';
export type Feature = 'lifegraph' | 'purchase_protection' | 'lifeadmin' | 'automations' | 'followthrough_ai' | 'family';
export type Metric = 'extractions' | 'storage_bytes' | 'assistant_queries';

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthlyInr: number;
  priceYearlyInr: number;
  features: Feature[];
  limits: { extractions: number; storage_bytes: number; assistant_queries: number; automations: number; family_workspaces: number; family_members: number };
}

const GB = 1024 ** 3;
const DEFAULT_PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free', name: 'Free', priceMonthlyInr: 0, priceYearlyInr: 0, features: [],
    limits: { extractions: 30, storage_bytes: 0.5 * GB, assistant_queries: 200, automations: 0, family_workspaces: 0, family_members: 0 },
  },
  plus: {
    id: 'plus', name: 'Plus', priceMonthlyInr: 149, priceYearlyInr: 1490,
    features: ['lifegraph', 'purchase_protection', 'lifeadmin', 'automations', 'followthrough_ai'],
    limits: { extractions: 500, storage_bytes: 10 * GB, assistant_queries: 2000, automations: 25, family_workspaces: 0, family_members: 0 },
  },
  family: {
    id: 'family', name: 'Family', priceMonthlyInr: 299, priceYearlyInr: 2990,
    features: ['lifegraph', 'purchase_protection', 'lifeadmin', 'automations', 'followthrough_ai', 'family'],
    limits: { extractions: 1000, storage_bytes: 50 * GB, assistant_queries: 4000, automations: 50, family_workspaces: 2, family_members: 8 },
  },
};

export function plans(): Record<PlanId, Plan> {
  const raw = process.env.LIFEOS_PLANS_JSON;
  if (!raw) return DEFAULT_PLANS;
  const override = JSON.parse(raw) as Partial<Record<PlanId, Partial<Plan>>>;
  const out = structuredClone(DEFAULT_PLANS);
  for (const id of Object.keys(override) as PlanId[]) {
    const o = override[id]!;
    out[id] = { ...out[id], ...o, limits: { ...out[id].limits, ...(o.limits ?? {}) } };
  }
  return out;
}

export const TRIAL_DAYS = 14;
const PAST_DUE_GRACE_DAYS = 7;

export interface BillingState {
  plan: PlanId;
  /** The plan the stored subscription names, before expiry is applied. */
  subscribedPlan: PlanId;
  status: string;
  provider: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialUsed: boolean;
}

interface BillingRow {
  plan: PlanId; status: string; provider: string; trial_ends_at: Date | null; current_period_end: Date | null; cancel_at_period_end: boolean; trial_used: boolean;
}

export async function ensureBillingRow(q: Queryable, userId: string): Promise<void> {
  await q.query(`INSERT INTO billing_subscriptions (id, user_id, plan, status, provider) VALUES ($1,$2,'free','active','none') ON CONFLICT (user_id) DO NOTHING`, [newId('bil'), userId]);
}

/** The plan in force right now, after trials and periods are checked against `now`. */
export async function billingState(q: Queryable, userId: string, now = new Date()): Promise<BillingState> {
  const row = await one<BillingRow>(q, 'SELECT * FROM billing_subscriptions WHERE user_id = $1', [userId]);
  if (!row) return { plan: 'free', subscribedPlan: 'free', status: 'active', provider: 'none', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, trialUsed: false };
  let effective: PlanId = 'free';
  const t = now.getTime();
  if (row.status === 'trialing' && row.trial_ends_at && new Date(row.trial_ends_at).getTime() > t) effective = row.plan;
  if (row.status === 'active' && (!row.current_period_end || new Date(row.current_period_end).getTime() > t)) effective = row.plan;
  if (row.status === 'past_due' && row.current_period_end && new Date(row.current_period_end).getTime() + PAST_DUE_GRACE_DAYS * 86_400_000 > t) effective = row.plan;
  if (row.plan === 'free') effective = 'free';
  return {
    plan: effective, subscribedPlan: row.plan, status: row.status, provider: row.provider,
    trialEndsAt: row.trial_ends_at, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end, trialUsed: row.trial_used,
  };
}

export async function planOf(q: Queryable, userId: string, now = new Date()): Promise<Plan> {
  return plans()[(await billingState(q, userId, now)).plan];
}

export async function hasFeature(q: Queryable, userId: string, feature: Feature, now = new Date()): Promise<boolean> {
  return (await planOf(q, userId, now)).features.includes(feature);
}

/** Throws plan_required (HTTP 402) unless the user's current plan includes the feature. */
export async function requireFeature(q: Queryable, userId: string, feature: Feature, now = new Date()): Promise<void> {
  if (await hasFeature(q, userId, feature, now)) return;
  throw planRequired(feature, feature === 'family' ? 'Family' : 'Plus');
}

/**
 * For records in a family workspace, the workspace owner's plan decides
 * family features, so invited members do not need their own subscription.
 */
export async function requireWorkspaceFeature(q: Queryable, workspaceId: string, userId: string, feature: Feature, now = new Date()): Promise<void> {
  const ws = await one<{ kind: string; owner_id: string }>(q, 'SELECT kind, owner_id FROM workspaces WHERE id = $1', [workspaceId]);
  if (!ws) throw notFound('Workspace');
  const payer = ws.kind === 'family' ? ws.owner_id : userId;
  if (await hasFeature(q, payer, feature, now)) return;
  if (ws.kind === 'family' && (await hasFeature(q, userId, feature, now))) return;
  throw planRequired(feature, feature === 'family' ? 'Family' : 'Plus');
}

export function period(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Atomically adds `amount` to a usage counter and throws (rolling back the
 * caller's transaction) if that takes it over the plan limit.
 */
export async function consume(q: Q, userId: string, metric: Metric, amount = 1, now = new Date()): Promise<number> {
  return withTx(q, async (tx) => {
    const plan = await planOf(tx, userId, now);
    const limit = plan.limits[metric];
    const p = metric === 'storage_bytes' ? 'lifetime' : period(now);
    const rows = await tx.query<{ count: string }>(
      `INSERT INTO usage_counters (user_id, metric, period, count) VALUES ($1,$2,$3,GREATEST($4, 0))
       ON CONFLICT (user_id, metric, period) DO UPDATE SET count = GREATEST(usage_counters.count + $4, 0) RETURNING count`,
      [userId, metric, p, amount],
    );
    const count = Number(rows[0]!.count);
    if (amount > 0 && count > limit) throw quotaExceeded(metric, limit);
    return count;
  });
}

export async function usage(q: Queryable, userId: string, now = new Date()) {
  const plan = await planOf(q, userId, now);
  const rows = await q.query<{ metric: Metric; count: string }>(
    `SELECT metric, count FROM usage_counters WHERE user_id = $1 AND (period = $2 OR period = 'lifetime')`,
    [userId, period(now)],
  );
  const get = (m: Metric) => Number(rows.find((r) => r.metric === m)?.count ?? 0);
  return (['extractions', 'storage_bytes', 'assistant_queries'] as Metric[]).map((m) => ({ metric: m, used: get(m), limit: plan.limits[m] }));
}

// ------------------------------------------------------------------ lifecycle

/** Starts a no-card trial once per account. No payment is taken or implied. */
export async function startTrial(q: Q, userId: string, plan: 'plus' | 'family', now = new Date()): Promise<BillingState> {
  return withTx(q, async (tx) => {
    await ensureBillingRow(tx, userId);
    const row = await one<BillingRow>(tx, 'SELECT * FROM billing_subscriptions WHERE user_id = $1 FOR UPDATE', [userId]);
    if (row!.trial_used) throw invalid('The free trial has already been used on this account.');
    if (row!.status === 'active' && row!.plan !== 'free') throw invalid('You already have an active plan.');
    const ends = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    await tx.query(
      `UPDATE billing_subscriptions SET plan = $2, status = 'trialing', provider = 'none', trial_ends_at = $3, trial_used = true, cancel_at_period_end = false, updated_at = $4 WHERE user_id = $1`,
      [userId, plan, ends, now],
    );
    await audit(tx, { actorId: userId, action: 'billing.trial_started', meta: { plan, days: TRIAL_DAYS } });
    return billingState(tx, userId, now);
  });
}

/**
 * Cancels. A trial ends immediately; a paid period runs to its end. Personal
 * records are never deleted by a plan change — gated features become read-only.
 */
export async function cancelPlan(q: Q, userId: string, now = new Date()): Promise<BillingState> {
  return withTx(q, async (tx) => {
    const row = await one<BillingRow>(tx, 'SELECT * FROM billing_subscriptions WHERE user_id = $1', [userId]);
    if (!row || row.plan === 'free') throw invalid('There is no paid plan or trial to cancel.');
    if (row.status === 'trialing' || row.provider !== 'razorpay') {
      await tx.query(`UPDATE billing_subscriptions SET plan = 'free', status = 'cancelled', updated_at = $2 WHERE user_id = $1`, [userId, now]);
    } else {
      // Razorpay cancellation at period end must be requested from Razorpay; the
      // webhook then confirms it. Until confirmed we only record the intent.
      await tx.query(`UPDATE billing_subscriptions SET cancel_at_period_end = true, updated_at = $2 WHERE user_id = $1`, [userId, now]);
    }
    await audit(tx, { actorId: userId, action: 'billing.cancelled', meta: { from: row.plan, status: row.status } });
    return billingState(tx, userId, now);
  });
}

/** Development/testing only: set a plan directly to exercise entitlement paths. */
export async function devSetPlan(q: Queryable, userId: string, plan: PlanId, now = new Date()): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.LIFEOS_ENABLE_DEV_BILLING !== '1') throw invalid('Development billing is disabled.');
  await ensureBillingRow(q, userId);
  await q.query(
    `UPDATE billing_subscriptions SET plan = $2, status = 'active', provider = 'development', current_period_end = $3, updated_at = now() WHERE user_id = $1`,
    [userId, plan, plan === 'free' ? null : new Date(now.getTime() + 30 * 86_400_000)],
  );
  await audit(q, { actorId: userId, action: 'billing.dev_plan_set', meta: { plan } });
}

// ------------------------------------------------------------------ Razorpay webhooks

/** Razorpay signs the raw request body with HMAC-SHA256 using the webhook secret. */
export function verifyRazorpaySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

interface RazorpayEvent {
  event: string;
  payload?: { subscription?: { entity?: { id?: string; status?: string; current_end?: number; plan_id?: string; notes?: Record<string, string> } } };
}

/**
 * Applies a verified Razorpay webhook. Idempotent on the event id. Only a
 * signed event can activate a plan; nothing in this codebase marks a payment
 * successful on its own.
 */
export async function handleRazorpayWebhook(
  q: Q,
  input: { rawBody: string; signature: string; eventId: string; secret: string },
): Promise<{ outcome: 'applied' | 'duplicate' | 'ignored' | 'rejected'; reason?: string }> {
  if (!verifyRazorpaySignature(input.rawBody, input.signature, input.secret)) return { outcome: 'rejected', reason: 'bad_signature' };
  let evt: RazorpayEvent;
  try {
    evt = JSON.parse(input.rawBody) as RazorpayEvent;
  } catch {
    return { outcome: 'rejected', reason: 'bad_json' };
  }
  return withTx(q, async (tx) => {
    const sub = evt.payload?.subscription?.entity;
    const userId = sub?.notes?.lifeos_user_id ?? null;
    const plan = (sub?.notes?.lifeos_plan ?? null) as PlanId | null;
    const inserted = await tx.query(
      `INSERT INTO payment_events (id, provider, provider_event_id, event_type, user_id, payload, outcome)
       VALUES ($1,'razorpay',$2,$3,(SELECT id FROM users WHERE id = $4),$5,'received') ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
      [newId('pev'), input.eventId, evt.event, userId, input.rawBody],
    );
    if (inserted.length === 0) return { outcome: 'duplicate' as const };
    const eventRowId = (inserted[0] as { id: string }).id;
    const finish = async (outcome: string) => tx.query('UPDATE payment_events SET outcome = $2 WHERE id = $1', [eventRowId, outcome]);
    if (!userId || !sub?.id || !plan || !['plus', 'family'].includes(plan)) {
      await finish('ignored_unmapped');
      return { outcome: 'ignored' as const, reason: 'unmapped' };
    }
    await ensureBillingRow(tx, userId);
    const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : null;
    const statusByEvent: Record<string, string> = {
      'subscription.activated': 'active', 'subscription.charged': 'active', 'subscription.resumed': 'active',
      'subscription.pending': 'past_due', 'subscription.halted': 'past_due', 'subscription.cancelled': 'cancelled', 'subscription.completed': 'expired',
    };
    const status = statusByEvent[evt.event];
    if (!status) {
      await finish('ignored_event');
      return { outcome: 'ignored' as const, reason: 'event' };
    }
    await tx.query(
      `UPDATE billing_subscriptions SET plan = $2, status = $3, provider = 'razorpay', provider_subscription_id = $4,
              current_period_end = COALESCE($5, current_period_end), cancel_at_period_end = ($3 = 'cancelled'), updated_at = now()
        WHERE user_id = $1`,
      [userId, status === 'cancelled' || status === 'expired' ? 'free' : plan, status, sub.id, periodEnd],
    );
    await finish('applied');
    await audit(tx, { actorId: userId, action: 'billing.webhook_applied', meta: { event: evt.event, status } });
    return { outcome: 'applied' as const };
  });
}

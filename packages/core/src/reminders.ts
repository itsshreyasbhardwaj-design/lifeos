/**
 * Reminder Intelligence.
 *
 * Reliability rules, each covered by tests:
 *   - Reminders are rows, not timers: a restart loses nothing.
 *   - Delivery is idempotent per (reminder, channel, moment): retries and two
 *     workers never produce two notifications.
 *   - A reminder whose target was completed or cancelled is cancelled at
 *     delivery time even if the service that closed it forgot to.
 *   - fire_at is recomputed from (anchor date, anchor time, timezone, offset),
 *     so DST and timezone changes keep "09:00" meaning 09:00 local.
 *   - "accepted" (push service took it) is never reported as "seen".
 */
import type { Db, Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import { newId } from './ids.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { inQuietHours, quietHoursEnd, zonedToUtc } from './time.ts';
import { audit } from './audit.ts';
import type { Q } from './context.ts';

export type ReminderTarget =
  | 'task' | 'calendar_event' | 'promise' | 'warranty' | 'return_window' | 'subscription' | 'bill_occurrence' | 'document' | 'admin_workflow' | 'routine' | 'life_event';
export type ReminderKind = 'one_time' | 'advance' | 'due' | 'follow_up' | 'renewal' | 'expiry' | 'routine' | 'shared';

export interface ReminderInput {
  workspaceId: string;
  userId: string;
  targetType: ReminderTarget;
  targetId: string;
  kind: ReminderKind;
  title: string;
  note?: string | null;
  /** Either a fixed instant… */
  fireAt?: Date;
  /** …or a local anchor that is recomputed when the timezone changes. */
  anchorDate?: string;
  anchorTime?: string | null;
  offsetMinutes?: number;
  channels?: ('in_app' | 'web_push')[];
  createdBy: string | null;
}

interface UserTime {
  timezone: string;
  default_reminder_time: string;
}

async function userTime(q: Queryable, userId: string): Promise<UserTime> {
  const u = await one<UserTime>(q, `SELECT timezone, to_char(default_reminder_time, 'HH24:MI') AS default_reminder_time FROM users WHERE id = $1`, [userId]);
  if (!u) throw notFound('User');
  return u;
}

export function computeFireAt(anchorDate: string, anchorTime: string | null, offsetMinutes: number, u: UserTime): Date {
  const base = zonedToUtc(anchorDate, anchorTime ?? u.default_reminder_time, u.timezone);
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

export async function scheduleReminder(q: Queryable, r: ReminderInput): Promise<string | null> {
  let fireAt = r.fireAt;
  if (!fireAt) {
    if (!r.anchorDate) throw invalid('A reminder needs a time.');
    fireAt = computeFireAt(r.anchorDate, r.anchorTime ?? null, r.offsetMinutes ?? 0, await userTime(q, r.userId));
  }
  const id = newId('rem');
  const rows = await q.query<{ id: string }>(
    `INSERT INTO reminders (id, workspace_id, user_id, target_type, target_id, kind, fire_at, anchor_date, anchor_time, offset_minutes, channels, title, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (user_id, target_type, target_id, kind, fire_at) WHERE status = 'scheduled' DO NOTHING RETURNING id`,
    [id, r.workspaceId, r.userId, r.targetType, r.targetId, r.kind, fireAt, r.anchorDate ?? null, r.anchorTime ?? null, r.offsetMinutes ?? 0,
      r.channels ?? ['in_app', 'web_push'], r.title.slice(0, 300), r.note ?? null, r.createdBy],
  );
  return rows[0]?.id ?? null;
}

/** Cancels every still-scheduled reminder for a target. Returns how many. */
export async function cancelRemindersFor(q: Queryable, targetType: ReminderTarget, targetId: string, reason: string): Promise<number> {
  const rows = await q.query(`UPDATE reminders SET status = 'cancelled', cancel_reason = $3, updated_at = now() WHERE target_type = $1 AND target_id = $2 AND status = 'scheduled' RETURNING id`, [targetType, targetId, reason]);
  return rows.length;
}

/** Moves anchored reminders when the user's timezone or default time changes. */
export async function recomputeUserReminders(q: Queryable, userId: string): Promise<number> {
  const u = await userTime(q, userId);
  const rows = await q.query<{ id: string; anchor_date: string; anchor_time: string | null; offset_minutes: number }>(
    `SELECT id, to_char(anchor_date, 'YYYY-MM-DD') AS anchor_date, to_char(anchor_time, 'HH24:MI') AS anchor_time, offset_minutes
       FROM reminders WHERE user_id = $1 AND status = 'scheduled' AND anchor_date IS NOT NULL`,
    [userId],
  );
  for (const r of rows) {
    await q.query('UPDATE reminders SET fire_at = $2, updated_at = now() WHERE id = $1', [r.id, computeFireAt(r.anchor_date, r.anchor_time, r.offset_minutes, u)]);
  }
  return rows.length;
}

async function ownReminder(q: Queryable, userId: string, id: string) {
  const r = await one<{ id: string; user_id: string; status: string; workspace_id: string; target_type: string; target_id: string; kind: string }>(q, 'SELECT * FROM reminders WHERE id = $1', [id]);
  if (!r) throw notFound('Reminder');
  if (r.user_id !== userId) throw forbidden();
  return r;
}

/**
 * Snooze re-arms the same reminder row. It never creates a task or a second
 * reminder, so snoozing cannot duplicate work (invariant 7).
 */
export async function snooze(q: Q, userId: string, id: string, until: Date, now = new Date()): Promise<void> {
  if (until.getTime() <= now.getTime()) throw invalid('Snooze until a time in the future.');
  await withTx(q, async (tx) => {
    const r = await ownReminder(tx, userId, id);
    if (!['scheduled', 'delivered'].includes(r.status)) throw invalid('This reminder can no longer be snoozed.');
    // Make room if an identical reminder already sits at that exact moment.
    await tx.query(`UPDATE reminders SET status = 'cancelled', cancel_reason = 'merged_by_snooze' WHERE user_id = $1 AND target_type = $2 AND target_id = $3 AND kind = $4 AND fire_at = $5 AND status = 'scheduled' AND id <> $6`, [userId, r.target_type, r.target_id, r.kind, until, id]);
    await tx.query(`UPDATE reminders SET status = 'scheduled', fire_at = $2, anchor_date = NULL, snooze_count = snooze_count + 1, delivered_at = NULL, updated_at = now() WHERE id = $1`, [id, until]);
    await audit(tx, { actorId: userId, workspaceId: r.workspace_id, action: 'reminder.snoozed', entityType: 'reminder', entityId: id });
  });
}

export async function dismiss(q: Queryable, userId: string, id: string): Promise<void> {
  const r = await ownReminder(q, userId, id);
  await q.query(`UPDATE reminders SET status = 'dismissed', updated_at = now() WHERE id = $1`, [id]);
  await audit(q, { actorId: userId, workspaceId: r.workspace_id, action: 'reminder.dismissed', entityType: 'reminder', entityId: id });
}

export async function remindersFor(q: Queryable, userId: string, targetType: string, targetId: string) {
  return q.query(`SELECT id, kind, fire_at, status, snooze_count, delivered_at, cancel_reason, channels, quiet_deferred FROM reminders WHERE user_id = $1 AND target_type = $2 AND target_id = $3 ORDER BY fire_at`, [userId, targetType, targetId]);
}

export async function upcomingReminders(q: Queryable, userId: string, from: Date, to: Date) {
  return q.query<{ id: string; title: string; fire_at: Date; target_type: string; target_id: string; kind: string; status: string }>(
    `SELECT id, title, fire_at, target_type, target_id, kind, status FROM reminders WHERE user_id = $1 AND status = 'scheduled' AND fire_at BETWEEN $2 AND $3 ORDER BY fire_at`,
    [userId, from, to],
  );
}

// ------------------------------------------------------------------ delivery

const OPEN_TARGET_SQL: Record<ReminderTarget, string> = {
  task: `SELECT 1 FROM tasks WHERE id = $1 AND status IN ('open','in_progress','waiting')`,
  calendar_event: `SELECT 1 FROM calendar_events WHERE id = $1 AND cancelled_at IS NULL`,
  promise: `SELECT 1 FROM promises WHERE id = $1 AND status = 'open'`,
  warranty: `SELECT 1 FROM warranties WHERE id = $1`,
  return_window: `SELECT 1 FROM return_windows WHERE id = $1 AND status IN ('open','return_requested','refund_pending')`,
  subscription: `SELECT 1 FROM service_subscriptions WHERE id = $1 AND status IN ('trial','active','cancellation_pending')`,
  bill_occurrence: `SELECT 1 FROM bill_occurrences WHERE id = $1 AND status = 'upcoming'`,
  document: `SELECT 1 FROM documents WHERE id = $1`,
  admin_workflow: `SELECT 1 FROM admin_workflows WHERE id = $1 AND status NOT IN ('confirmed_completed','rejected','cancelled')`,
  routine: `SELECT 1 FROM routines WHERE id = $1 AND paused_at IS NULL AND archived_at IS NULL`,
  life_event: `SELECT 1 FROM life_events WHERE id = $1 AND status IN ('planning','in_progress')`,
};

export async function targetIsOpen(q: Queryable, type: ReminderTarget, id: string): Promise<boolean> {
  const sql = OPEN_TARGET_SQL[type];
  return sql ? (await q.query(sql, [id])).length > 0 : false;
}

export const TARGET_LINK: Record<ReminderTarget, (id: string) => string> = {
  task: (id) => `/app/tasks/${id}`,
  calendar_event: (id) => `/app/calendar?event=${id}`,
  promise: (id) => `/app/promises#${id}`,
  warranty: (id) => `/app/purchases?warranty=${id}`,
  return_window: (id) => `/app/purchases?return=${id}`,
  subscription: (id) => `/app/subscriptions#${id}`,
  bill_occurrence: (id) => `/app/bills#${id}`,
  document: (id) => `/app/vault/${id}`,
  admin_workflow: (id) => `/app/admin/${id}`,
  routine: (id) => `/app/routines#${id}`,
  life_event: (id) => `/app/events/${id}`,
};

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}
export type PushSender = (sub: PushSubscriptionRow, msg: PushMessage) => Promise<{ status: number; gone: boolean }>;

export interface DeliveryReport {
  delivered: number;
  cancelled: number;
  deferred: number;
  pushAccepted: number;
  pushFailed: number;
}

/**
 * Delivers every reminder due at `now`. Safe to run concurrently and
 * repeatedly: claiming uses SKIP LOCKED and every write is keyed.
 */
export async function deliverDue(db: Db, now = new Date(), opts: { push?: PushSender; batch?: number } = {}): Promise<DeliveryReport> {
  const report: DeliveryReport = { delivered: 0, cancelled: 0, deferred: 0, pushAccepted: 0, pushFailed: 0 };
  const pushQueue: { attemptId: string; userId: string; msg: PushMessage }[] = [];

  await db.tx(async (q) => {
    const due = await q.query<{ id: string; workspace_id: string; user_id: string; target_type: ReminderTarget; target_id: string; title: string; note: string | null; fire_at: Date; channels: string[]; timezone: string; qs: string | null; qe: string | null }>(
      `SELECT r.id, r.workspace_id, r.user_id, r.target_type, r.target_id, r.title, r.note, r.fire_at, r.channels, u.timezone,
              to_char(u.quiet_hours_start, 'HH24:MI') AS qs, to_char(u.quiet_hours_end, 'HH24:MI') AS qe
         FROM reminders r JOIN users u ON u.id = r.user_id
        WHERE r.status = 'scheduled' AND r.fire_at <= $1
        ORDER BY r.fire_at LIMIT $2 FOR UPDATE OF r SKIP LOCKED`,
      [now, opts.batch ?? 200],
    );
    for (const r of due) {
      if (!(await targetIsOpen(q, r.target_type, r.target_id))) {
        await q.query(`UPDATE reminders SET status = 'cancelled', cancel_reason = 'target_closed', updated_at = now() WHERE id = $1`, [r.id]);
        report.cancelled++;
        continue;
      }
      if (r.qs && r.qe && inQuietHours(now, r.timezone, r.qs, r.qe)) {
        await q.query(`UPDATE reminders SET fire_at = $2, quiet_deferred = true, updated_at = now() WHERE id = $1`, [r.id, quietHoursEnd(now, r.timezone, r.qe)]);
        report.deferred++;
        continue;
      }
      const moment = new Date(r.fire_at).toISOString();
      const link = TARGET_LINK[r.target_type](r.target_id);
      if (r.channels.includes('in_app')) {
        const key = `${r.id}:in_app:${moment}`;
        await q.query(`INSERT INTO notifications (id, user_id, workspace_id, reminder_id, idempotency_key, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING`, [
          newId('ntf'), r.user_id, r.workspace_id, r.id, key, r.title, r.note, link,
        ]);
        await q.query(`INSERT INTO notification_attempts (id, reminder_id, channel, idempotency_key, status) VALUES ($1,$2,'in_app',$3,'delivered') ON CONFLICT (idempotency_key) DO NOTHING`, [newId('nat'), r.id, key]);
      }
      if (r.channels.includes('web_push') && opts.push) {
        const subs = await q.query<{ id: string }>(`SELECT id FROM push_subscriptions WHERE user_id = $1 AND disabled_at IS NULL`, [r.user_id]);
        for (const s of subs) {
          const key = `${r.id}:web_push:${s.id}:${moment}`;
          const ins = await q.query<{ id: string }>(`INSERT INTO notification_attempts (id, reminder_id, channel, push_subscription_id, idempotency_key, status) VALUES ($1,$2,'web_push',$3,$4,'pending') ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [newId('nat'), r.id, s.id, key]);
          if (ins[0]) pushQueue.push({ attemptId: ins[0].id, userId: r.user_id, msg: { title: r.title, body: r.note ?? 'Reminder from LifeOS', url: link, tag: r.id } });
        }
      }
      await q.query(`UPDATE reminders SET status = 'delivered', delivered_at = $2, updated_at = now() WHERE id = $1`, [r.id, now]);
      report.delivered++;
    }
  });

  // Network calls happen after the transaction commits.
  if (opts.push) {
    for (const item of pushQueue) {
      const ok = await sendPushAttempt(db, item.attemptId, item.msg, opts.push);
      if (ok) report.pushAccepted++;
      else report.pushFailed++;
    }
    const retry = await retryFailedPush(db, now, opts.push);
    report.pushAccepted += retry.accepted;
    report.pushFailed += retry.failed;
  }
  return report;
}

async function sendPushAttempt(db: Db, attemptId: string, msg: PushMessage, push: PushSender): Promise<boolean> {
  const row = await one<{ attempt: number; endpoint: string; p256dh: string; auth: string; sub_id: string }>(
    db,
    `SELECT a.attempt, s.endpoint, s.p256dh, s.auth, s.id AS sub_id FROM notification_attempts a
       JOIN push_subscriptions s ON s.id = a.push_subscription_id WHERE a.id = $1 AND s.disabled_at IS NULL`,
    [attemptId],
  );
  if (!row) return false;
  try {
    const res = await push({ id: row.sub_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }, msg);
    if (res.status >= 200 && res.status < 300) {
      await db.query(`UPDATE notification_attempts SET status = 'accepted', error = NULL, updated_at = now() WHERE id = $1`, [attemptId]);
      await db.query(`UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = $1`, [row.sub_id]);
      return true;
    }
    if (res.gone) {
      // 404/410: the browser unsubscribed. Stop using this endpoint.
      await db.query(`UPDATE push_subscriptions SET disabled_at = now() WHERE id = $1`, [row.sub_id]);
      await db.query(`UPDATE notification_attempts SET status = 'suppressed', error = $2, updated_at = now() WHERE id = $1`, [attemptId, `push endpoint gone (${res.status})`]);
      return false;
    }
    throw new Error(`push service returned ${res.status}`);
  } catch (err) {
    const next = row.attempt >= 5 ? null : new Date(Date.now() + 2 ** row.attempt * 60_000);
    await db.query(`UPDATE notification_attempts SET status = 'failed', error = $2, next_retry_at = $3, updated_at = now() WHERE id = $1`, [attemptId, String((err as Error).message).slice(0, 300), next]);
    await db.query(`UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1`, [row.sub_id]);
    return false;
  }
}

async function retryFailedPush(db: Db, now: Date, push: PushSender): Promise<{ accepted: number; failed: number }> {
  const rows = await db.query<{ id: string; title: string; note: string | null; target_type: ReminderTarget; target_id: string; reminder_id: string }>(
    `UPDATE notification_attempts a SET attempt = a.attempt + 1, status = 'pending', updated_at = now()
       FROM reminders r WHERE a.reminder_id = r.id AND a.status = 'failed' AND a.next_retry_at IS NOT NULL AND a.next_retry_at <= $1 AND a.attempt < 5
     RETURNING a.id, r.title, r.note, r.target_type, r.target_id, r.id AS reminder_id`,
    [now],
  );
  let accepted = 0;
  let failed = 0;
  for (const r of rows) {
    const ok = await sendPushAttempt(db, r.id, { title: r.title, body: r.note ?? 'Reminder from LifeOS', url: TARGET_LINK[r.target_type](r.target_id), tag: r.reminder_id }, push);
    if (ok) accepted++;
    else failed++;
  }
  return { accepted, failed };
}

// ------------------------------------------------------------------ in-app notifications

export async function listNotifications(q: Queryable, userId: string, limit = 50) {
  return q.query<{ id: string; title: string; body: string | null; link: string | null; read_at: Date | null; created_at: Date; reminder_id: string | null }>(
    `SELECT id, title, body, link, read_at, created_at, reminder_id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
}

export async function unreadCount(q: Queryable, userId: string): Promise<number> {
  const r = await one<{ n: number }>(q, `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return r?.n ?? 0;
}

export async function markRead(q: Queryable, userId: string, ids: string[] | 'all'): Promise<void> {
  if (ids === 'all') await q.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  else await q.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`, [userId, ids]);
}

/** Diagnostics: the delivery trail of one reminder. */
export async function deliveryTrail(q: Queryable, userId: string, reminderId: string) {
  await ownReminder(q, userId, reminderId);
  return q.query(`SELECT channel, attempt, status, error, next_retry_at, created_at, updated_at FROM notification_attempts WHERE reminder_id = $1 ORDER BY created_at`, [reminderId]);
}

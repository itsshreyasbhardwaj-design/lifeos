/**
 * User ownership: export, deletion, consent, and analytics that never carry
 * content. Retention rules are in docs/PRIVACY.md and implemented here.
 */
import { z } from 'zod';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { invalid, unauthorized } from './errors.ts';
import { newId } from './ids.ts';
import { audit } from './audit.ts';
import { hmac, verifyPassword } from './crypto.ts';
import { blobStore } from './storage.ts';
import { zip } from './zip.ts';

export const CONSENT_PURPOSES = ['product_analytics', 'external_ai_processing', 'email_notifications', 'push_notifications'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export async function setConsent(q: Queryable, userId: string, purpose: ConsentPurpose, granted: boolean): Promise<void> {
  if (!CONSENT_PURPOSES.includes(purpose)) throw invalid('Unknown purpose.');
  await q.query(`INSERT INTO user_consents (user_id, purpose, granted, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (user_id, purpose) DO UPDATE SET granted = EXCLUDED.granted, updated_at = now()`, [userId, purpose, granted]);
  await audit(q, { actorId: userId, action: granted ? 'consent.granted' : 'consent.withdrawn', meta: { purpose } });
}

export async function consents(q: Queryable, userId: string): Promise<Record<ConsentPurpose, boolean>> {
  const rows = await q.query<{ purpose: ConsentPurpose; granted: boolean }>('SELECT purpose, granted FROM user_consents WHERE user_id = $1', [userId]);
  // Everything optional is off until the user turns it on.
  return Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, rows.find((r) => r.purpose === p)?.granted ?? false])) as Record<ConsentPurpose, boolean>;
}

// ------------------------------------------------------------------ analytics

/**
 * Product analytics with an allow-list of event names and property *types*.
 * Free text is impossible to record: every property must be a number, a
 * boolean, or one of a small set of enum strings. Stored under an HMAC of the
 * user id, only when the user consented (invariant 24).
 */
const EVENTS = {
  capture_created: { source: ['text', 'note', 'paste', 'url', 'screenshot', 'image', 'pdf', 'receipt', 'file', 'voice', 'extension', 'share'], files: 'number' },
  candidate_confirmed: { kind: ['task', 'event', 'deadline', 'purchase', 'warranty', 'return_window', 'subscription', 'bill', 'promise', 'document'], edited: 'boolean' },
  candidate_rejected: { kind: ['task', 'event', 'deadline', 'purchase', 'warranty', 'return_window', 'subscription', 'bill', 'promise', 'document'] },
  task_completed: { recurring: 'boolean' },
  reminder_created: {},
  document_retrieved: {},
  search_performed: { results: 'number' },
  trial_started: { plan: ['plus', 'family'] },
  plan_cancelled: {},
  family_task_assigned: {},
  admin_workflow_created: {},
  onboarding_completed: { goals: 'number' },
} as const satisfies Record<string, Record<string, readonly string[] | 'number' | 'boolean'>>;
export type AnalyticsEvent = keyof typeof EVENTS;

export function sanitiseProps(name: AnalyticsEvent, props: Record<string, unknown>): Record<string, string | number | boolean> {
  const schema = EVENTS[name] as Record<string, readonly string[] | 'number' | 'boolean'>;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, rule] of Object.entries(schema)) {
    const v = props[k];
    if (rule === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v);
    else if (rule === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(rule) && typeof v === 'string' && rule.includes(v)) out[k] = v;
  }
  return out;
}

export async function track(q: Queryable, userId: string, name: AnalyticsEvent, props: Record<string, unknown> = {}): Promise<boolean> {
  if (!(name in EVENTS)) return false;
  const c = await one<{ granted: boolean }>(q, `SELECT granted FROM user_consents WHERE user_id = $1 AND purpose = 'product_analytics'`, [userId]);
  if (!c?.granted) return false;
  await q.query('INSERT INTO product_events (subject, name, props) VALUES ($1,$2,$3)', [hmac('analytics', userId), name, JSON.stringify(sanitiseProps(name, props))]);
  return true;
}

/** Aggregate funnel numbers for the operator dashboard. Counts only. */
export async function funnel(q: Queryable, since: Date) {
  return q.query<{ name: string; events: number; subjects: number }>(`SELECT name, count(*)::int AS events, count(DISTINCT subject)::int AS subjects FROM product_events WHERE at >= $1 GROUP BY name ORDER BY name`, [since]);
}

// ------------------------------------------------------------------ feedback

export const feedbackInput = z.object({ kind: z.enum(['bug', 'feature_request', 'confusing', 'extraction_failure', 'notification_problem', 'other']), message: z.string().trim().min(1).max(5000), page: z.string().max(200).nullish() });

export async function submitFeedback(q: Queryable, userId: string | null, input: z.input<typeof feedbackInput>) {
  const d = feedbackInput.parse(input);
  const id = newId('fbk');
  await q.query('INSERT INTO feedback (id, user_id, kind, message, page) VALUES ($1,$2,$3,$4,$5)', [id, userId, d.kind, d.message, d.page ?? null]);
  return { id };
}

// ------------------------------------------------------------------ export

const EXPORT_TABLES: [string, string][] = [
  ['profile', `SELECT id, email, display_name, locale, timezone, date_order, currency, default_reminder_time, quiet_hours_start, quiet_hours_end, onboarding_goals, created_at FROM users WHERE id = $1`],
  ['workspaces', `SELECT w.id, w.kind, w.name, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = $1`],
  ['captures', `SELECT * FROM captures WHERE created_by = $1`],
  ['extraction_candidates', `SELECT e.* FROM extraction_candidates e JOIN captures c ON c.id = e.capture_id WHERE c.created_by = $1`],
  ['tasks', `SELECT * FROM tasks WHERE created_by = $1 OR assignee_id = $1`],
  ['checklist_items', `SELECT ci.* FROM checklist_items ci JOIN workspaces w ON w.id = ci.workspace_id WHERE w.owner_id = $1 AND w.kind = 'personal'`],
  ['promises', `SELECT * FROM promises WHERE created_by = $1`],
  ['calendar_events', `SELECT * FROM calendar_events WHERE created_by = $1`],
  ['reminders', `SELECT * FROM reminders WHERE user_id = $1`],
  ['documents', `SELECT * FROM documents WHERE created_by = $1`],
  ['document_versions', `SELECT v.id, v.document_id, v.version, v.original_name, v.mime_type, v.size_bytes, v.sha256, v.created_at FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.created_by = $1`],
  ['purchases', `SELECT * FROM purchases WHERE created_by = $1`],
  ['warranties', `SELECT w.* FROM warranties w JOIN purchases p ON p.id = w.purchase_id WHERE p.created_by = $1`],
  ['return_windows', `SELECT r.* FROM return_windows r JOIN purchases p ON p.id = r.purchase_id WHERE p.created_by = $1`],
  ['service_records', `SELECT s.* FROM service_records s JOIN purchases p ON p.id = s.purchase_id WHERE p.created_by = $1`],
  ['subscriptions', `SELECT * FROM service_subscriptions WHERE created_by = $1`],
  ['bills', `SELECT * FROM bills WHERE created_by = $1`],
  ['bill_occurrences', `SELECT o.* FROM bill_occurrences o JOIN bills b ON b.id = o.bill_id WHERE b.created_by = $1`],
  ['admin_workflows', `SELECT * FROM admin_workflows WHERE created_by = $1`],
  ['life_events', `SELECT * FROM life_events WHERE created_by = $1`],
  ['routines', `SELECT * FROM routines WHERE created_by = $1`],
  ['routine_occurrences', `SELECT o.* FROM routine_occurrences o JOIN routines r ON r.id = o.routine_id WHERE r.created_by = $1`],
  ['links', `SELECT l.* FROM life_links l WHERE l.created_by = $1`],
  ['memory_preferences', `SELECT * FROM memory_preferences WHERE user_id = $1`],
  ['consents', `SELECT * FROM user_consents WHERE user_id = $1`],
  ['billing', `SELECT plan, interval, status, provider, trial_ends_at, current_period_end, created_at FROM billing_subscriptions WHERE user_id = $1`],
  ['audit_events', `SELECT action, entity_type, entity_id, at FROM audit_events WHERE actor_id = $1 ORDER BY at`],
];

/**
 * Everything the user created, as JSON, plus the original files they
 * uploaded (decrypted). Records in family spaces that others created are not
 * included — they belong to those people.
 */
export async function exportAccount(ctx: Ctx): Promise<Buffer> {
  const entries: { name: string; data: Buffer }[] = [];
  const manifest: Record<string, number> = {};
  for (const [name, sql] of EXPORT_TABLES) {
    const rows = await ctx.db.query(sql, [ctx.userId]);
    manifest[name] = rows.length;
    entries.push({ name: `data/${name}.json`, data: Buffer.from(JSON.stringify(rows, null, 2)) });
  }
  const files = await ctx.db.query<{ id: string; storage_key: string; original_name: string; kind: string }>(
    `SELECT f.id, f.storage_key, f.original_name, 'captures' AS kind FROM capture_files f JOIN captures c ON c.id = f.capture_id WHERE c.created_by = $1
     UNION ALL SELECT v.id, v.storage_key, v.original_name, 'documents' FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.created_by = $1`,
    [ctx.userId],
  );
  let missing = 0;
  for (const f of files) {
    try {
      entries.push({ name: `files/${f.kind}/${f.id}-${f.original_name.replace(/[^\w.\- ]/g, '_')}`, data: await blobStore().get(f.storage_key) });
    } catch {
      missing++;
    }
  }
  entries.unshift({ name: 'README.txt', data: Buffer.from(`LifeOS data export\nCreated: ${ctx.now.toISOString()}\nRecords: ${JSON.stringify(manifest)}\nFiles: ${files.length - missing}${missing ? ` (${missing} could not be read)` : ''}\n\nJSON files contain every record you created. Files are your original uploads, decrypted.\n`) });
  await audit(ctx.db, { actorId: ctx.userId, action: 'privacy.exported', meta: { files: files.length - missing } });
  return zip(entries);
}

/**
 * Account deletion (invariant 16). Immediate and irreversible:
 *  - refused while the user owns a family space that has other members
 *    (they must transfer or delete it first, so nobody else loses data);
 *  - deletes the personal space, everything in it, and every stored file;
 *  - removes the user from family spaces; family records they created stay
 *    for the family with the author cleared;
 *  - audit rows are kept but anonymised (actor id removed).
 */
export async function deleteAccount(ctx: Ctx, password: string, confirmEmail: string): Promise<void> {
  const u = await one<{ email: string; password_hash: string }>(ctx.db, 'SELECT email, password_hash FROM users WHERE id = $1', [ctx.userId]);
  if (!u) throw unauthorized();
  if (u.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) throw invalid('Type your email address exactly to confirm.');
  if (!(await verifyPassword(password, u.password_hash))) throw unauthorized('Password is incorrect.');
  const shared = await ctx.db.query(`SELECT w.name FROM workspaces w WHERE w.owner_id = $1 AND w.kind = 'family' AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.user_id <> $1)`, [ctx.userId]);
  if (shared.length) throw invalid('You own a family space with other members. Delete it or remove them first.', { workspaces: shared });
  const keys = await withTx(ctx.db, async (tx) => {
    const owned = await tx.query<{ id: string }>(`SELECT id FROM workspaces WHERE owner_id = $1`, [ctx.userId]);
    const ids = owned.map((w) => w.id);
    const files = await tx.query<{ storage_key: string }>(
      `SELECT storage_key FROM capture_files WHERE workspace_id = ANY($1) UNION ALL SELECT storage_key FROM document_versions WHERE workspace_id = ANY($1)`, [ids],
    );
    await tx.query('DELETE FROM search_index WHERE workspace_id = ANY($1)', [ids]);
    await tx.query(`UPDATE audit_events SET actor_id = NULL, meta = '{}'::jsonb WHERE actor_id = $1`, [ctx.userId]);
    await tx.query(`UPDATE audit_events SET workspace_id = NULL WHERE workspace_id = ANY($1)`, [ids]);
    await tx.query('DELETE FROM workspaces WHERE id = ANY($1)', [ids]);
    await tx.query('DELETE FROM users WHERE id = $1', [ctx.userId]);
    await audit(tx, { action: 'privacy.account_deleted', meta: { workspaces: ids.length, files: files.length } });
    return files.map((f) => f.storage_key);
  });
  for (const k of keys) await blobStore().delete(k).catch(() => undefined);
}

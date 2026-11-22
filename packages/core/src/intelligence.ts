/**
 * Life AI, FollowThrough suggestions, the Life Agent automation builder and
 * the Life Brief.
 *
 * Everything here is deterministic and local. Answers are assembled from the
 * user's own authorised records and always list those records as sources; if
 * nothing matches, the answer says so. Proposals are only proposals: nothing
 * runs until the user approves, every payload is re-validated at approval
 * time, and no proposal can reach outside LifeOS (no email, payments, forms).
 */
import { z } from 'zod';
import { type IsoDate, addDays, addMonths, describeDate, findDates, parseIso, toIso, weekday } from '@lifeos/extract';
import type { Db, Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { audit } from './audit.ts';
import { requireRole } from './access.ts';
import { consume, hasFeature, planOf, requireFeature } from './billing.ts';
import { search, LINKS } from './search.ts';
import { createTask, deleteTask } from './tasks.ts';
import { addChecklistItems } from './tasks.ts';
import { scheduleReminder } from './reminders.ts';
import { todayIn } from './time.ts';

async function tzOf(q: Queryable, userId: string) {
  return (await one<{ timezone: string; locale: string }>(q, 'SELECT timezone, locale FROM users WHERE id = $1', [userId]))!;
}

export interface Source {
  type: string;
  id: string;
  title: string;
  date: string | null;
  link: string;
  detail?: string | null;
}

export interface Answer {
  question: string;
  intent: string;
  answer: string;
  sources: Source[];
  range: { from: IsoDate; to: IsoDate } | null;
  uncertainty: string | null;
}

// ------------------------------------------------------------------ question answering

function rangeFrom(question: string, today: IsoDate): { from: IsoDate; to: IsoDate; label: string } | null {
  const q = question.toLowerCase();
  if (/\btoday\b/.test(q)) return { from: today, to: today, label: 'today' };
  if (/\btomorrow\b/.test(q)) return { from: addDays(today, 1), to: addDays(today, 1), label: 'tomorrow' };
  if (/\bthis week\b/.test(q)) return { from: today, to: addDays(today, 6 - weekday(today)), label: 'this week' };
  if (/\bnext week\b/.test(q)) {
    const s = addDays(today, 7 - weekday(today));
    return { from: s, to: addDays(s, 6), label: 'next week' };
  }
  if (/\bthis month\b/.test(q)) {
    const { y, m } = parseIso(today);
    return { from: today, to: addDays(toIso(y, m, 1), 0) === today ? addDays(addMonths(toIso(y, m, 1), 1), -1) : addDays(addMonths(toIso(y, m, 1), 1), -1), label: 'this month' };
  }
  if (/\bnext month\b/.test(q)) {
    const { y, m } = parseIso(today);
    const first = addMonths(toIso(y, m, 1), 1);
    return { from: first, to: addDays(addMonths(first, 1), -1), label: 'next month' };
  }
  if (/\b(soon|coming up|upcoming)\b/.test(q)) return { from: today, to: addDays(today, 60), label: 'in the next 60 days' };
  const d = findDates(question, { today })[0];
  if (d && d.date.y && d.date.m && d.date.d) {
    const iso = toIso(d.date.y, d.date.m, d.date.d);
    return { from: iso, to: iso, label: describeDate(iso) };
  }
  return null;
}

const subjectOf = (question: string, drop: RegExp) =>
  question.toLowerCase().replace(drop, ' ').replace(/\b(where|is|are|my|the|when|does|do|which|what|find|show|me|i|a|an|of|for|expire|expires|expiry|end|ends)\b/g, ' ').replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();

export async function ask(ctx: Ctx, question: string): Promise<Answer> {
  const text = question.trim().slice(0, 500);
  if (!text) throw invalid('Ask a question.');
  await consume(ctx.db, ctx.userId, 'assistant_queries', 1, ctx.now);
  const { timezone } = await tzOf(ctx.db, ctx.userId);
  const today = todayIn(timezone, ctx.now);
  const q = text.toLowerCase();
  const scope = `JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 AND m.role <> 'limited'`;
  const done = (intent: string, answer: string, sources: Source[], range: Answer['range'] = null, uncertainty: string | null = null): Answer => ({ question: text, intent, answer, sources, range, uncertainty });
  const list = (items: Source[], max = 8) => items.slice(0, max).map((s) => `• ${s.title}${s.date ? ` — ${describeDate(s.date)}` : ''}${s.detail ? ` (${s.detail})` : ''}`).join('\n');

  // "What am I waiting for?"
  if (/\bwaiting\b/.test(q)) {
    const rows = await ctx.db.query<{ id: string; description: string; expected_by: string | null; counterparty: string | null; direction: string }>(`SELECT x.id, x.description, x.expected_by, x.counterparty, x.direction FROM promises x ${scope} WHERE x.status = 'open' AND x.direction IN ('waiting_on','they_promised') ORDER BY x.expected_by NULLS LAST`, [ctx.userId]);
    const tasks = await ctx.db.query<{ id: string; title: string; waiting_on: string | null; due_date: string | null }>(`SELECT x.id, x.title, x.waiting_on, x.due_date FROM tasks x ${scope} WHERE x.status = 'waiting'`, [ctx.userId]);
    const sources: Source[] = [
      ...rows.map((r) => ({ type: 'promise', id: r.id, title: r.description, date: r.expected_by, link: LINKS.promise!(r.id), detail: r.counterparty })),
      ...tasks.map((t) => ({ type: 'task', id: t.id, title: t.title, date: t.due_date, link: LINKS.task!(t.id), detail: t.waiting_on ? `waiting on ${t.waiting_on}` : null })),
    ];
    return done('waiting', sources.length ? `You are waiting on ${sources.length} thing${sources.length === 1 ? '' : 's'}:\n${list(sources)}` : 'Nothing in your records is marked as waiting on someone.', sources);
  }

  // "What did I promise?"
  if (/\b(i promised|my promises|did i promise|i owe)\b/.test(q)) {
    const rows = await ctx.db.query<{ id: string; description: string; expected_by: string | null; counterparty: string | null }>(`SELECT x.id, x.description, x.expected_by, x.counterparty FROM promises x ${scope} WHERE x.status = 'open' AND x.direction = 'i_promised' ORDER BY x.expected_by NULLS LAST`, [ctx.userId]);
    const sources = rows.map((r) => ({ type: 'promise', id: r.id, title: r.description, date: r.expected_by, link: LINKS.promise!(r.id), detail: r.counterparty }));
    return done('my_promises', sources.length ? `Open promises you made:\n${list(sources)}` : 'You have no open promises recorded.', sources);
  }

  // Warranties
  if (/\bwarrant/.test(q)) {
    const subject = subjectOf(text, /\bwarrant(y|ies)\b|\bsoon\b|\bexpir\w*\b/g);
    const range = rangeFrom(text, today);
    const rows = await ctx.db.query<{ id: string; ends_on: string; product_name: string; purchase_id: string; basis: string }>(
      `SELECT x.id, x.ends_on, p.product_name, p.id AS purchase_id, x.basis FROM warranties x JOIN purchases p ON p.id = x.purchase_id ${scope}
        WHERE ($2::text = '' OR p.product_name ILIKE '%' || $2 || '%' OR p.merchant ILIKE '%' || $2 || '%' OR p.category ILIKE '%' || $2 || '%')
          AND ($3::date IS NULL OR x.ends_on BETWEEN $3 AND $4) ORDER BY x.ends_on`,
      [ctx.userId, range ? '' : subject, range?.from ?? null, range?.to ?? null],
    );
    const sources = rows.map((r) => ({ type: 'purchase', id: r.purchase_id, title: `${r.product_name} warranty`, date: r.ends_on, link: LINKS.purchase!(r.purchase_id), detail: r.basis === 'document_confirmed' ? 'from your confirmed receipt' : 'entered by you' }));
    if (!sources.length) return done('warranty', range ? `No warranties end ${range.label}.` : `I found no warranty matching “${subject || text}”. If you have the receipt, capture it and confirm the warranty term.`, [], range);
    const first = sources[0]!;
    const answer = sources.length === 1 ? `${first.title.replace(/ warranty$/, '')}’s warranty ends on ${describeDate(first.date!)}${today > first.date! ? ' (already ended)' : ''}.` : `${sources.length} warranties${range ? ` end ${range.label}` : ' match'}:\n${list(sources)}`;
    return done('warranty', answer, sources, range ? { from: range.from, to: range.to } : null, 'Dates come from what you confirmed; check the warranty card for the exact terms.');
  }

  // Refunds / returns
  if (/\b(refund|return)/.test(q)) {
    const rows = await ctx.db.query<{ id: string; status: string; deadline: string; product_name: string; purchase_id: string }>(`SELECT x.id, x.status, x.deadline, p.product_name, p.id AS purchase_id FROM return_windows x JOIN purchases p ON p.id = x.purchase_id ${scope} WHERE x.status IN ('open','return_requested','refund_pending') ORDER BY x.deadline`, [ctx.userId]);
    const tasks = await ctx.db.query<{ id: string; title: string; due_date: string | null }>(`SELECT x.id, x.title, x.due_date FROM tasks x ${scope} WHERE x.kind = 'refund_follow_up' AND x.status IN ('open','in_progress','waiting')`, [ctx.userId]);
    const wantRefund = /refund/.test(q);
    const filtered = wantRefund ? rows.filter((r) => r.status !== 'open') : rows;
    const sources: Source[] = [...filtered.map((r) => ({ type: 'purchase', id: r.purchase_id, title: r.product_name, date: r.deadline, link: LINKS.purchase!(r.purchase_id), detail: r.status.replace(/_/g, ' ') })), ...tasks.map((t) => ({ type: 'task', id: t.id, title: t.title, date: t.due_date, link: LINKS.task!(t.id), detail: 'follow-up' }))];
    return done('refunds', sources.length ? `${wantRefund ? 'Open refunds' : 'Open returns'}:\n${list(sources)}` : wantRefund ? 'No refunds are pending in your records.' : 'No open return windows.', sources);
  }

  // Subscriptions & renewals
  if (/\b(subscription|renew|trial)/.test(q)) {
    const range = rangeFrom(text, today) ?? { from: today, to: addDays(today, 30), label: 'in the next 30 days' };
    const rows = await ctx.db.query<{ id: string; name: string; next_renewal_date: string | null; amount_minor: number | null; currency: string }>(`SELECT x.id, x.name, x.next_renewal_date, x.amount_minor, x.currency FROM service_subscriptions x ${scope} WHERE x.status IN ('active','trial') AND x.next_renewal_date BETWEEN $2 AND $3 ORDER BY x.next_renewal_date`, [ctx.userId, range.from, range.to]);
    const fmt = (a: number | null, c: string) => (a === null ? 'amount not recorded' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: c }).format(a / 100));
    const sources = rows.map((r) => ({ type: 'subscription', id: r.id, title: r.name, date: r.next_renewal_date, link: LINKS.subscription!(r.id), detail: fmt(r.amount_minor, r.currency) }));
    return done('renewals', sources.length ? `${sources.length} subscription${sources.length === 1 ? ' renews' : 's renew'} ${range.label}:\n${list(sources)}` : `No subscriptions renew ${range.label}.`, sources, { from: range.from, to: range.to });
  }

  // Bills
  if (/\bbills?\b/.test(q)) {
    const range = rangeFrom(text, today) ?? { from: today, to: addDays(today, 14), label: 'in the next 14 days' };
    const rows = await ctx.db.query<{ id: string; name: string; due_date: string }>(`SELECT o.id, x.name, o.due_date FROM bill_occurrences o JOIN bills x ON x.id = o.bill_id ${scope} WHERE o.status = 'upcoming' AND o.due_date <= $3 ORDER BY o.due_date`, [ctx.userId, range.from, range.to]);
    const sources = rows.map((r) => ({ type: 'bill', id: r.id, title: r.name, date: r.due_date, link: LINKS.bill!(r.id), detail: r.due_date < today ? 'overdue' : null }));
    return done('bills', sources.length ? `Bills due ${range.label} (and any overdue):\n${list(sources)}` : `No unpaid bills due ${range.label}.`, sources, { from: range.from, to: range.to });
  }

  // Document expiry
  if (/\b(expir|valid)/.test(q) && /\b(document|passport|licen|certificate|policy|insurance)/.test(q)) {
    const range = rangeFrom(text, today) ?? { from: today, to: addDays(today, 90), label: 'in the next 90 days' };
    const rows = await ctx.db.query<{ id: string; title: string; expires_on: string }>(`SELECT x.id, x.title, x.expires_on FROM documents x ${scope} WHERE x.expires_on BETWEEN $2 AND $3 ORDER BY x.expires_on`, [ctx.userId, range.from, range.to]);
    const sources = rows.map((r) => ({ type: 'document', id: r.id, title: r.title, date: r.expires_on, link: LINKS.document!(r.id) }));
    return done('expiries', sources.length ? `Expiring ${range.label}:\n${list(sources)}` : `No documents with an expiry date fall ${range.label}.`, sources, { from: range.from, to: range.to }, 'Only documents where you recorded an expiry date are counted.');
  }

  // Household / family tasks
  if (/\b(household|family|shared)\b/.test(q)) {
    const rows = await ctx.db.query<{ id: string; title: string; due_date: string | null; assignee: string | null }>(`SELECT x.id, x.title, x.due_date, u.display_name AS assignee FROM tasks x JOIN workspaces w ON w.id = x.workspace_id AND w.kind = 'family' JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 LEFT JOIN users u ON u.id = x.assignee_id WHERE x.status IN ('open','in_progress','waiting') AND (m.role <> 'limited' OR x.assignee_id = $1) ORDER BY x.due_date NULLS LAST`, [ctx.userId]);
    const sources = rows.map((r) => ({ type: 'task', id: r.id, title: r.title, date: r.due_date, link: LINKS.task!(r.id), detail: r.assignee ? `assigned to ${r.assignee}` : 'unassigned' }));
    return done('family_tasks', sources.length ? `Unfinished household tasks:\n${list(sources, 12)}` : 'No unfinished tasks in your family spaces.', sources);
  }

  // "What do I need to do tomorrow?"
  if (/\b(do|need to|have to|agenda|plan|schedule|due)\b/.test(q) && rangeFrom(text, today)) {
    const range = rangeFrom(text, today)!;
    const { agenda } = await import('./calendar.ts');
    const items = await agenda(ctx, range.from, range.to);
    const overdue = range.from === today ? await ctx.db.query<{ id: string; title: string; due_date: string }>(`SELECT x.id, x.title, x.due_date FROM tasks x ${scope} WHERE x.status IN ('open','in_progress','waiting') AND x.due_date < $2 ORDER BY x.due_date`, [ctx.userId, today]) : [];
    const sources: Source[] = [
      ...items.filter((i) => i.status !== 'completed').map((i) => ({ type: i.type === 'event' ? 'calendar_event' : i.type, id: i.id, title: i.title, date: i.date, link: i.link, detail: i.startsAt ? new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: timezone }).format(new Date(i.startsAt)) : null })),
      ...overdue.map((t) => ({ type: 'task', id: t.id, title: t.title, date: t.due_date, link: LINKS.task!(t.id), detail: 'overdue' })),
    ];
    return done('agenda', sources.length ? `For ${range.label}:\n${list(sources, 15)}` : `Nothing is scheduled or due ${range.label}.`, sources, { from: range.from, to: range.to });
  }

  // Fallback: search. "Where is my laptop receipt?" lands here.
  const wantsDoc = /\b(receipt|invoice|bill|document|certificate|confirmation|ticket|copy)\b/.test(q);
  const hits = await search(ctx, text, wantsDoc ? { types: ['document', 'purchase', 'capture'] } : {});
  const sources = hits.slice(0, 8).map((h) => ({ type: h.type, id: h.id, title: h.title, date: h.occursOn, link: h.link, detail: h.type.replace(/_/g, ' ') }));
  if (!sources.length) return done('search', 'I couldn’t find anything in your records that matches. Try different words, or capture the item if it isn’t saved yet.', []);
  return done('search', `Closest matches in your records:\n${list(sources)}`, sources, null, 'These are keyword matches, ranked by relevance — not a confirmed answer.');
}

// ------------------------------------------------------------------ proposals

const taskPayload = z.object({ workspaceId: z.string(), title: z.string().min(1).max(500), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), kind: z.enum(['task', 'follow_up', 'refund_follow_up', 'warranty_claim']).default('task'), link: z.object({ type: z.string(), id: z.string() }).nullable().default(null) });
const reminderPayload = z.object({ workspaceId: z.string(), targetType: z.enum(['task', 'promise', 'warranty', 'return_window', 'subscription', 'document', 'bill_occurrence']), targetId: z.string(), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().min(1).max(300) });
const checklistPayload = z.object({ workspaceId: z.string(), title: z.string().min(1).max(300), items: z.array(z.string().min(1).max(300)).min(1).max(30), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });
const draftPayload = z.object({ to: z.string().max(200), subject: z.string().max(300), body: z.string().max(5000) });

const PAYLOADS = { create_task: taskPayload, create_reminder: reminderPayload, create_checklist: checklistPayload, draft_message: draftPayload } as const;
type Kind = keyof typeof PAYLOADS;

async function propose(q: Queryable, p: { workspaceId: string; userId: string; ruleId?: string | null; origin: 'automation' | 'assistant'; kind: Kind; title: string; explanation: string; payload: unknown; evidence: Source[]; dedupeKey: string }) {
  // Validated on the way in, and again at approval (the payload is stored data).
  PAYLOADS[p.kind].parse(p.payload);
  const rows = await q.query<{ id: string }>(
    `INSERT INTO action_proposals (id, workspace_id, user_id, rule_id, origin, kind, title, explanation, payload, evidence, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [newId('prp'), p.workspaceId, p.userId, p.ruleId ?? null, p.origin, p.kind, p.title.slice(0, 300), p.explanation.slice(0, 1000), JSON.stringify(p.payload), JSON.stringify(p.evidence), p.dedupeKey],
  );
  return rows[0]?.id ?? null;
}

/**
 * FollowThrough suggestions: next steps derived from dated facts the user
 * already confirmed. Each is a pending proposal with its evidence attached.
 */
export async function suggestNextActions(ctx: Ctx): Promise<number> {
  if (!(await hasFeature(ctx.db, ctx.userId, 'followthrough_ai', ctx.now))) return 0;
  const { timezone } = await tzOf(ctx.db, ctx.userId);
  const today = todayIn(timezone, ctx.now);
  const scope = `JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 AND m.role IN ('owner','adult','member')`;
  let n = 0;
  const overdue = await ctx.db.query<{ id: string; workspace_id: string; description: string; counterparty: string | null; expected_by: string }>(`SELECT x.id, x.workspace_id, x.description, x.counterparty, x.expected_by FROM promises x ${scope} WHERE x.status = 'open' AND x.direction IN ('they_promised','waiting_on') AND x.expected_by < $2`, [ctx.userId, today]);
  for (const p of overdue) {
    if (await propose(ctx.db, { workspaceId: p.workspace_id, userId: ctx.userId, origin: 'assistant', kind: 'create_task', title: `Follow up${p.counterparty ? ` with ${p.counterparty}` : ''}: ${p.description}`, explanation: `This was expected by ${describeDate(p.expected_by)} and is still open.`, payload: { workspaceId: p.workspace_id, title: `Follow up${p.counterparty ? ` with ${p.counterparty}` : ''}: ${p.description}`, dueDate: today, kind: 'follow_up', link: { type: 'promise', id: p.id } }, evidence: [{ type: 'promise', id: p.id, title: p.description, date: p.expected_by, link: LINKS.promise!(p.id) }], dedupeKey: `ft:promise_overdue:${p.id}:${p.expected_by}` })) n++;
  }
  const returns = await ctx.db.query<{ id: string; workspace_id: string; deadline: string; product_name: string; purchase_id: string }>(`SELECT x.id, x.workspace_id, x.deadline, p.product_name, p.id AS purchase_id FROM return_windows x JOIN purchases p ON p.id = x.purchase_id ${scope} WHERE x.status = 'open' AND x.deadline BETWEEN $2 AND $3`, [ctx.userId, today, addDays(today, 3)]);
  for (const r of returns) {
    if (await propose(ctx.db, { workspaceId: r.workspace_id, userId: ctx.userId, origin: 'assistant', kind: 'create_task', title: `Decide whether to return ${r.product_name}`, explanation: `The return window you confirmed closes on ${describeDate(r.deadline)}.`, payload: { workspaceId: r.workspace_id, title: `Decide whether to return ${r.product_name}`, dueDate: r.deadline, kind: 'task', link: { type: 'purchase', id: r.purchase_id } }, evidence: [{ type: 'purchase', id: r.purchase_id, title: r.product_name, date: r.deadline, link: LINKS.purchase!(r.purchase_id) }], dedupeKey: `ft:return_closing:${r.id}` })) n++;
  }
  const waiting = await ctx.db.query<{ id: string; workspace_id: string; title: string; waiting_on: string | null; waiting_since: string }>(`SELECT x.id, x.workspace_id, x.title, x.waiting_on, x.waiting_since FROM tasks x ${scope} WHERE x.status = 'waiting' AND x.waiting_since <= $2`, [ctx.userId, addDays(today, -7)]);
  for (const t of waiting) {
    if (await propose(ctx.db, { workspaceId: t.workspace_id, userId: ctx.userId, origin: 'assistant', kind: 'create_reminder', title: `Chase ${t.waiting_on ?? 'the other party'}: ${t.title}`, explanation: `You have been waiting since ${describeDate(t.waiting_since)}.`, payload: { workspaceId: t.workspace_id, targetType: 'task', targetId: t.id, on: today, title: `Chase: ${t.title}` }, evidence: [{ type: 'task', id: t.id, title: t.title, date: t.waiting_since, link: LINKS.task!(t.id) }], dedupeKey: `ft:waiting:${t.id}:${t.waiting_since}` })) n++;
  }
  return n;
}

/** A draft the user can copy into their own email. LifeOS never sends it. */
export function draftRefundFollowUp(input: { merchant: string | null; product: string; orderRef: string | null; since: string | null; userName: string }): { to: string; subject: string; body: string } {
  return {
    to: input.merchant ?? 'Customer support',
    subject: `Refund status${input.orderRef ? ` — order ${input.orderRef}` : ''}`,
    body: `Hello,\n\nI returned ${input.product}${input.since ? ` on ${input.since}` : ''}${input.orderRef ? ` (order ${input.orderRef})` : ''} and have not yet received the refund. Could you please confirm its status and the expected date?\n\nThank you,\n${input.userName}`,
  };
}

export async function listProposals(ctx: Ctx, status: 'pending' | 'all' = 'pending') {
  return ctx.db.query(`SELECT * FROM action_proposals WHERE user_id = $1 AND ($2 = 'all' OR status = 'pending') ORDER BY created_at DESC LIMIT 100`, [ctx.userId, status]);
}

/**
 * Approve → validate again → execute inside LifeOS only → record the result
 * with a 24-hour undo window. A stale or tampered payload fails validation and
 * nothing is created.
 */
export async function approveProposal(ctx: Ctx, id: string) {
  return withTx(ctx.db, async (tx) => {
    const p = await one<{ id: string; user_id: string; workspace_id: string; kind: Kind; status: string; payload: unknown; rule_id: string | null }>(tx, 'SELECT * FROM action_proposals WHERE id = $1 FOR UPDATE', [id]);
    if (!p || p.user_id !== ctx.userId) throw notFound('Proposal');
    if (p.status !== 'pending') throw invalid('This proposal was already handled.');
    const parsed = PAYLOADS[p.kind].safeParse(p.payload);
    if (!parsed.success) {
      await tx.query(`UPDATE action_proposals SET status = 'failed', error = $2, decided_at = now() WHERE id = $1`, [id, 'payload failed validation']);
      throw invalid('This proposal is no longer valid.');
    }
    let resultType: string | null = null;
    let resultId: string | null = null;
    if (p.kind === 'create_task') {
      const d = parsed.data as z.infer<typeof taskPayload>;
      if (d.workspaceId !== p.workspace_id) throw forbidden();
      await requireRole(tx, ctx.userId, d.workspaceId, 'write');
      const t = await createTask(ctx, d.workspaceId, { title: d.title, dueDate: d.dueDate, kind: d.kind, reminderOffsets: d.dueDate ? [0] : [] }, tx);
      if (d.link) {
        const { link } = await import('./links.ts');
        await link(tx, { workspaceId: d.workspaceId, fromType: 'task', fromId: t.id, toType: d.link.type as 'promise', toId: d.link.id, relation: 'follow_up_for', provenance: { source: 'user', note: `approved proposal ${id}` }, actorId: ctx.userId });
      }
      resultType = 'task';
      resultId = t.id;
    } else if (p.kind === 'create_reminder') {
      const d = parsed.data as z.infer<typeof reminderPayload>;
      await requireRole(tx, ctx.userId, d.workspaceId, 'write');
      resultId = await scheduleReminder(tx, { workspaceId: d.workspaceId, userId: ctx.userId, targetType: d.targetType, targetId: d.targetId, kind: 'follow_up', title: d.title, anchorDate: d.on, anchorTime: null, createdBy: ctx.userId });
      resultType = 'reminder';
    } else if (p.kind === 'create_checklist') {
      const d = parsed.data as z.infer<typeof checklistPayload>;
      await requireRole(tx, ctx.userId, d.workspaceId, 'write');
      const t = await createTask(ctx, d.workspaceId, { title: d.title, dueDate: d.dueDate, reminderOffsets: d.dueDate ? [0] : [] }, tx);
      await addChecklistItems(ctx, 'task', t.id, d.items.map((label) => ({ label })), tx);
      resultType = 'task';
      resultId = t.id;
    } else {
      resultType = 'draft';
    }
    await tx.query(`UPDATE action_proposals SET status = 'executed', decided_at = now(), executed_at = now(), result_type = $2, result_id = $3, undo_until = now() + interval '24 hours' WHERE id = $1`, [id, resultType, resultId]);
    if (p.rule_id) await tx.query('UPDATE automation_rules SET run_count = run_count + 1, last_run_at = now() WHERE id = $1', [p.rule_id]);
    await audit(tx, { actorId: ctx.userId, workspaceId: p.workspace_id, action: 'proposal.executed', entityType: 'action_proposal', entityId: id, meta: { kind: p.kind } });
    return { resultType, resultId };
  });
}

export async function rejectProposal(ctx: Ctx, id: string) {
  const rows = await ctx.db.query(`UPDATE action_proposals SET status = 'rejected', decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`, [id, ctx.userId]);
  if (!rows.length) throw notFound('Proposal');
}

export async function undoProposal(ctx: Ctx, id: string) {
  const p = await one<{ status: string; result_type: string | null; result_id: string | null; undo_until: Date | null; user_id: string }>(ctx.db, 'SELECT * FROM action_proposals WHERE id = $1', [id]);
  if (!p || p.user_id !== ctx.userId) throw notFound('Proposal');
  if (p.status !== 'executed' || !p.undo_until || new Date(p.undo_until).getTime() < ctx.now.getTime()) throw invalid('This can no longer be undone.');
  if (p.result_type === 'task' && p.result_id) await deleteTask(ctx, p.result_id);
  if (p.result_type === 'reminder' && p.result_id) await ctx.db.query(`UPDATE reminders SET status = 'cancelled', cancel_reason = 'proposal_undone' WHERE id = $1 AND user_id = $2`, [p.result_id, ctx.userId]);
  await ctx.db.query(`UPDATE action_proposals SET status = 'undone' WHERE id = $1`, [id]);
}

// ------------------------------------------------------------------ automation builder

export const ruleInput = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum(['warranty_expiring', 'return_window_closing', 'subscription_renewing', 'trial_ending', 'document_expiring', 'bill_due', 'promise_overdue']),
  conditions: z.object({ daysBefore: z.number().int().min(0).max(365).default(7) }).default({ daysBefore: 7 }),
  action: z.enum(['propose_task', 'propose_reminder', 'propose_checklist']),
  maxRuns: z.number().int().min(1).max(10_000).nullish(),
});

export async function createRule(ctx: Ctx, workspaceId: string, input: z.input<typeof ruleInput>) {
  const d = ruleInput.parse(input);
  await requireRole(ctx.db, ctx.userId, workspaceId, 'write');
  await requireFeature(ctx.db, ctx.userId, 'automations', ctx.now);
  const count = (await one<{ n: number }>(ctx.db, 'SELECT count(*)::int AS n FROM automation_rules WHERE user_id = $1', [ctx.userId]))!.n;
  const limit = (await planOf(ctx.db, ctx.userId, ctx.now)).limits.automations;
  if (count >= limit) throw invalid(`Your plan allows ${limit} automations.`);
  const id = newId('rul');
  await ctx.db.query(`INSERT INTO automation_rules (id, workspace_id, user_id, name, trigger, conditions, action, max_runs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, workspaceId, ctx.userId, d.name, d.trigger, JSON.stringify(d.conditions), d.action, d.maxRuns ?? null]);
  await audit(ctx.db, { actorId: ctx.userId, workspaceId, action: 'automation.created', entityType: 'automation_rule', entityId: id, meta: { trigger: d.trigger, action: d.action } });
  return { id };
}

export async function setRuleEnabled(ctx: Ctx, id: string, enabled: boolean) {
  const rows = await ctx.db.query('UPDATE automation_rules SET enabled = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [id, ctx.userId, enabled]);
  if (!rows.length) throw notFound('Automation');
}

export async function listRules(ctx: Ctx) {
  return ctx.db.query('SELECT * FROM automation_rules WHERE user_id = $1 ORDER BY created_at', [ctx.userId]);
}

const TRIGGER_SQL: Record<string, string> = {
  warranty_expiring: `SELECT x.id, x.workspace_id, 'Warranty ends: ' || p.product_name AS title, x.ends_on::text AS d, 'warranty' AS t, p.id AS link_id, 'purchase' AS link_type FROM warranties x JOIN purchases p ON p.id = x.purchase_id WHERE x.workspace_id = $1 AND x.ends_on = $2::date`,
  return_window_closing: `SELECT x.id, x.workspace_id, 'Return window closes: ' || p.product_name AS title, x.deadline::text AS d, 'return_window' AS t, p.id AS link_id, 'purchase' AS link_type FROM return_windows x JOIN purchases p ON p.id = x.purchase_id WHERE x.workspace_id = $1 AND x.status = 'open' AND x.deadline = $2::date`,
  subscription_renewing: `SELECT x.id, x.workspace_id, 'Renews: ' || x.name AS title, x.next_renewal_date::text AS d, 'subscription' AS t, x.id AS link_id, 'subscription' AS link_type FROM service_subscriptions x WHERE x.workspace_id = $1 AND x.status IN ('active','trial') AND x.next_renewal_date = $2::date`,
  trial_ending: `SELECT x.id, x.workspace_id, 'Trial ends: ' || x.name AS title, x.trial_ends_on::text AS d, 'subscription' AS t, x.id AS link_id, 'subscription' AS link_type FROM service_subscriptions x WHERE x.workspace_id = $1 AND x.status = 'trial' AND x.trial_ends_on = $2::date`,
  document_expiring: `SELECT x.id, x.workspace_id, 'Expires: ' || x.title AS title, x.expires_on::text AS d, 'document' AS t, x.id AS link_id, 'document' AS link_type FROM documents x WHERE x.workspace_id = $1 AND x.expires_on = $2::date`,
  bill_due: `SELECT o.id, o.workspace_id, 'Bill due: ' || b.name AS title, o.due_date::text AS d, 'bill_occurrence' AS t, o.id AS link_id, 'bill' AS link_type FROM bill_occurrences o JOIN bills b ON b.id = o.bill_id WHERE o.workspace_id = $1 AND o.status = 'upcoming' AND o.due_date = $2::date`,
  promise_overdue: `SELECT x.id, x.workspace_id, 'Overdue: ' || x.description AS title, x.expected_by::text AS d, 'promise' AS t, x.id AS link_id, 'promise' AS link_type FROM promises x WHERE x.workspace_id = $1 AND x.status = 'open' AND x.expected_by = $2::date`,
};

/**
 * Evaluates enabled rules for `now`. Matching records become pending
 * proposals; the user approves each. Stop conditions: disabled rules, rules
 * past max_runs, and users whose plan no longer includes automations.
 */
export async function evaluateAutomations(db: Db, now = new Date()): Promise<number> {
  const rules = await db.query<{ id: string; workspace_id: string; user_id: string; name: string; trigger: string; conditions: { daysBefore?: number }; action: string; max_runs: number | null; run_count: number; timezone: string }>(
    `SELECT r.*, u.timezone FROM automation_rules r JOIN users u ON u.id = r.user_id WHERE r.enabled AND (r.max_runs IS NULL OR r.run_count < r.max_runs)`,
  );
  let n = 0;
  for (const r of rules) {
    if (!(await hasFeature(db, r.user_id, 'automations', now))) continue;
    const days = r.conditions.daysBefore ?? 7;
    const today = todayIn(r.timezone, now);
    const target = r.trigger === 'promise_overdue' ? addDays(today, -days) : addDays(today, days);
    const matches = await db.query<{ id: string; workspace_id: string; title: string; d: string; t: string; link_id: string; link_type: string }>(TRIGGER_SQL[r.trigger]!, [r.workspace_id, target]);
    for (const m of matches) {
      const evidence = [{ type: m.link_type, id: m.link_id, title: m.title, date: m.d, link: (LINKS[m.link_type] ?? (() => '/app'))(m.link_id) }];
      const base = { workspaceId: r.workspace_id, userId: r.user_id, ruleId: r.id, origin: 'automation' as const, evidence, dedupeKey: `rule:${r.id}:${m.id}:${m.d}` };
      const explanation = `Your automation “${r.name}” matched: ${m.title} (${describeDate(m.d)}).`;
      let id: string | null = null;
      if (r.action === 'propose_task') id = await propose(db, { ...base, kind: 'create_task', title: m.title, explanation, payload: { workspaceId: r.workspace_id, title: m.title, dueDate: m.d, kind: 'task', link: { type: m.link_type, id: m.link_id } } });
      else if (r.action === 'propose_reminder' && m.t !== 'bill_occurrence') id = await propose(db, { ...base, kind: 'create_reminder', title: `Remind me: ${m.title}`, explanation, payload: { workspaceId: r.workspace_id, targetType: m.t, targetId: m.id, on: today, title: m.title } });
      else if (r.action === 'propose_checklist') id = await propose(db, { ...base, kind: 'create_checklist', title: m.title, explanation, payload: { workspaceId: r.workspace_id, title: m.title, items: ['Find the related document', 'Decide what to do', 'Record the outcome'], dueDate: m.d } });
      if (id) n++;
    }
  }
  return n;
}

// ------------------------------------------------------------------ Life Brief

export async function todayDashboard(ctx: Ctx) {
  const { timezone } = await tzOf(ctx.db, ctx.userId);
  const today = todayIn(timezone, ctx.now);
  const { agenda } = await import('./calendar.ts');
  const [items, overdue, unreviewed, waiting, assigned, proposals] = await Promise.all([
    agenda(ctx, today, today),
    ctx.db.query(`SELECT x.id, x.title, x.due_date, x.priority FROM tasks x JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 WHERE x.status IN ('open','in_progress','waiting') AND x.due_date < $2 AND (m.role <> 'limited' OR x.assignee_id = $1) ORDER BY x.due_date LIMIT 20`, [ctx.userId, today]),
    ctx.db.query(`SELECT x.id, x.title, x.source_type, x.status, x.created_at, (SELECT count(*)::int FROM extraction_candidates e WHERE e.capture_id = x.id AND e.status = 'pending') AS pending FROM captures x JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 AND m.role <> 'limited' WHERE x.status IN ('queued','processing','review_required','extracted','failed') ORDER BY x.created_at DESC LIMIT 10`, [ctx.userId]),
    ctx.db.query(`SELECT x.id, x.description, x.expected_by, x.counterparty, x.direction FROM promises x JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 AND m.role <> 'limited' WHERE x.status = 'open' ORDER BY x.expected_by NULLS LAST LIMIT 10`, [ctx.userId]),
    ctx.db.query(`SELECT x.id, x.title, x.due_date, x.assignment_status, w.name AS workspace_name FROM tasks x JOIN workspaces w ON w.id = x.workspace_id AND w.kind = 'family' WHERE x.assignee_id = $1 AND x.status IN ('open','in_progress','waiting') ORDER BY x.due_date NULLS LAST LIMIT 10`, [ctx.userId]),
    ctx.db.query(`SELECT id, title, explanation, kind, evidence FROM action_proposals WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 5`, [ctx.userId]),
  ]);
  return { today, items, overdue, unreviewed, waiting, assigned, proposals };
}

export interface Brief {
  period: 'daily' | 'weekly' | 'monthly';
  from: IsoDate;
  to: IsoDate;
  sections: { heading: string; items: Source[]; empty: string }[];
}

export async function brief(ctx: Ctx, period: Brief['period']): Promise<Brief> {
  const { timezone } = await tzOf(ctx.db, ctx.userId);
  const today = todayIn(timezone, ctx.now);
  const to = period === 'daily' ? addDays(today, 1) : period === 'weekly' ? addDays(today, 7) : addDays(addMonths(today, 1), -1);
  const { agenda } = await import('./calendar.ts');
  const items = await agenda(ctx, today, to);
  const toSource = (i: Awaited<ReturnType<typeof agenda>>[number]): Source => ({ type: i.type, id: i.id, title: i.title, date: i.date, link: i.link });
  const sections: Brief['sections'] = [];
  const pick = (types: string[]) => items.filter((i) => types.includes(i.type) && i.status !== 'completed').map(toSource);
  sections.push({ heading: period === 'daily' ? 'Today and tomorrow' : 'Coming up', items: pick(['event', 'task', 'life_event']), empty: 'Nothing scheduled.' });
  sections.push({ heading: 'Money commitments', items: pick(['bill', 'renewal', 'trial_end']), empty: 'No bills or renewals in this period.' });
  sections.push({ heading: 'Deadlines and expiries', items: pick(['warranty_end', 'return_deadline', 'document_expiry', 'admin_deadline']), empty: 'Nothing expires in this period.' });
  sections.push({ heading: 'Commitments', items: pick(['promise_due']), empty: 'No promises fall due.' });
  if (period !== 'daily') {
    const important = await ctx.db.query<{ id: string; title: string; due_date: string | null }>(`SELECT x.id, x.title, x.due_date FROM tasks x JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 AND m.role <> 'limited' WHERE x.status IN ('open','in_progress','waiting') AND x.priority >= 2 ORDER BY x.due_date NULLS LAST LIMIT 15`, [ctx.userId]);
    sections.push({ heading: 'Unfinished important tasks', items: important.map((t) => ({ type: 'task', id: t.id, title: t.title, date: t.due_date, link: LINKS.task!(t.id) })), empty: 'No unfinished high-priority tasks.' });
  }
  if (period === 'monthly') {
    const monthStart = `${today.slice(0, 8)}01`;
    const completedAdmin = await ctx.db.query<{ id: string; title: string; confirmed_on: string | null }>(`SELECT x.id, x.title, x.confirmed_on FROM admin_workflows x JOIN memberships m ON m.workspace_id = x.workspace_id AND m.user_id = $1 AND m.role <> 'limited' WHERE x.status = 'confirmed_completed' AND x.updated_at >= $2::date`, [ctx.userId, monthStart]);
    sections.push({ heading: 'Admin you completed this month', items: completedAdmin.map((a) => ({ type: 'admin_workflow', id: a.id, title: a.title, date: a.confirmed_on, link: LINKS.admin_workflow!(a.id) })), empty: 'None recorded yet.' });
  }
  return { period, from: today, to, sections };
}

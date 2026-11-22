import 'server-only';
import { z } from 'zod';
import { parseQuickAdd } from '@lifeos/extract';
import { AppError } from '@lifeos/core/errors';
import { ctxFor, type Ctx } from '@lifeos/core/context';
import * as auth from '@lifeos/core/auth';
import { memberships, personalWorkspaceId, requireRole } from '@lifeos/core/access';
import * as captures from '@lifeos/core/captures';
import * as tasks from '@lifeos/core/tasks';
import * as reminders from '@lifeos/core/reminders';
import * as calendar from '@lifeos/core/calendar';
import * as documents from '@lifeos/core/documents';
import * as purchases from '@lifeos/core/purchases';
import * as commitments from '@lifeos/core/commitments';
import * as promises from '@lifeos/core/promises';
import * as planning from '@lifeos/core/planning';
import * as family from '@lifeos/core/family';
import * as links from '@lifeos/core/links';
import { historyFor } from '@lifeos/core/audit';
import * as searchMod from '@lifeos/core/search';
import * as ai from '@lifeos/core/intelligence';
import * as billing from '@lifeos/core/billing';
import * as privacy from '@lifeos/core/privacy';
import * as push from '@lifeos/core/push';
import * as sync from '@lifeos/core/sync';
import { validateUpload, type ValidatedFile } from '@lifeos/core/files';
import { hit } from '@lifeos/core/ratelimit';
import { sha256, safeEqual } from '@lifeos/core/crypto';
import { tick } from '@lifeos/core/worker';
import { todayIn } from '@lifeos/core/time';
import { one } from '@lifeos/core/db';
import { getDb, ensureWorker } from './runtime';
import { SESSION_COOKIE, WORKSPACE_COOKIE, sessionCookie } from './session';

type Auth = 'none' | 'session' | { token: auth.ApiScope };

interface Req {
  raw: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  ctx: Ctx;
  body: () => Promise<Record<string, unknown>>;
  files: () => Promise<{ fields: Record<string, string>; files: ValidatedFile[] }>;
  ws: () => Promise<string>;
  cookies: Map<string, string>;
  setCookie: (c: { name: string; value: string; httpOnly?: boolean; sameSite?: 'lax' | 'strict'; secure?: boolean; path?: string; expires?: Date; maxAge?: number }) => void;
}

type Handler = (r: Req) => Promise<unknown>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: Auth;
  handler: Handler;
}

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler, a: Auth = 'session') {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, pattern, keys, auth: a, handler });
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

// ------------------------------------------------------------------ auth & me

route('POST', '/auth/register', async (r) => {
  const b = await r.body();
  const db = await getDb();
  const s = await auth.register(db, b as never, { userAgent: r.raw.headers.get('user-agent'), ip: clientIp(r.raw) });
  r.setCookie(sessionCookie(s.token, s.expiresAt));
  return { userId: s.userId };
}, 'none');

route('POST', '/auth/login', async (r) => {
  const b = await r.body();
  const db = await getDb();
  const s = await auth.login(db, { email: String(b.email ?? ''), password: String(b.password ?? '') }, { userAgent: r.raw.headers.get('user-agent'), ip: clientIp(r.raw) });
  r.setCookie(sessionCookie(s.token, s.expiresAt));
  return { mfa: s.mfaPending };
}, 'none');

route('POST', '/auth/mfa', async (r) => {
  const b = await r.body();
  const token = r.cookies.get(SESSION_COOKIE);
  if (!token) throw new AppError('unauthorized', 401, 'Sign in first.');
  await auth.completeMfaLogin(await getDb(), token, String(b.code ?? ''));
  return { ok: true };
}, 'none');

route('POST', '/auth/logout', async (r) => {
  const token = r.cookies.get(SESSION_COOKIE);
  if (token) await auth.logout(await getDb(), token);
  r.setCookie({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return { ok: true };
}, 'none');

route('GET', '/me', async (r) => {
  const [user, spaces, plan, usage] = await Promise.all([auth.getUser(r.ctx.db, r.ctx.userId), memberships(r.ctx.db, r.ctx.userId), billing.billingState(r.ctx.db, r.ctx.userId), billing.usage(r.ctx.db, r.ctx.userId)]);
  return { user, spaces, billing: plan, usage };
}, { token: 'read' });

route('PATCH', '/me', async (r) => {
  const b = await r.body();
  const before = await auth.getUser(r.ctx.db, r.ctx.userId);
  const user = await auth.updatePreferences(r.ctx.db, r.ctx.userId, b as never);
  let moved = 0;
  if (before && (before.timezone !== user.timezone || before.default_reminder_time !== user.default_reminder_time)) moved = await reminders.recomputeUserReminders(r.ctx.db, r.ctx.userId);
  if (b.onboarded) await privacy.track(r.ctx.db, r.ctx.userId, 'onboarding_completed', { goals: user.onboarding_goals.length });
  return { user, remindersMoved: moved };
});
route('POST', '/me/password', async (r) => {
  const b = await r.body();
  const s = await auth.authenticate(r.ctx.db, r.cookies.get(SESSION_COOKIE));
  await auth.changePassword(r.ctx.db, r.ctx.userId, String(b.current ?? ''), String(b.next ?? ''), s?.sessionId ?? null);
  return { ok: true };
});
route('GET', '/me/sessions', async (r) => {
  const current = (await auth.authenticate(r.ctx.db, r.cookies.get(SESSION_COOKIE)))?.sessionId;
  return (await auth.listSessions(r.ctx.db, r.ctx.userId)).map((s) => ({ ...s, current: s.id === current }));
});
route('DELETE', '/me/sessions/:id', async (r) => (await auth.revokeSession(r.ctx.db, r.ctx.userId, r.params.id!), { ok: true }));
route('POST', '/me/mfa/setup', async (r) => auth.beginMfaSetup(r.ctx.db, r.ctx.userId));
route('POST', '/me/mfa/enable', async (r) => (await auth.enableMfa(r.ctx.db, r.ctx.userId, String((await r.body()).code ?? '')), { ok: true }));
route('GET', '/me/tokens', async (r) => auth.listApiTokens(r.ctx.db, r.ctx.userId));
route('POST', '/me/tokens', async (r) => {
  const b = await r.body();
  return auth.createApiToken(r.ctx.db, r.ctx.userId, String(b.name ?? 'Token'), (Array.isArray(b.scopes) ? b.scopes : ['capture:write']) as auth.ApiScope[]);
});
route('DELETE', '/me/tokens/:id', async (r) => (await auth.revokeApiToken(r.ctx.db, r.ctx.userId, r.params.id!), { ok: true }));
route('POST', '/me/workspace', async (r) => {
  const id = String((await r.body()).workspaceId ?? '');
  await requireRole(r.ctx.db, r.ctx.userId, id, 'member');
  r.setCookie({ name: WORKSPACE_COOKIE, value: id, path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  return { ok: true };
});

// ------------------------------------------------------------------ capture & review

route('POST', '/captures', async (r) => {
  await hit(r.ctx.db, `capture:${r.ctx.userId}`, 120, 3600);
  const isMultipart = (r.raw.headers.get('content-type') ?? '').includes('multipart/form-data');
  let fields: Record<string, unknown>;
  let files: ValidatedFile[] = [];
  if (isMultipart) {
    const p = await r.files();
    fields = p.fields;
    files = p.files;
  } else fields = await r.body();
  const ws = str(fields.workspaceId) ?? (await r.ws());
  const res = await captures.createCapture(r.ctx, ws, {
    sourceType: (str(fields.sourceType) as never) ?? 'text', title: str(fields.title) || null, text: str(fields.text) || null, url: str(fields.url) || null,
    sourceDate: str(fields.sourceDate) || null, clientId: str(fields.clientId) || null, sourceApp: str(fields.sourceApp) || null,
    tags: typeof fields.tags === 'string' ? fields.tags.split(',').map((t) => t.trim()).filter(Boolean) : Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
  }, files);
  await privacy.track(r.ctx.db, r.ctx.userId, 'capture_created', { source: res.capture.source_type, files: files.length });
  ensureWorker();
  return { id: res.capture.id, status: res.capture.status, deduplicated: res.deduplicated, similar: res.similar, duplicateFiles: res.duplicateFiles };
}, { token: 'capture:write' });
route('GET', '/captures', async (r) => captures.listCaptures(r.ctx, { status: (r.query.get('status') as never) ?? 'all' }));
route('GET', '/captures/:id', async (r) => captures.getCapture(r.ctx, r.params.id!));
route('POST', '/captures/:id/reprocess', async (r) => (await captures.reprocessCapture(r.ctx, r.params.id!), ensureWorker(), { ok: true }));
route('POST', '/captures/:id/archive', async (r) => (await captures.archiveCapture(r.ctx, r.params.id!, (await r.body()).archived !== false), { ok: true }));
route('DELETE', '/captures/:id', async (r) => captures.deleteCapture(r.ctx, r.params.id!));
route('POST', '/captures/:id/candidates', async (r) => {
  const b = await r.body();
  return { id: await captures.addManualCandidate(r.ctx, r.params.id!, String(b.kind ?? 'task') as never, String(b.title ?? 'Task')) };
});
route('POST', '/candidates/:id/confirm', async (r) => {
  const b = await r.body();
  const res = await captures.confirmCandidate(r.ctx, r.params.id!, b as never);
  await privacy.track(r.ctx.db, r.ctx.userId, 'candidate_confirmed', { kind: res.recordType, edited: Object.keys((b.fields as object) ?? {}).length > 0 });
  return res;
});
route('POST', '/candidates/:id/reject', async (r) => captures.rejectCandidate(r.ctx, r.params.id!, str((await r.body()).reason)));
route('GET', '/files/capture/:id', async (r) => {
  const f = await captures.readCaptureFile(r.ctx, r.params.id!);
  return fileResponse(f.data, f.mimeType, f.name, r.query.get('download') === '1');
});

// ------------------------------------------------------------------ tasks

route('GET', '/tasks', async (r) => tasks.listTasks(r.ctx, { view: (r.query.get('view') as tasks.TaskView) ?? 'all', listId: r.query.get('list') ?? undefined, tag: r.query.get('tag') ?? undefined, search: r.query.get('q') ?? undefined, sort: (r.query.get('sort') as never) ?? undefined }), { token: 'read' });
route('POST', '/tasks', async (r) => {
  const b = await r.body();
  const ws = str(b.workspaceId) ?? (await r.ws());
  let input = b;
  if (typeof b.quick === 'string') {
    const u = (await auth.getUser(r.ctx.db, r.ctx.userId))!;
    const q = parseQuickAdd(b.quick, { today: todayIn(u.timezone), order: u.date_order, locale: u.locale });
    input = { title: q.title, dueDate: q.dueDate, dueTime: q.dueDate ? q.dueTime : null, recurrence: q.recurrence, priority: q.priority, tags: q.tags, reminderOffsets: q.dueDate ? [0] : [], ...(b.overrides as object) };
  }
  const t = await tasks.createTask(r.ctx, ws, input as never);
  if (t.assignee_id && t.assignee_id !== r.ctx.userId) await privacy.track(r.ctx.db, r.ctx.userId, 'family_task_assigned');
  return t;
}, { token: 'tasks:write' });
route('GET', '/tasks/:id', async (r) => {
  const t = await tasks.getTask(r.ctx.db, r.ctx.userId, r.params.id!);
  const [subs, check, deps, rems, related, history, comments] = await Promise.all([
    tasks.subtasks(r.ctx.db, t.id), tasks.checklist(r.ctx.db, r.ctx.userId, 'task', t.id), tasks.dependencies(r.ctx.db, t.id),
    reminders.remindersFor(r.ctx.db, r.ctx.userId, 'task', t.id), links.neighbours(r.ctx.db, r.ctx.userId, 'task', t.id), historyFor(r.ctx.db, 'task', t.id), family.comments(r.ctx, 'task', t.id),
  ]);
  return { task: t, subtasks: subs, checklist: check, dependencies: deps, reminders: rems, links: related, history, comments };
});
route('PATCH', '/tasks/:id', async (r) => tasks.updateTask(r.ctx, r.params.id!, (await r.body()) as never));
route('DELETE', '/tasks/:id', async (r) => (await tasks.deleteTask(r.ctx, r.params.id!), { ok: true }));
route('POST', '/tasks/:id/status', async (r) => {
  const b = await r.body();
  const res = await tasks.setTaskStatus(r.ctx, r.params.id!, { status: b.status as never, note: str(b.note) ?? null, evidence: (b.evidence as never) ?? [] });
  if (b.status === 'completed') await privacy.track(r.ctx.db, r.ctx.userId, 'task_completed', { recurring: Boolean(res.task.series_id) });
  return res;
}, { token: 'tasks:write' });
route('POST', '/tasks/:id/assignment', async (r) => tasks.respondToAssignment(r.ctx, r.params.id!, (await r.body()).accept !== false));
route('POST', '/tasks/:id/dependencies', async (r) => (await tasks.addDependency(r.ctx, r.params.id!, String((await r.body()).dependsOnId ?? '')), { ok: true }));
route('DELETE', '/tasks/:id/dependencies/:dep', async (r) => (await tasks.removeDependency(r.ctx, r.params.id!, r.params.dep!), { ok: true }));
route('POST', '/tasks/bulk', async (r) => {
  const b = await r.body();
  return tasks.bulkTasks(r.ctx, (b.ids as string[]) ?? [], b.action as never);
});
route('POST', '/lists', async (r) => tasks.createList(r.ctx, str((await r.body()).workspaceId) ?? (await r.ws()), String((await r.body()).name ?? 'List')));
route('POST', '/checklists', async (r) => {
  const b = await r.body();
  const items = (Array.isArray(b.items) ? b.items : String(b.items ?? '').split('\n')).map((x: unknown) => (typeof x === 'string' ? { label: x, group: str(b.group) } : (x as { label: string })));
  await tasks.addChecklistItems(r.ctx, b.ownerType as never, String(b.ownerId), items);
  return { ok: true };
});
route('PATCH', '/checklists/:id', async (r) => (await tasks.toggleChecklistItem(r.ctx, r.params.id!, (await r.body()).done === true), { ok: true }));
route('DELETE', '/checklists/:id', async (r) => (await tasks.deleteChecklistItem(r.ctx, r.params.id!), { ok: true }));

// ------------------------------------------------------------------ reminders & notifications

const reminderTargets: Record<string, string> = { task: 'tasks', promise: 'promises', document: 'documents', subscription: 'service_subscriptions', calendar_event: 'calendar_events', admin_workflow: 'admin_workflows', life_event: 'life_events' };
route('POST', '/reminders', async (r) => {
  const b = await r.body();
  const table = reminderTargets[String(b.targetType)];
  if (!table) throw new AppError('invalid', 422, 'Reminders cannot be added to that.');
  const { loadScoped } = await import('@lifeos/core/access');
  const row = await loadScoped<{ workspace_id: string }>(r.ctx.db, r.ctx.userId, table, String(b.targetId), 'read');
  const id = await reminders.scheduleReminder(r.ctx.db, { workspaceId: row.workspace_id, userId: r.ctx.userId, targetType: b.targetType as never, targetId: String(b.targetId), kind: 'one_time', title: String(b.title ?? 'Reminder'), note: str(b.note) ?? null, anchorDate: String(b.on), anchorTime: str(b.time) || null, createdBy: r.ctx.userId });
  await privacy.track(r.ctx.db, r.ctx.userId, 'reminder_created');
  return { id };
});
route('POST', '/reminders/:id/snooze', async (r) => {
  const b = await r.body();
  const until = b.until ? new Date(String(b.until)) : new Date(Date.now() + Number(b.minutes ?? 60) * 60_000);
  await reminders.snooze(r.ctx.db, r.ctx.userId, r.params.id!, until);
  return { until };
});
route('POST', '/reminders/:id/dismiss', async (r) => (await reminders.dismiss(r.ctx.db, r.ctx.userId, r.params.id!), { ok: true }));
route('GET', '/reminders/:id/trail', async (r) => reminders.deliveryTrail(r.ctx.db, r.ctx.userId, r.params.id!));
route('GET', '/notifications', async (r) => ({ items: await reminders.listNotifications(r.ctx.db, r.ctx.userId), unread: await reminders.unreadCount(r.ctx.db, r.ctx.userId) }));
route('POST', '/notifications/read', async (r) => {
  const b = await r.body();
  await reminders.markRead(r.ctx.db, r.ctx.userId, b.ids === 'all' ? 'all' : ((b.ids as string[]) ?? []));
  return { ok: true };
});
route('GET', '/push/key', async () => ({ publicKey: push.vapidKeys().publicKey }));
route('POST', '/push/subscribe', async (r) => {
  const b = await r.body();
  await push.savePushSubscription(r.ctx.db, r.ctx.userId, b as never, r.raw.headers.get('user-agent'));
  await privacy.setConsent(r.ctx.db, r.ctx.userId, 'push_notifications', true);
  return { ok: true };
});
route('POST', '/push/unsubscribe', async (r) => (await push.removePushSubscription(r.ctx.db, r.ctx.userId, String((await r.body()).endpoint ?? '')), { ok: true }));

// ------------------------------------------------------------------ calendar

route('GET', '/calendar', async (r) => calendar.agenda(r.ctx, String(r.query.get('from')), String(r.query.get('to')), { types: r.query.get('types')?.split(',').filter(Boolean) as never }));
route('POST', '/calendar/events', async (r) => {
  const b = await r.body();
  return calendar.createEvent(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('PATCH', '/calendar/events/:id', async (r) => calendar.updateEvent(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/calendar/events/:id/move', async (r) => {
  const b = await r.body();
  return calendar.moveEvent(r.ctx, r.params.id!, { date: String(b.date), startTime: str(b.startTime) ?? null }, typeof b.expectedVersion === 'number' ? b.expectedVersion : undefined);
});
route('DELETE', '/calendar/events/:id', async (r) => (await calendar.cancelEvent(r.ctx, r.params.id!), { ok: true }));
route('POST', '/calendar/import', async (r) => {
  const p = await r.raw.formData();
  const f = p.get('file');
  if (!(f instanceof File)) throw new AppError('invalid', 422, 'Choose an .ics file.');
  return calendar.importIcs(r.ctx, String(p.get('workspaceId') || (await r.ws())), f.name, await f.text());
});
route('GET', '/calendar/export.ics', async (r) => new Response(await calendar.exportIcs(r.ctx), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="lifeos.ics"', 'cache-control': 'no-store' } }));

// ------------------------------------------------------------------ vault

route('GET', '/documents', async (r) => documents.listDocuments(r.ctx, { category: r.query.get('category') ?? undefined, search: r.query.get('q') ?? undefined, expiringWithinDays: r.query.get('expiring') ? Number(r.query.get('expiring')) : undefined }));
route('POST', '/documents', async (r) => {
  const p = await r.files();
  const f = p.fields;
  const res = await documents.createDocument(r.ctx, f.workspaceId || (await r.ws()), {
    title: f.title || p.files[0]?.name || 'Document', category: (f.category as never) || 'other', tags: f.tags ? f.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    issuer: f.issuer || null, issuedOn: f.issuedOn || null, expiresOn: f.expiresOn || null, notes: f.notes || null, isSensitive: f.isSensitive === 'true' || f.isSensitive === 'on',
  }, p.files[0] ?? null);
  ensureWorker();
  return { id: res.doc.id, duplicateOf: res.duplicateOf };
});
route('GET', '/documents/:id', async (r) => {
  const a = await documents.documentAccess(r.ctx.db, r.ctx.userId, r.params.id!);
  const [versions, related] = await Promise.all([documents.versions(r.ctx, a.doc.id), links.neighbours(r.ctx.db, r.ctx.userId, 'document', a.doc.id)]);
  const owner = a.canEdit && !a.viaGrant;
  return { document: a.doc, canEdit: a.canEdit, canDownload: a.canDownload, shared: Boolean(a.viaGrant), versions, links: related, grants: owner ? await documents.grantsFor(r.ctx, a.doc.id).catch(() => []) : [] };
});
route('PATCH', '/documents/:id', async (r) => documents.updateDocument(r.ctx, r.params.id!, (await r.body()) as never));
route('DELETE', '/documents/:id', async (r) => (await documents.deleteDocument(r.ctx, r.params.id!), { ok: true }));
route('POST', '/documents/:id/versions', async (r) => {
  const p = await r.files();
  if (!p.files[0]) throw new AppError('invalid', 422, 'Choose a file.');
  return documents.addVersion(r.ctx, r.params.id!, p.files[0]);
});
route('POST', '/documents/:id/share', async (r) => {
  const b = await r.body();
  return documents.shareDocument(r.ctx, r.params.id!, { granteeUserId: str(b.granteeUserId) || null, granteeWorkspaceId: str(b.granteeWorkspaceId) || null, canDownload: b.canDownload === true, expiresAt: b.expiresAt ? new Date(String(b.expiresAt)) : null });
});
route('DELETE', '/grants/:id', async (r) => (await documents.revokeGrant(r.ctx, r.params.id!), { ok: true }));
route('GET', '/documents/:id/access-log', async (r) => documents.accessLog(r.ctx, r.params.id!));
route('GET', '/files/document/:id', async (r) => {
  const download = r.query.get('download') === '1';
  const f = await documents.readDocumentFile(r.ctx, r.params.id!, { versionId: r.query.get('version') ?? undefined, purpose: download ? 'download' : 'view' });
  if (!download) await privacy.track(r.ctx.db, r.ctx.userId, 'document_retrieved');
  return fileResponse(f.data, f.mimeType, f.name, download);
});

// ------------------------------------------------------------------ purchases

route('GET', '/purchases', async (r) => purchases.listPurchases(r.ctx, { search: r.query.get('q') ?? undefined }));
route('POST', '/purchases', async (r) => {
  const b = await r.body();
  return purchases.createPurchase(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('GET', '/purchases/:id', async (r) => ({ ...(await purchases.purchaseDetail(r.ctx, r.params.id!)), links: await links.neighbours(r.ctx.db, r.ctx.userId, 'purchase', r.params.id!) }));
route('PATCH', '/purchases/:id', async (r) => purchases.updatePurchase(r.ctx, r.params.id!, (await r.body()) as never));
route('DELETE', '/purchases/:id', async (r) => (await purchases.deletePurchase(r.ctx, r.params.id!), { ok: true }));
route('POST', '/purchases/:id/warranty', async (r) => purchases.addWarranty(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/purchases/:id/return', async (r) => purchases.addReturnWindow(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/purchases/:id/service', async (r) => purchases.addServiceRecord(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/purchases/:id/receipt', async (r) => (await purchases.attachReceipt(r.ctx, r.params.id!, String((await r.body()).documentId)), { ok: true }));
route('POST', '/returns/:id/status', async (r) => {
  const b = await r.body();
  return purchases.setReturnStatus(r.ctx, r.params.id!, b.status as never, { refundFollowUpOn: str(b.refundFollowUpOn) || undefined, note: str(b.note) });
});
route('POST', '/warranties/:id/claim', async (r) => (await purchases.startWarrantyClaim(r.ctx, r.params.id!), { ok: true }));
route('POST', '/warranties/:id/claim-status', async (r) => (await purchases.setClaimStatus(r.ctx, r.params.id!, (await r.body()).status as never), { ok: true }));
route('GET', '/purchases/:id/refund-draft', async (r) => {
  const d = await purchases.purchaseDetail(r.ctx, r.params.id!);
  const u = await auth.getUser(r.ctx.db, r.ctx.userId);
  const ret = d.returns[0] as { updated_at?: Date } | undefined;
  return ai.draftRefundFollowUp({ merchant: d.purchase.merchant, product: d.purchase.product_name, orderRef: d.purchase.order_ref, since: ret?.updated_at ? new Date(ret.updated_at).toISOString().slice(0, 10) : null, userName: u!.display_name });
});

// ------------------------------------------------------------------ subscriptions & bills

route('GET', '/subscriptions', async (r) => commitments.listSubscriptions(r.ctx));
route('POST', '/subscriptions', async (r) => {
  const b = await r.body();
  return commitments.createSubscription(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('POST', '/subscriptions/:id/renewed', async (r) => commitments.confirmRenewal(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/subscriptions/:id/cancel-request', async (r) => (await commitments.requestCancellation(r.ctx, r.params.id!), { ok: true }));
route('POST', '/subscriptions/:id/cancelled', async (r) => commitments.confirmCancellation(r.ctx, r.params.id!, (await r.body()) as never));
route('GET', '/subscriptions/:id/history', async (r) => commitments.subscriptionHistory(r.ctx, r.params.id!));
route('GET', '/bills', async (r) => commitments.listBills(r.ctx));
route('POST', '/bills', async (r) => {
  const b = await r.body();
  return commitments.createBill(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('POST', '/bill-occurrences/:id/paid', async (r) => commitments.reportBillPaid(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/bills/:id/cancel', async (r) => (await commitments.cancelBill(r.ctx, r.params.id!), { ok: true }));

// ------------------------------------------------------------------ promises, admin, events, routines

route('GET', '/promises', async (r) => promises.listPromises(r.ctx, { direction: r.query.get('direction') ?? undefined, status: r.query.get('status') ?? undefined }));
route('POST', '/promises', async (r) => {
  const b = await r.body();
  return promises.createPromise(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('POST', '/promises/:id/resolve', async (r) => {
  const b = await r.body();
  return promises.resolvePromise(r.ctx, r.params.id!, b.outcome as never, str(b.note));
});
route('POST', '/promises/:id/reopen', async (r) => promises.reopenPromise(r.ctx, r.params.id!));
route('POST', '/promises/:id/follow-up', async (r) => (await promises.addFollowUp(r.ctx, r.params.id!, String((await r.body()).on)), { ok: true }));

route('GET', '/admin/templates', async () => planning.ADMIN_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, items: t.items.length })));
route('GET', '/admin', async (r) => planning.listWorkflows(r.ctx));
route('POST', '/admin', async (r) => {
  const b = await r.body();
  const res = await planning.createWorkflow(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
  await privacy.track(r.ctx.db, r.ctx.userId, 'admin_workflow_created');
  return res;
});
route('GET', '/admin/:id', async (r) => {
  const { loadScoped } = await import('@lifeos/core/access');
  const w = await loadScoped(r.ctx.db, r.ctx.userId, 'admin_workflows', r.params.id!, 'read', 'Workflow');
  return { workflow: w, checklist: await tasks.checklist(r.ctx.db, r.ctx.userId, 'admin_workflow', r.params.id!), links: await links.neighbours(r.ctx.db, r.ctx.userId, 'admin_workflow', r.params.id!), history: await historyFor(r.ctx.db, 'admin_workflow', r.params.id!) };
});
route('POST', '/admin/:id/status', async (r) => {
  const b = await r.body();
  await planning.setWorkflowStatus(r.ctx, r.params.id!, b.status as never, { note: str(b.note) ?? null, on: str(b.on) ?? null, referenceNumber: str(b.referenceNumber) || null });
  return { ok: true };
});

route('GET', '/events/templates', async () => planning.EVENT_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, items: t.items.length })));
route('GET', '/events', async (r) => planning.listLifeEvents(r.ctx));
route('POST', '/events', async (r) => {
  const b = await r.body();
  return planning.createLifeEvent(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('GET', '/events/:id', async (r) => ({ ...(await planning.lifeEventDetail(r.ctx, r.params.id!)), checklist: await tasks.checklist(r.ctx.db, r.ctx.userId, 'life_event', r.params.id!), links: await links.neighbours(r.ctx.db, r.ctx.userId, 'life_event', r.params.id!) }));
route('POST', '/events/:id/participants', async (r) => planning.addParticipant(r.ctx, r.params.id!, (await r.body()) as never));
route('POST', '/events/:id/status', async (r) => (await planning.setLifeEventStatus(r.ctx, r.params.id!, (await r.body()).status as never), { ok: true }));

route('GET', '/routines', async (r) => planning.routinesOverview(r.ctx, String(r.query.get('from')), String(r.query.get('to'))));
route('POST', '/routines', async (r) => {
  const b = await r.body();
  return planning.createRoutine(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('POST', '/routines/:id/record', async (r) => {
  const b = await r.body();
  await planning.recordRoutine(r.ctx, r.params.id!, String(b.on), b.status as never, str(b.note));
  return { ok: true };
});
route('POST', '/routines/:id/state', async (r) => (await planning.setRoutineState(r.ctx, r.params.id!, (await r.body()).state as never), { ok: true }));

// ------------------------------------------------------------------ family

route('POST', '/family', async (r) => family.createFamily(r.ctx, String((await r.body()).name ?? '')));
route('GET', '/family/:id/members', async (r) => family.members(r.ctx, r.params.id!));
route('POST', '/family/:id/invites', async (r) => {
  const b = await r.body();
  const inv = await family.inviteMember(r.ctx, r.params.id!, String(b.email ?? ''), b.role as never);
  const origin = new URL(r.raw.url).origin;
  return { id: inv.id, link: `${origin}/invite/${inv.token}`, expiresAt: inv.expiresAt };
});
route('DELETE', '/invites/:id', async (r) => (await family.revokeInvitation(r.ctx, r.params.id!), { ok: true }));
route('GET', '/invites/:token', async (r) => {
  const i = await family.invitationInfo(await getDb(), r.params.token!);
  if (!i) throw new AppError('not_found', 404, 'Invitation not found.');
  return { workspace: i.workspace_name, inviter: i.inviter, role: i.role, expiresAt: i.expires_at, used: Boolean(i.accepted_at), revoked: Boolean(i.revoked_at) };
}, 'none');
route('POST', '/invites/accept', async (r) => {
  const res = await family.acceptInvitation(r.ctx, String((await r.body()).token ?? ''));
  r.setCookie({ name: WORKSPACE_COOKIE, value: res.workspaceId, path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  return res;
});
route('PATCH', '/family/:id/members/:user', async (r) => (await family.changeRole(r.ctx, r.params.id!, r.params.user!, (await r.body()).role as never), { ok: true }));
route('DELETE', '/family/:id/members/:user', async (r) => (await family.removeMember(r.ctx, r.params.id!, r.params.user!), { ok: true }));
route('DELETE', '/family/:id', async (r) => (await family.deleteFamily(r.ctx, r.params.id!), { ok: true }));
route('GET', '/family/:id/activity', async (r) => family.familyActivity(r.ctx, r.params.id!));
route('GET', '/shopping', async (r) => family.shoppingLists(r.ctx, r.query.get('workspaceId') ?? undefined));
route('POST', '/shopping', async (r) => {
  const b = await r.body();
  return family.createShoppingList(r.ctx, str(b.workspaceId) ?? (await r.ws()), String(b.name ?? 'Shopping'));
});
route('POST', '/shopping/:id/items', async (r) => {
  const b = await r.body();
  return family.addShoppingItem(r.ctx, r.params.id!, String(b.label ?? ''), str(b.quantity) ?? null);
});
route('PATCH', '/shopping-items/:id', async (r) => (await family.toggleShoppingItem(r.ctx, r.params.id!, (await r.body()).done === true), { ok: true }));
route('POST', '/shopping/:id/clear', async (r) => (await family.clearDoneItems(r.ctx, r.params.id!), { ok: true }));
route('GET', '/comments', async (r) => family.comments(r.ctx, String(r.query.get('entityType')), String(r.query.get('entityId'))));
route('POST', '/comments', async (r) => {
  const b = await r.body();
  return family.addComment(r.ctx, String(b.entityType), String(b.entityId), String(b.body ?? ''));
});

// ------------------------------------------------------------------ lifegraph, search, AI

route('GET', '/graph/:type/:id', async (r) => ({ links: await links.neighbours(r.ctx.db, r.ctx.userId, r.params.type!, r.params.id!), history: await historyFor(r.ctx.db, r.params.type!, r.params.id!) }));
route('GET', '/graph', async (r) => {
  await billing.requireFeature(r.ctx.db, r.ctx.userId, 'lifegraph');
  return links.graph(r.ctx.db, r.ctx.userId, r.query.get('workspaceId') ?? (await r.ws()));
});
route('POST', '/links', async (r) => {
  const b = await r.body();
  const ws = await r.ws();
  return { id: await links.link(r.ctx.db, { workspaceId: str(b.workspaceId) ?? ws, fromType: b.fromType as never, fromId: String(b.fromId), toType: b.toType as never, toId: String(b.toId), relation: (b.relation as never) ?? 'related_to', provenance: { source: 'user' }, actorId: r.ctx.userId }) };
});
route('DELETE', '/links/:id', async (r) => (await links.unlink(r.ctx.db, await r.ws(), r.params.id!, r.ctx.userId), { ok: true }));

route('GET', '/search', async (r) => {
  const q = r.query.get('q') ?? '';
  const hits = await searchMod.search(r.ctx, q, { types: r.query.get('types')?.split(',').filter(Boolean), from: r.query.get('from') ?? undefined, to: r.query.get('to') ?? undefined });
  await privacy.track(r.ctx.db, r.ctx.userId, 'search_performed', { results: hits.length });
  return hits;
}, { token: 'read' });
route('GET', '/saved-searches', async (r) => searchMod.savedSearches(r.ctx));
route('POST', '/saved-searches', async (r) => {
  const b = await r.body();
  return searchMod.saveSearch(r.ctx, String(b.name ?? b.query), String(b.query ?? ''));
});
route('POST', '/ai/ask', async (r) => {
  await hit(r.ctx.db, `ask:${r.ctx.userId}`, 60, 60);
  return ai.ask(r.ctx, String((await r.body()).question ?? ''));
});
route('GET', '/proposals', async (r) => ai.listProposals(r.ctx, (r.query.get('status') as never) ?? 'pending'));
route('POST', '/proposals/suggest', async (r) => ({ created: await ai.suggestNextActions(r.ctx) }));
route('POST', '/proposals/:id/approve', async (r) => ai.approveProposal(r.ctx, r.params.id!));
route('POST', '/proposals/:id/reject', async (r) => (await ai.rejectProposal(r.ctx, r.params.id!), { ok: true }));
route('POST', '/proposals/:id/undo', async (r) => (await ai.undoProposal(r.ctx, r.params.id!), { ok: true }));
route('GET', '/automations', async (r) => ai.listRules(r.ctx));
route('POST', '/automations', async (r) => {
  const b = await r.body();
  return ai.createRule(r.ctx, str(b.workspaceId) ?? (await r.ws()), b as never);
});
route('PATCH', '/automations/:id', async (r) => (await ai.setRuleEnabled(r.ctx, r.params.id!, (await r.body()).enabled === true), { ok: true }));
route('GET', '/brief', async (r) => ai.brief(r.ctx, (r.query.get('period') as never) ?? 'daily'));
route('GET', '/today', async (r) => ai.todayDashboard(r.ctx), { token: 'read' });

// ------------------------------------------------------------------ billing, privacy, sync, ops

route('GET', '/billing', async (r) => ({ state: await billing.billingState(r.ctx.db, r.ctx.userId), usage: await billing.usage(r.ctx.db, r.ctx.userId), plans: billing.plans(), razorpayConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_KEY_ID) }));
route('POST', '/billing/trial', async (r) => {
  const plan = (await r.body()).plan === 'family' ? 'family' : 'plus';
  const s = await billing.startTrial(r.ctx.db, r.ctx.userId, plan);
  await privacy.track(r.ctx.db, r.ctx.userId, 'trial_started', { plan });
  return s;
});
route('POST', '/billing/cancel', async (r) => {
  const s = await billing.cancelPlan(r.ctx.db, r.ctx.userId);
  await privacy.track(r.ctx.db, r.ctx.userId, 'plan_cancelled');
  return s;
});
route('POST', '/billing/dev-plan', async (r) => (await billing.devSetPlan(r.ctx.db, r.ctx.userId, (await r.body()).plan as never), { ok: true }));
route('POST', '/webhooks/razorpay', async (r) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new AppError('unavailable', 503, 'Razorpay is not configured on this server.');
  const raw = await r.raw.text();
  const out = await billing.handleRazorpayWebhook(await getDb(), { rawBody: raw, signature: r.raw.headers.get('x-razorpay-signature') ?? '', eventId: r.raw.headers.get('x-razorpay-event-id') ?? sha256(raw), secret });
  if (out.outcome === 'rejected') throw new AppError('invalid_signature', 400, 'Signature verification failed.');
  return out;
}, 'none');

route('GET', '/privacy/consents', async (r) => privacy.consents(r.ctx.db, r.ctx.userId));
route('PUT', '/privacy/consents', async (r) => {
  const b = await r.body();
  await privacy.setConsent(r.ctx.db, r.ctx.userId, b.purpose as never, b.granted === true);
  return privacy.consents(r.ctx.db, r.ctx.userId);
});
route('GET', '/privacy/export', async (r) => {
  await hit(r.ctx.db, `export:${r.ctx.userId}`, 5, 3600);
  const data = await privacy.exportAccount(r.ctx);
  return new Response(new Uint8Array(data), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="lifeos-export-${new Date().toISOString().slice(0, 10)}.zip"`, 'cache-control': 'no-store' } });
});
route('POST', '/privacy/delete', async (r) => {
  const b = await r.body();
  await privacy.deleteAccount(r.ctx, String(b.password ?? ''), String(b.email ?? ''));
  r.setCookie({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return { ok: true };
});
route('POST', '/feedback', async (r) => privacy.submitFeedback(r.ctx.db, r.ctx.userId, (await r.body()) as never));
route('POST', '/sync', async (r) => sync.syncBatch(r.ctx, ((await r.body()).ops as unknown[]) ?? []));
route('GET', '/sync/conflicts', async (r) => sync.openConflicts(r.ctx));
route('POST', '/sync/conflicts/:id', async (r) => (await sync.resolveConflict(r.ctx, r.params.id!, (await r.body()).keep === 'mine' ? 'mine' : 'server'), { ok: true }));

route('GET', '/health', async () => {
  const db = await getDb();
  await db.query('SELECT 1');
  return { ok: true, database: db.kind, time: new Date().toISOString() };
}, 'none');
route('POST', '/cron/tick', async (r) => {
  const secret = process.env.LIFEOS_CRON_SECRET;
  if (!secret || !safeEqual(r.raw.headers.get('x-cron-secret') ?? '', secret)) throw new AppError('forbidden', 403, 'Forbidden');
  return tick(await getDb(), new Date(), { push: push.webPushSender, forceHourly: true });
}, 'none');

// ------------------------------------------------------------------ dispatcher

function clientIp(req: Request): string | null {
  // Only trust forwarded headers when told to (behind a known proxy).
  if (process.env.LIFEOS_TRUST_PROXY === '1') return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip') ?? 'local';
}

function fileResponse(data: Buffer, mime: string, name: string, download: boolean): Response {
  const safe = name.replace(/[^\w.\- ]/g, '_');
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': mime,
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${safe}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Uploaded files are never allowed to run script, even if they are mislabelled.
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}

function parseCookies(header: string | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) m.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return m;
}

function serialiseCookie(c: Parameters<Req['setCookie']>[0]): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path ?? '/'}`];
  if (c.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${c.sameSite === 'strict' ? 'Strict' : 'Lax'}`);
  if (c.secure) parts.push('Secure');
  if (c.expires) parts.push(`Expires=${c.expires.toUTCString()}`);
  if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`);
  return parts.join('; ');
}

/** Mutating cookie-authenticated requests must come from this origin (CSRF). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

const MAX_JSON = 1_000_000;

export async function dispatch(req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const p = `/${path.join('/')}`;
  const match = routes.find((r) => r.method === req.method && r.pattern.test(p));
  if (!match) {
    const exists = routes.some((r) => r.pattern.test(p));
    return Response.json({ error: { code: exists ? 'method_not_allowed' : 'not_found', message: exists ? 'Method not allowed.' : 'Not found.' } }, { status: exists ? 405 : 404 });
  }
  const m = match.pattern.exec(p)!;
  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
  const cookies = parseCookies(req.headers.get('cookie'));
  const setCookies: string[] = [];
  try {
    const db = await getDb();
    let userId = '';
    let viaToken = false;
    if (match.auth !== 'none') {
      const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (bearer && typeof match.auth === 'object') {
        const u = await auth.authenticateApiToken(db, bearer, match.auth.token);
        if (!u) throw new AppError('unauthorized', 401, 'Invalid or revoked token, or missing scope.');
        userId = u.id;
        viaToken = true;
      } else {
        const s = await auth.authenticate(db, cookies.get(SESSION_COOKIE));
        if (!s || s.mfaPending) throw new AppError('unauthorized', 401, 'Please sign in.');
        userId = s.user.id;
      }
    }
    if (!viaToken && req.method !== 'GET' && match.auth !== 'none' && !sameOrigin(req)) throw new AppError('csrf', 403, 'Cross-site request refused.');
    if (match.auth === 'none' && req.method !== 'GET' && p.startsWith('/auth/') && !sameOrigin(req)) throw new AppError('csrf', 403, 'Cross-site request refused.');
    const ctx = ctxFor(db, userId);
    let bodyCache: Record<string, unknown> | null = null;
    const r: Req = {
      raw: req, params, query: url.searchParams, ctx, cookies,
      setCookie: (c) => setCookies.push(serialiseCookie(c)),
      body: async () => {
        if (bodyCache) return bodyCache;
        const text = await req.text();
        if (text.length > MAX_JSON) throw new AppError('too_large', 413, 'Request too large.');
        try {
          bodyCache = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          throw new AppError('invalid', 400, 'Malformed JSON.');
        }
        return bodyCache;
      },
      files: async () => {
        const form = await req.formData();
        const fields: Record<string, string> = {};
        const files: ValidatedFile[] = [];
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') fields[k] = v;
          else if (v.size > 0) files.push(validateUpload(v.name, v.type, Buffer.from(await v.arrayBuffer())));
        }
        return { fields, files };
      },
      ws: async () => {
        const wanted = cookies.get(WORKSPACE_COOKIE);
        if (wanted && (await one(db, 'SELECT 1 FROM memberships WHERE user_id = $1 AND workspace_id = $2', [userId, wanted]))) return wanted;
        return personalWorkspaceId(db, userId);
      },
    };
    const result = await match.handler(r);
    const res = result instanceof Response ? result : Response.json({ data: result ?? null }, { headers: { 'cache-control': 'no-store' } });
    for (const c of setCookies) res.headers.append('set-cookie', c);
    return res;
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status, headers: err.code === 'rate_limited' ? { 'retry-after': String((err.details as { retryAfterSeconds: number }).retryAfterSeconds) } : {} });
    if (err instanceof z.ZodError) return Response.json({ error: { code: 'invalid', message: err.issues[0]?.message ?? 'Invalid input.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }, { status: 422 });
    console.error('[lifeos-api]', req.method, p, err);
    return Response.json({ error: { code: 'internal', message: 'Something went wrong. Try again, and check the record before repeating the action.' } }, { status: 500 });
  }
}

export const ROUTE_COUNT = () => routes.length;

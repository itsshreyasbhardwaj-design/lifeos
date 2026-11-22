/**
 * One test per critical system invariant from the specification (Part 31).
 * Names start with the invariant number so failures map straight back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, at } from './helpers.ts';
import { createCapture, processCapture, getCapture, confirmCandidate, deleteCapture } from '../src/captures.ts';
import { createTask, setTaskStatus, getTask, updateTask } from '../src/tasks.ts';
import { deliverDue, snooze, recomputeUserReminders, scheduleReminder, listNotifications } from '../src/reminders.ts';
import { updatePreferences } from '../src/auth.ts';
import { createDocument, documentAccess, shareDocument, revokeGrant } from '../src/documents.ts';
import { search } from '../src/search.ts';
import { ask, approveProposal, suggestNextActions, listProposals } from '../src/intelligence.ts';
import { devSetPlan, cancelPlan, startTrial } from '../src/billing.ts';
import { createPurchase } from '../src/purchases.ts';
import { createFamily, inviteMember, acceptInvitation, changeRole } from '../src/family.ts';
import { deleteAccount, track } from '../src/privacy.ts';
import { createPromise } from '../src/promises.ts';
import { validateUpload } from '../src/files.ts';
import { runJobs } from '../src/jobs.ts';
import '../src/worker.ts';

test('1. no extracted action becomes a record without review', async () => {
  const { db, user } = await setup();
  const u = await user();
  const { capture } = await createCapture(u.ctx(), u.ws, { text: 'Pay the electricity bill by 30/11/2026' });
  await processCapture(db, capture.id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks'))[0]!.n, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM bills'))[0]!.n, 0);
  // The database itself refuses an "accepted" candidate with no review.
  const c = (await getCapture(u.ctx(), capture.id)).candidates[0]!;
  await assert.rejects(db.query(`UPDATE extraction_candidates SET status = 'accepted' WHERE id = $1`, [c.id]), /candidate_accept_needs_review/);
  await db.close();
});

test('2. ambiguous dates are not silently guessed', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const { capture } = await createCapture(ctx, u.ws, { text: 'Submit the form by 04/05/2027' });
  await processCapture(db, capture.id);
  const c = (await getCapture(ctx, capture.id)).candidates[0]!;
  assert.equal(c.uncertain[0]!.reason, 'day_month_order');
  await assert.rejects(confirmCandidate(ctx, c.id, {}), /need a look/);
  const r = await confirmCandidate(ctx, c.id, { fields: { dueDate: '2027-04-05' } });
  assert.equal((await getTask(db, u.id, r.recordId)).due_date, '2027-04-05', 'the reviewer’s reading wins');
  await db.close();
});

test('3. the original capture survives extraction failure', async () => {
  const { db, user } = await setup();
  const u = await user();
  const pdf = validateUpload('broken.pdf', 'application/pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage that is not a pdf body at all')]));
  const { capture } = await createCapture(u.ctx(), u.ws, { title: 'Insurance' }, [pdf]);
  const r = await processCapture(db, capture.id);
  const after = await getCapture(u.ctx(), capture.id);
  assert.notEqual(r.status, 'missing');
  assert.equal(after.files.length, 1, 'file kept');
  assert.match(after.capture.extraction_note ?? after.capture.error ?? '', /could not be read|no text|saved/i);
  await db.close();
});

test('4. repeated uploads are detected, not merged', async () => {
  const { db, user } = await setup();
  const u = await user();
  const f = () => validateUpload('bill.txt', 'text/plain', Buffer.from('Amount due ₹1,200 due date 30/11/2026'));
  const a = await createCapture(u.ctx(), u.ws, {}, [f()]);
  const b = await createCapture(u.ctx(), u.ws, {}, [f()]);
  assert.notEqual(a.capture.id, b.capture.id);
  assert.equal(b.similar[0]!.id, a.capture.id);
  assert.equal(b.duplicateFiles[0]!.existingCaptureId, a.capture.id);
  await db.close();
});

test('5. recurring tasks never create duplicate occurrences', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx();
  const t = await createTask(ctx, u.ws, { title: 'Water plants', dueDate: '2026-11-23', recurrence: { freq: 'weekly', interval: 1 } });
  const r1 = await setTaskStatus(ctx, t.id, { status: 'completed' });
  assert.equal(r1.next!.due_date, '2026-11-30');
  // Reopen and complete again: the next occurrence already exists, so none is added.
  await setTaskStatus(ctx, t.id, { status: 'open' });
  const r2 = await setTaskStatus(ctx, t.id, { status: 'completed' });
  assert.equal(r2.next, null);
  const rows = await db.query<{ occurrence_date: string }>('SELECT occurrence_date FROM tasks WHERE series_id = $1 ORDER BY occurrence_date', [t.id]);
  assert.deepEqual(rows.map((x) => x.occurrence_date), ['2026-11-23', '2026-11-30']);
  await assert.rejects(db.query(`INSERT INTO tasks (id, workspace_id, title, series_id, occurrence_date) VALUES ('tsk_dup', $1, 'dup', $2, '2026-11-30')`, [u.ws, t.id]), /tasks_series_occurrence_key/);
  await db.close();
});

test('6. cancelling an action stops its future reminders', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const t = await createTask(ctx, u.ws, { title: 'Book train tickets', dueDate: '2026-11-24', reminderOffsets: [-1440, 0] });
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [t.id])).length, 2);
  await setTaskStatus(ctx, t.id, { status: 'cancelled', note: 'Plans changed' });
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [t.id])).length, 0);
  // Defence in depth: a reminder left scheduled for a closed target is cancelled at delivery.
  await scheduleReminder(db, { workspaceId: u.ws, userId: u.id, targetType: 'task', targetId: t.id, kind: 'one_time', title: 'stale', fireAt: at('2026-11-23T00:00:00Z'), createdBy: u.id });
  const rep = await deliverDue(db, at('2026-11-25T00:00:00Z'));
  assert.equal(rep.delivered, 0);
  assert.equal(rep.cancelled, 1);
  await db.close();
});

test('7. snoozing never duplicates tasks or reminders', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const t = await createTask(ctx, u.ws, { title: 'Call bank', dueDate: '2026-11-22', dueTime: '11:00', reminderOffsets: [0] });
  await deliverDue(db, at('2026-11-22T05:30:00Z'));
  const rem = (await db.query<{ id: string }>(`SELECT id FROM reminders WHERE target_id = $1`, [t.id]))[0]!;
  await snooze(db, u.id, rem.id, at('2026-11-22T06:30:00Z'), at('2026-11-22T05:31:00Z'));
  await snooze(db, u.id, rem.id, at('2026-11-22T07:30:00Z'), at('2026-11-22T06:31:00Z'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks'))[0]!.n, 1);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM reminders WHERE target_id = $1`, [t.id]))[0]!.n, 1);
  await deliverDue(db, at('2026-11-22T07:30:00Z'));
  assert.equal((await listNotifications(db, u.id)).length, 2, 'original + one after the final snooze');
  await db.close();
});

test('8. completion status persists', async () => {
  const { db, user } = await setup();
  const u = await user();
  const t = await createTask(u.ctx(), u.ws, { title: 'Return library books' });
  await setTaskStatus(u.ctx(), t.id, { status: 'completed', note: 'Returned at front desk' });
  const again = await getTask(db, u.id, t.id);
  assert.equal(again.status, 'completed');
  assert.equal(again.completion_note, 'Returned at front desk');
  assert.ok(again.completed_at);
  await db.close();
});

test('9 & 10. proposals need approval and cannot fabricate external success', async () => {
  const { db, user } = await setup();
  const u = await user();
  await devSetPlan(db, u.id, 'plus');
  const ctx = u.ctx(at('2026-11-30T05:00:00Z'));
  await createPromise(ctx, u.ws, { direction: 'waiting_on', description: 'Refund for returned shoes', counterparty: 'Myntra', expectedBy: '2026-11-25' });
  assert.equal(await suggestNextActions(ctx), 1);
  assert.equal(await suggestNextActions(ctx), 0, 'no repeat suggestions');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks'))[0]!.n, 0, 'nothing ran without approval');
  const [p] = await listProposals(ctx) as { id: string; kind: string }[];
  assert.ok(['create_task', 'create_reminder', 'create_checklist', 'draft_message'].includes(p!.kind), 'no external action kinds exist');
  const r = await approveProposal(ctx, p!.id);
  assert.equal(r.resultType, 'task');
  await db.close();
});

test('11. private documents stay private', async () => {
  const { db, user } = await setup();
  const a = await user();
  const b = await user();
  const { doc } = await createDocument(a.ctx(), a.ws, { title: 'Passport scan' }, validateUpload('p.txt', 'text/plain', Buffer.from('passport')), db, null);
  await assert.rejects(documentAccess(db, b.id, doc.id), /not found/i);
  await db.close();
});

test('12. family permissions are enforced by role', async () => {
  const { db, user } = await setup();
  const o = await user();
  const helper = await user();
  await devSetPlan(db, o.id, 'family');
  const { id: fam } = await createFamily(o.ctx(), 'Home');
  await acceptInvitation(helper.ctx(), (await inviteMember(o.ctx(), fam, helper.email, 'limited')).token);
  await assert.rejects(createTask(helper.ctx(), fam, { title: 'x' }), /do not have access/i);
  const mine = await createTask(o.ctx(), fam, { title: 'Clean balcony', assigneeId: helper.id });
  const other = await createTask(o.ctx(), fam, { title: 'Pay society maintenance' });
  await setTaskStatus(helper.ctx(), mine.id, { status: 'completed' });
  await assert.rejects(getTask(db, helper.id, other.id), /not found/i);
  await assert.rejects(updateTask(helper.ctx(), mine.id, { title: 'renamed' }), /not edit/i);
  await assert.rejects(changeRole(helper.ctx(), fam, helper.id, 'adult'), /do not have access/i);
  await db.close();
});

test('13. access revocation takes effect immediately', async () => {
  const { db, user } = await setup();
  const o = await user();
  const m = await user();
  await devSetPlan(db, o.id, 'family');
  const { id: fam } = await createFamily(o.ctx(), 'Home');
  await acceptInvitation(m.ctx(), (await inviteMember(o.ctx(), fam, m.email, 'adult')).token);
  const { doc } = await createDocument(o.ctx(), o.ws, { title: 'Car insurance' }, validateUpload('i.txt', 'text/plain', Buffer.from('policy')), db, null);
  const { grantId } = await shareDocument(o.ctx(), doc.id, { granteeUserId: m.id, canDownload: true, expiresAt: new Date(Date.now() + 86_400_000) });
  assert.ok(await documentAccess(db, m.id, doc.id));
  await revokeGrant(o.ctx(), grantId);
  await assert.rejects(documentAccess(db, m.id, doc.id), /not found/i);
  // Expiry is enforced at read time too.
  const g2 = await shareDocument(o.ctx(), doc.id, { granteeUserId: m.id, expiresAt: new Date(Date.now() + 60_000) });
  await assert.rejects(documentAccess(db, m.id, doc.id, new Date(Date.now() + 120_000)), /not found/i);
  assert.ok(g2.grantId);
  await db.close();
});

test('14 & 15. search and Life AI respect workspace permissions', async () => {
  const { db, user } = await setup();
  const a = await user();
  const b = await user();
  await createTask(a.ctx(), a.ws, { title: 'Collect biopsy report from lab' });
  assert.equal((await search(a.ctx(), 'biopsy')).length, 1);
  assert.equal((await search(b.ctx(), 'biopsy')).length, 0);
  const ans = await ask(b.ctx(), 'where is my biopsy report');
  assert.equal(ans.sources.length, 0);
  assert.match(ans.answer, /couldn’t find/);
  await db.close();
});

test('16. account deletion removes the account and anonymises its audit trail', async () => {
  const { db, user } = await setup();
  const u = await user();
  await createDocument(u.ctx(), u.ws, { title: 'Doc' }, validateUpload('d.txt', 'text/plain', Buffer.from('x')), db, null);
  await createTask(u.ctx(), u.ws, { title: 'Task' });
  await assert.rejects(deleteAccount(u.ctx(), 'wrong password!!', u.email), /incorrect/);
  await deleteAccount(u.ctx(), 'correct horse battery', u.email);
  for (const t of ['users', 'workspaces', 'tasks', 'documents', 'document_versions', 'search_index']) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`))[0]!.n, 0, t);
  }
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE actor_id = $1`, [u.id]))[0]!.n, 0);
  await db.close();
});

test('17. offline sync — see Workflow G in workflows.test.ts', () => {
  assert.ok(true);
});

test('18. cancelling a plan does not destroy records', async () => {
  const { db, user } = await setup();
  const u = await user();
  await startTrial(db, u.id, 'plus');
  const p = await createPurchase(u.ctx(), u.ws, { productName: 'Washing machine' });
  await cancelPlan(db, u.id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM purchases WHERE id = $1', [p.id]))[0]!.n, 1);
  await db.close();
});

test('19. entitlements are enforced on the server, not by hiding buttons', async () => {
  const { db, user } = await setup();
  const u = await user();
  await assert.rejects(createPurchase(u.ctx(), u.ws, { productName: 'TV' }), (e: Error & { code?: string }) => e.code === 'plan_required');
  await assert.rejects(createFamily(u.ctx(), 'x'), (e: Error & { code?: string }) => e.code === 'plan_required');
  await db.close();
});

test('20. critical actions leave an audit record', async () => {
  const { db, user } = await setup();
  const u = await user();
  const t = await createTask(u.ctx(), u.ws, { title: 'x' });
  await setTaskStatus(u.ctx(), t.id, { status: 'completed' });
  const { doc } = await createDocument(u.ctx(), u.ws, { title: 'd' }, validateUpload('d.txt', 'text/plain', Buffer.from('x')), db, null);
  const { readDocumentFile } = await import('../src/documents.ts');
  await readDocumentFile(u.ctx(), doc.id, { purpose: 'download' });
  const actions = (await db.query<{ action: string }>('SELECT action FROM audit_events WHERE actor_id = $1', [u.id])).map((r) => r.action);
  for (const a of ['auth.registered', 'task.completed', 'document.created', 'document.downloaded']) assert.ok(actions.includes(a), a);
  await db.close();
});

test('21. a tampered proposal payload fails validation and creates nothing', async () => {
  const { db, user } = await setup();
  const u = await user();
  await devSetPlan(db, u.id, 'plus');
  await createPromise(u.ctx(at('2026-11-30T05:00:00Z')), u.ws, { direction: 'they_promised', description: 'x', expectedBy: '2026-11-25' });
  await suggestNextActions(u.ctx(at('2026-11-30T05:00:00Z')));
  const [p] = (await listProposals(u.ctx())) as { id: string }[];
  await db.query(`UPDATE action_proposals SET payload = '{"workspaceId":"x","title":""}' WHERE id = $1`, [p!.id]);
  await assert.rejects(approveProposal(u.ctx(), p!.id), /no longer valid/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks'))[0]!.n, 0);
  await db.close();
});

test('22. extraction never asserts authenticity', async () => {
  const { db, user } = await setup();
  const u = await user();
  const { capture } = await createCapture(u.ctx(), u.ws, { text: 'GOVERNMENT CERTIFIED — OFFICIAL Passport valid till 12/08/2031' });
  await processCapture(db, capture.id);
  const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('documents','extraction_candidates')`)).map((r) => r.column_name);
  assert.ok(!cols.some((c) => /verified|authentic|official/.test(c)), 'no column can even record authenticity');
  await db.close();
});

test('23. recurring reminders stay at local time across timezone changes', async () => {
  const { db, user } = await setup();
  const u = await user('Tz', { timezone: 'Asia/Kolkata' });
  const t = await createTask(u.ctx(), u.ws, { title: 'Standup notes', dueDate: '2026-12-01', dueTime: '09:00', reminderOffsets: [0] });
  const before = (await db.query<{ fire_at: Date }>(`SELECT fire_at FROM reminders WHERE target_id = $1`, [t.id]))[0]!.fire_at;
  assert.equal(new Date(before).toISOString(), '2026-12-01T03:30:00.000Z');
  await updatePreferences(db, u.id, { timezone: 'Europe/London' });
  await recomputeUserReminders(db, u.id);
  const after = (await db.query<{ fire_at: Date }>(`SELECT fire_at FROM reminders WHERE target_id = $1`, [t.id]))[0]!.fire_at;
  assert.equal(new Date(after).toISOString(), '2026-12-01T09:00:00.000Z');
  await db.close();
});

test('24. analytics never capture document contents and need consent', async () => {
  const { db, user } = await setup();
  const u = await user();
  assert.equal(await track(db, u.id, 'capture_created', { source: 'pdf' }), false, 'off without consent');
  const { setConsent } = await import('../src/privacy.ts');
  await setConsent(db, u.id, 'product_analytics', true);
  await track(db, u.id, 'capture_created', { source: 'pdf', text: 'Aadhaar 1234 5678 9012' });
  const row = (await db.query<{ props: object; subject: string }>('SELECT props, subject FROM product_events'))[0]!;
  assert.deepEqual(row.props, { source: 'pdf' });
  assert.notEqual(row.subject, u.id);
  await db.close();
});

test('25. deleting a source capture keeps confirmed records and clears their source', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx();
  const { capture } = await createCapture(ctx, u.ws, { text: 'Renew the car insurance by 15/12/2026' });
  await processCapture(db, capture.id);
  const c = (await getCapture(ctx, capture.id)).candidates[0]!;
  const r = await confirmCandidate(ctx, c.id, { acknowledgeUncertain: true });
  const { keptRecords } = await deleteCapture(ctx, capture.id);
  assert.equal(keptRecords, 1);
  const t = await getTask(db, u.id, r.recordId);
  assert.equal(t.source_capture_id, null);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM life_links WHERE to_id = $1`, [capture.id]))[0]!.n, 0);
  await db.close();
});

test('jobs: the queued extraction runs from the durable queue', async () => {
  const { db, user } = await setup();
  const u = await user();
  const { capture } = await createCapture(u.ctx(), u.ws, { text: 'Call the electrician tomorrow' });
  const r = await runJobs(db);
  assert.equal(r.ran, 1);
  assert.equal((await getCapture(u.ctx(), capture.id)).capture.status, 'review_required');
  await db.close();
});

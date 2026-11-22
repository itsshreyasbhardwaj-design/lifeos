/**
 * The prompt's Workflows B–H at the service layer, against real PostgreSQL
 * (PGlite). Workflow A is in flow.test.ts; browser versions are in tests/e2e.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, at } from './helpers.ts';
import { createCapture, processCapture, getCapture, confirmCandidate } from '../src/captures.ts';
import { search } from '../src/search.ts';
import { ask } from '../src/intelligence.ts';
import { readDocumentFile, shareDocument, revokeGrant, createDocument, documentAccess, listDocuments } from '../src/documents.ts';
import { createPromise, resolvePromise, listPromises } from '../src/promises.ts';
import { createWorkflow, setWorkflowStatus } from '../src/planning.ts';
import { checklist, toggleChecklistItem, createTask, listTasks, setTaskStatus } from '../src/tasks.ts';
import { historyFor } from '../src/audit.ts';
import { createFamily, inviteMember, acceptInvitation, removeMember, members } from '../src/family.ts';
import { createSubscription, requestCancellation, confirmCancellation, listSubscriptions } from '../src/commitments.ts';
import { syncBatch, resolveConflict } from '../src/sync.ts';
import { startTrial, cancelPlan, billingState, devSetPlan, usage } from '../src/billing.ts';
import { createPurchase, purchaseDetail } from '../src/purchases.ts';
import { deliverDue } from '../src/reminders.ts';
import { validateUpload } from '../src/files.ts';

const RECEIPT = `Croma\nTax Invoice\nInvoice No: CRM/24/88812\nInvoice Date: 15/11/2026\nItem: Dell Inspiron 14 Laptop   Qty 1   ₹62,990.00\nGrand Total ₹62,990.00\n1 year manufacturer warranty.\n10 days replacement policy.`;

test('Workflow B — receipt → purchase, warranty, return → reminders → search → original receipt', async () => {
  const { db, user } = await setup();
  const u = await user('Ravi');
  await devSetPlan(db, u.id, 'plus');
  const ctx = u.ctx(at('2026-11-20T05:00:00Z'));
  const file = validateUpload('croma-invoice.txt', 'text/plain', Buffer.from(RECEIPT));
  const { capture } = await createCapture(ctx, u.ws, { sourceType: 'receipt' }, [file]);
  await processCapture(db, capture.id);
  const { candidates } = await getCapture(ctx, capture.id);
  const p = candidates.find((c) => c.kind === 'purchase')!;
  const w = candidates.find((c) => c.kind === 'warranty')!;
  const r = candidates.find((c) => c.kind === 'return_window')!;
  // Order matters: a warranty needs its purchase first.
  await assert.rejects(confirmCandidate(ctx, w.id, { acknowledgeUncertain: true }), /Confirm the purchase first/);
  const purchase = await confirmCandidate(ctx, p.id, { acknowledgeUncertain: true, fields: { category: 'electronics' } });
  const warranty = await confirmCandidate(ctx, w.id, { acknowledgeUncertain: true });
  await confirmCandidate(ctx, r.id, { acknowledgeUncertain: true });
  const detail = await purchaseDetail(ctx, purchase.recordId);
  assert.equal(detail.purchase.product_name, 'Dell Inspiron 14 Laptop');
  assert.equal(detail.purchase.amount_minor, 6_299_000);
  assert.equal((detail.warranties[0] as { ends_on: string }).ends_on, '2027-11-14');
  assert.equal((detail.warranties[0] as { basis: string }).basis, 'document_confirmed');
  assert.equal((detail.returns[0] as { deadline: string }).deadline, '2026-11-25');
  const rem = await db.query<{ target_type: string; fire_at: Date }>(`SELECT target_type, fire_at FROM reminders WHERE user_id = $1 AND status = 'scheduled' ORDER BY fire_at`, [u.id]);
  assert.ok(rem.some((x) => x.target_type === 'warranty') && rem.some((x) => x.target_type === 'return_window'));
  assert.ok(warranty.recordId);
  // Search finds it; the receipt opens.
  const hits = await search(ctx, 'laptop invoice');
  assert.ok(hits.some((h) => h.type === 'purchase'));
  const answer = await ask(ctx, 'Where is my laptop invoice?');
  const docSource = answer.sources.find((s) => s.type === 'document');
  assert.ok(docSource, JSON.stringify(answer));
  const f = await readDocumentFile(ctx, docSource!.id, { purpose: 'view' });
  assert.match(f.data.toString(), /Dell Inspiron/);
  const when = await ask(ctx, 'When does my laptop warranty expire?');
  assert.match(when.answer, /14 Nov,? 2027/);
  await db.close();
});

test('Workflow C — promise → expected date → follow-up → waiting list → resolve → reminders stop', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const p = await createPromise(ctx, u.ws, { direction: 'they_promised', description: 'Service centre will call back about the repair', counterparty: 'Sony Service', expectedBy: '2026-11-25' });
  const waiting = await ask(ctx, 'What am I waiting for?');
  assert.ok(waiting.sources.some((s) => s.id === p.id));
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [p.id])).length, 1);
  await resolvePromise(ctx, p.id, 'fulfilled', 'They called, pickup on Friday');
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [p.id])).length, 0);
  const report = await deliverDue(db, at('2026-11-25T10:00:00Z'));
  assert.equal(report.delivered, 0);
  const list = await listPromises(ctx);
  assert.equal(list[0]!.status, 'fulfilled');
  await db.close();
});

test('Workflow D — LifeAdmin: template → documents → steps → evidence → submitted → confirmed → history', async () => {
  const { db, user } = await setup();
  const u = await user();
  await devSetPlan(db, u.id, 'plus');
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const { id } = await createWorkflow(ctx, u.ws, { title: 'Apply to IISc summer programme', templateKey: 'university_application', deadline: '2026-12-15', officialUrl: 'https://example.edu/apply' });
  const items = await checklist(db, u.id, 'admin_workflow', id);
  assert.ok(items.length >= 8);
  for (const it of items.slice(0, 3)) await toggleChecklistItem(ctx, it.id, true);
  const { doc } = await createDocument(ctx, u.ws, { title: 'Submission confirmation', category: 'administrative' }, validateUpload('confirm.txt', 'text/plain', Buffer.from('Application APP-2291 received')), db, null);
  const { link } = await import('../src/links.ts');
  await link(db, { workspaceId: u.ws, fromType: 'document', fromId: doc.id, toType: 'admin_workflow', toId: id, relation: 'evidence_for', provenance: { source: 'user' }, actorId: u.id });
  await setWorkflowStatus(ctx, id, 'user_reported_submitted', { referenceNumber: 'APP-2291' });
  await setWorkflowStatus(ctx, id, 'confirmed_completed', { note: 'Acceptance email received' });
  const hist = await historyFor(db, 'admin_workflow', id);
  assert.deepEqual(hist.map((h) => h.action).filter((a) => a.startsWith('status:')), ['status:user_reported_submitted', 'status:confirmed_completed']);
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [id])).length, 0);
  await db.close();
});

test('Workflow E — family: invite, assign, complete, share one document, privacy, revoke', async () => {
  const { db, user } = await setup();
  const owner = await user('Meera');
  const kid = await user('Arjun');
  await devSetPlan(db, owner.id, 'family');
  const octx = owner.ctx();
  const kctx = kid.ctx();
  const { id: fam } = await createFamily(octx, 'Sharma home');
  const inv = await inviteMember(octx, fam, kid.email, 'member');
  await acceptInvitation(kctx, inv.token);
  assert.equal((await members(kctx, fam)).people.length, 2);
  const t = await createTask(octx, fam, { title: 'Take out recycling', assigneeId: kid.id, dueDate: '2026-11-23' });
  assert.equal(t.assignment_status, 'pending');
  const kidTasks = await listTasks(kctx, { view: 'assigned_to_me' });
  assert.equal(kidTasks.length, 1);
  await setTaskStatus(kctx, t.id, { status: 'completed' });
  // Owner's personal records stay private.
  await createTask(octx, owner.ws, { title: 'Private: dermatologist appointment' });
  const personalDoc = (await createDocument(octx, owner.ws, { title: 'Salary slip' }, validateUpload('slip.txt', 'text/plain', Buffer.from('salary 1,20,000')), db, null)).doc;
  const shared = (await createDocument(octx, owner.ws, { title: 'House rental agreement' }, validateUpload('lease.txt', 'text/plain', Buffer.from('lease terms')), db, null)).doc;
  const { grantId } = await shareDocument(octx, shared.id, { granteeWorkspaceId: fam, canDownload: false });
  const kidDocs = await listDocuments(kctx);
  assert.deepEqual(kidDocs.map((d) => d.title), ['House rental agreement']);
  await assert.rejects(documentAccess(db, kid.id, personalDoc.id), /not found/i);
  assert.ok(!(await listTasks(kctx, {})).some((x) => x.title.startsWith('Private')));
  assert.equal((await search(kctx, 'salary')).length, 0);
  assert.equal((await search(kctx, 'dermatologist')).length, 0);
  await assert.rejects(readDocumentFile(kctx, shared.id, { purpose: 'download' }), /view-only/);
  assert.match((await readDocumentFile(kctx, shared.id, { purpose: 'view' })).data.toString(), /lease/);
  await revokeGrant(octx, grantId);
  await assert.rejects(documentAccess(db, kid.id, shared.id), /not found/i);
  // Removing the member removes family access immediately.
  await removeMember(octx, fam, kid.id);
  assert.equal((await listTasks(kctx, {})).length, 0);
  await db.close();
});

test('Workflow F — subscription: renewal reminder → cancellation checklist → confirmation → no future reminders', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const s = await createSubscription(ctx, u.ws, { name: 'Netflix', amountMinor: 64_900, cycle: 'monthly', nextRenewalDate: '2026-12-05' });
  const before = await db.query(`SELECT fire_at FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [s.id]);
  assert.equal(before.length, 1);
  await requestCancellation(ctx, s.id);
  assert.ok((await checklist(db, u.id, 'subscription', s.id)).length >= 4);
  await confirmCancellation(ctx, s.id, { cancelledOn: '2026-11-22', notes: 'Cancelled in account settings' });
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [s.id])).length, 0);
  assert.equal((await deliverDue(db, at('2026-12-05T10:00:00Z'))).delivered, 0);
  const { totals } = await listSubscriptions(ctx);
  assert.equal(totals.length, 0);
  await db.close();
});

test('Workflow G — offline drafts sync once; stale edits become conflicts, not overwrites', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx();
  const ops = [
    { op: 'capture.create', clientId: 'draft-0001-aaaa', workspaceId: u.ws, payload: { text: 'Buy printer ink tomorrow' } },
    { op: 'task.create', clientId: 'task-0001-bbbb', workspaceId: u.ws, payload: { title: 'Renew library card' } },
  ];
  const first = await syncBatch(ctx, ops);
  const second = await syncBatch(ctx, ops);
  assert.deepEqual(first.map((r) => r.result), ['applied', 'applied']);
  assert.deepEqual(second.map((r) => r.result), ['already_applied', 'already_applied']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM captures'))[0]!.n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks'))[0]!.n, 1);
  const taskId = (first[1] as { id: string }).id;
  // Edited online meanwhile (version 1 → 2), then an offline edit based on v1 arrives.
  const { updateTask } = await import('../src/tasks.ts');
  await updateTask(ctx, taskId, { title: 'Renew library card (online edit)' });
  const r = await syncBatch(ctx, [{ op: 'task.update', id: taskId, baseVersion: 1, payload: { title: 'Renew library card (offline edit)' } }]);
  assert.equal(r[0]!.result, 'conflict');
  const t = (await db.query<{ title: string }>('SELECT title FROM tasks WHERE id = $1', [taskId]))[0]!;
  assert.equal(t.title, 'Renew library card (online edit)', 'server value not overwritten');
  await resolveConflict(ctx, (r[0] as { conflictId: string }).conflictId, 'mine');
  assert.equal((await db.query<{ title: string }>('SELECT title FROM tasks WHERE id = $1', [taskId]))[0]!.title, 'Renew library card (offline edit)');
  await db.close();
});

test('Workflow H — trial → premium feature → limit → server-side entitlement → downgrade keeps data', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  await assert.rejects(createPurchase(ctx, u.ws, { productName: 'Mixer grinder' }), /needs LifeOS Plus/);
  await startTrial(db, u.id, 'plus', ctx.now);
  await assert.rejects(startTrial(db, u.id, 'plus', ctx.now), /already been used/);
  const p = await createPurchase(ctx, u.ws, { productName: 'Mixer grinder', amountMinor: 3_49_900 });
  // Configured limit: shrink the extraction allowance and hit it.
  process.env.LIFEOS_PLANS_JSON = JSON.stringify({ plus: { limits: { extractions: 1 } } });
  try {
    const f = () => validateUpload('a.txt', 'text/plain', Buffer.from(`Order Total ₹${Math.random()}`));
    const a = await createCapture(ctx, u.ws, {}, [f()]);
    const b = await createCapture(ctx, u.ws, {}, [f()]);
    await processCapture(db, a.capture.id);
    await processCapture(db, b.capture.id);
    const second = (await getCapture(ctx, b.capture.id)).capture;
    assert.match(second.extraction_note ?? '', /limit/);
    assert.notEqual(second.status, 'failed', 'capture survives a quota hit');
    const ex = (await usage(db, u.id, ctx.now)).find((x) => x.metric === 'extractions')!;
    assert.equal(ex.limit, 1);
  } finally {
    delete process.env.LIFEOS_PLANS_JSON;
  }
  await cancelPlan(db, u.id, ctx.now);
  assert.equal((await billingState(db, u.id, ctx.now)).plan, 'free');
  // Data retained and readable; new premium records are refused.
  assert.equal((await purchaseDetail(ctx, p.id)).purchase.product_name, 'Mixer grinder');
  await assert.rejects(createPurchase(ctx, u.ws, { productName: 'Kettle' }), /needs LifeOS Plus/);
  // Trial expiry also downgrades, computed at read time.
  const v = await user();
  await startTrial(db, v.id, 'plus', at('2026-01-01T00:00:00Z'));
  assert.equal((await billingState(db, v.id, at('2026-01-20T00:00:00Z'))).plan, 'free');
  await db.close();
});

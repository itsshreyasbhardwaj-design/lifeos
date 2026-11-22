import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, at } from './helpers.ts';
import { createCapture, processCapture, getCapture, confirmCandidate, rejectCandidate } from '../src/captures.ts';
import { deliverDue, listNotifications } from '../src/reminders.ts';
import { setTaskStatus, getTask } from '../src/tasks.ts';
import { neighbours } from '../src/links.ts';

test('Workflow A core: capture → extract → review → confirm → remind → complete', async () => {
  const { db, user } = await setup();
  const u = await user('Asha');
  const now = at('2026-11-22T04:30:00Z'); // 10:00 IST
  const ctx = u.ctx(now);
  const { capture } = await createCapture(ctx, u.ws, { text: 'Reminder: submit the scholarship form by 28/11/2026 at 5pm. The interview is on 3 Dec at 11am.' });
  assert.equal(capture.status, 'queued');
  const r = await processCapture(db, capture.id);
  assert.equal(r.status, 'review_required');
  const { candidates } = await getCapture(ctx, capture.id);
  const task = candidates.find((c) => c.kind === 'task' || c.kind === 'deadline')!;
  const event = candidates.find((c) => c.kind === 'event')!;
  assert.ok(task && event, JSON.stringify(candidates.map((c) => c.kind)));

  // The interview date has no year: confirming without choosing one is refused.
  await assert.rejects(confirmCandidate(ctx, event.id, { acknowledgeUncertain: true }), /without a full date|Choose the date/);
  // Uncertain fields need acknowledgement.
  const res = await confirmCandidate(ctx, task.id, { acknowledgeUncertain: true });
  assert.equal(res.recordType, 'task');
  const t = await getTask(db, u.id, res.recordId);
  assert.equal(t.due_date, '2026-11-28');
  assert.equal(t.due_time, '17:00');
  assert.equal(t.source_capture_id, capture.id);

  // Source evidence is navigable from the task.
  const links = await neighbours(db, u.id, 'task', t.id);
  assert.ok(links.some((l) => l.type === 'capture' && l.id === capture.id && l.relation === 'derived_from'));

  // Event confirmed with an explicit date.
  await confirmCandidate(ctx, event.id, { fields: { date: '2026-12-03' }, acknowledgeUncertain: true });

  // Reminder fires at 17:00 IST on the 28th = 11:30Z.
  const early = await deliverDue(db, at('2026-11-28T11:29:00Z'));
  assert.equal(early.delivered, 0);
  const due = await deliverDue(db, at('2026-11-28T11:30:00Z'));
  assert.equal(due.delivered, 1);
  const again = await deliverDue(db, at('2026-11-28T11:31:00Z'));
  assert.equal(again.delivered, 0, 'never delivered twice');
  const notes = await listNotifications(db, u.id);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.title, /scholarship/i);

  // Complete it.
  const done = await setTaskStatus(u.ctx(at('2026-11-28T12:00:00Z')), t.id, { status: 'completed', note: 'Submitted online' });
  assert.equal(done.task.status, 'completed');
  assert.ok(done.task.completed_at);
  const { captures } = { captures: (await getCapture(ctx, capture.id)).capture };
  assert.equal(captures.status, 'confirmed');
  await db.close();
});

test('a rejected suggestion creates nothing', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T04:30:00Z'));
  const { capture } = await createCapture(ctx, u.ws, { text: 'Please call the plumber tomorrow' });
  await processCapture(db, capture.id);
  const c = (await getCapture(ctx, capture.id)).candidates[0]!;
  await rejectCandidate(ctx, c.id);
  const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tasks');
  assert.equal(n[0]!.n, 0);
  await db.close();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, at } from './helpers.ts';
import { createBill, reportBillPaid, cancelBill } from '../src/commitments.ts';
import { createRoutine, recordRoutine, scheduleRoutineReminders, routinesOverview, createLifeEvent, lifeEventDetail, addParticipant, setLifeEventStatus } from '../src/planning.ts';
import { checklist } from '../src/tasks.ts';
import { deliverDue } from '../src/reminders.ts';
import { createRule, evaluateAutomations, listProposals, setRuleEnabled } from '../src/intelligence.ts';
import { createPurchase, addWarranty } from '../src/purchases.ts';
import { devSetPlan } from '../src/billing.ts';
import { createEvent, moveEvent, conflicts, agenda } from '../src/calendar.ts';

test('bills: paying an occurrence stops its reminders and creates the next one exactly once', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const { id, occurrenceId } = await createBill(ctx, u.ws, { name: 'Electricity', category: 'electricity', amountMinor: 184_200, cycle: 'monthly', nextDueDate: '2026-11-30' });
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [occurrenceId])).length, 2);
  const r = await reportBillPaid(ctx, occurrenceId!, { paidOn: '2026-11-25' });
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [occurrenceId])).length, 0);
  const occ = await db.query<{ due_date: string; status: string }>('SELECT due_date, status FROM bill_occurrences WHERE bill_id = $1 ORDER BY due_date', [id]);
  assert.deepEqual(occ.map((o) => [o.due_date, o.status]), [['2026-11-30', 'user_reported_paid'], ['2026-12-30', 'upcoming']]);
  await assert.rejects(reportBillPaid(ctx, occurrenceId!, { paidOn: '2026-11-25' }), /already recorded/);
  assert.ok(r.nextOccurrenceId);
  await cancelBill(ctx, id);
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [r.nextOccurrenceId])).length, 0);
  await db.close();
});

test('routines: one record per day, reminders scheduled once and never re-created after delivery', async () => {
  const { db, user } = await setup();
  const u = await user();
  const now = at('2026-11-23T02:00:00Z'); // Monday 07:30 IST
  const ctx = u.ctx(now);
  const { id } = await createRoutine(ctx, u.ws, { title: 'Weekly review', recurrence: { freq: 'weekly', interval: 1, byWeekday: [0] }, timeOfDay: '18:00', startsOn: '2026-11-23', reminderEnabled: true });
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1`, [id])).length, 1);
  assert.equal(await scheduleRoutineReminders(db, now), 0, 'idempotent');
  await deliverDue(db, at('2026-11-23T12:30:00Z'));
  assert.equal(await scheduleRoutineReminders(db, at('2026-11-23T13:00:00Z')), 0, 'no repeat after delivery');
  await recordRoutine(ctx, id, '2026-11-23', 'done');
  await recordRoutine(ctx, id, '2026-11-23', 'skipped');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM routine_occurrences WHERE routine_id = $1`, [id]))[0]!.n, 1);
  await assert.rejects(recordRoutine(ctx, id, '2026-11-24', 'done'), /not scheduled/);
  const [ov] = await routinesOverview(ctx, '2026-11-23', '2026-11-29');
  assert.deepEqual(ov!.occurrences, [{ date: '2026-11-23', status: 'skipped' }]);
  await db.close();
});

test('life events: template checklist, participants, reminder stops when done', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const { id } = await createLifeEvent(ctx, u.ws, { title: 'Goa trip', templateKey: 'travel', startsOn: '2026-12-20', endsOn: '2026-12-23' });
  const items = await checklist(db, u.id, 'life_event', id);
  assert.ok(items.some((i) => i.group_name === 'Packing'));
  await addParticipant(ctx, id, { name: 'Ravi', responsibility: 'Book cabs' });
  assert.equal((await lifeEventDetail(ctx, id)).participants.length, 1);
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [id])).length, 1);
  await setLifeEventStatus(ctx, id, 'done');
  assert.equal((await db.query(`SELECT 1 FROM reminders WHERE target_id = $1 AND status = 'scheduled'`, [id])).length, 0);
  await db.close();
});

test('automations: matching records become proposals once; disabled rules and downgraded plans stop', async () => {
  const { db, user } = await setup();
  const u = await user();
  await devSetPlan(db, u.id, 'plus');
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const p = await createPurchase(ctx, u.ws, { productName: 'Phone', purchaseDate: '2025-11-30' });
  await addWarranty(ctx, p.id, { startsOn: '2025-11-30', endsOn: '2026-11-29' });
  const { id } = await createRule(ctx, u.ws, { name: 'Warranty heads-up', trigger: 'warranty_expiring', conditions: { daysBefore: 7 }, action: 'propose_checklist' });
  assert.equal(await evaluateAutomations(db, at('2026-11-22T05:00:00Z')), 1);
  assert.equal(await evaluateAutomations(db, at('2026-11-22T06:00:00Z')), 0, 'deduplicated');
  assert.equal(((await listProposals(ctx)) as { kind: string }[])[0]!.kind, 'create_checklist');
  await setRuleEnabled(ctx, id, false);
  await db.query(`DELETE FROM action_proposals`);
  assert.equal(await evaluateAutomations(db, at('2026-11-22T07:00:00Z')), 0, 'disabled');
  await setRuleEnabled(ctx, id, true);
  await devSetPlan(db, u.id, 'free');
  assert.equal(await evaluateAutomations(db, at('2026-11-22T08:00:00Z')), 0, 'plan no longer includes automations');
  await db.close();
});

test('calendar: drag-move keeps duration, conflicts are reported, recurring events expand', async () => {
  const { db, user } = await setup();
  const u = await user();
  const ctx = u.ctx(at('2026-11-22T05:00:00Z'));
  const a = (await createEvent(ctx, u.ws, { title: 'Dentist', date: '2026-11-25', startTime: '10:00', endTime: '10:45' })).event;
  const b = await createEvent(ctx, u.ws, { title: 'Bank visit', date: '2026-11-26', startTime: '15:00', endTime: '16:00', bufferMinutes: 15 });
  assert.equal(b.conflicts.length, 0);
  const moved = await moveEvent(ctx, a.id, { date: '2026-11-26', startTime: '15:30' }, a.version);
  assert.equal(new Date(moved.event.ends_at!).getTime() - new Date(moved.event.starts_at!).getTime(), 45 * 60_000);
  assert.deepEqual(moved.conflicts.map((c) => c.title), ['Bank visit']);
  await assert.rejects(moveEvent(ctx, a.id, { date: '2026-11-27' }, a.version), /changed somewhere else/);
  await createEvent(ctx, u.ws, { title: 'Yoga', date: '2026-11-23', startTime: '07:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [0, 2] } });
  const items = await agenda(ctx, '2026-11-23', '2026-11-29');
  assert.deepEqual(items.filter((i) => i.title === 'Yoga').map((i) => i.date), ['2026-11-23', '2026-11-25']);
  assert.equal((await conflicts(db, u.id, new Date('2026-11-26T09:45:00Z'), new Date('2026-11-26T09:50:00Z'), 0)).length, 1);
  await db.close();
});

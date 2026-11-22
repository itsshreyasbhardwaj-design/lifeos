/**
 * Creates a demo account full of clearly fictional data.
 *   pnpm seed:demo            → demo@lifeos.test (password below)
 * Every name, company and amount here is invented. Re-running is safe: it
 * refuses if the demo account already exists.
 */
const { connect } = await import('../packages/core/src/db.ts');
const { register } = await import('../packages/core/src/auth.ts');
const { personalWorkspaceId } = await import('../packages/core/src/access.ts');
const { ctxFor } = await import('../packages/core/src/context.ts');
const { devSetPlan } = await import('../packages/core/src/billing.ts');
const { createTask } = await import('../packages/core/src/tasks.ts');
const { createPromise } = await import('../packages/core/src/promises.ts');
const { createSubscription, createBill } = await import('../packages/core/src/commitments.ts');
const { createPurchase, addWarranty, addReturnWindow } = await import('../packages/core/src/purchases.ts');
const { createCapture, processCapture } = await import('../packages/core/src/captures.ts');
const { createWorkflow, createLifeEvent, createRoutine } = await import('../packages/core/src/planning.ts');
const { createFamily, inviteMember, acceptInvitation, createShoppingList, addShoppingItem } = await import('../packages/core/src/family.ts');
const { createEvent } = await import('../packages/core/src/calendar.ts');
const { todayIn } = await import('../packages/core/src/time.ts');
const { addDays } = await import('../packages/extract/src/index.ts');

export const DEMO_EMAIL = 'demo@lifeos.test';
export const DEMO_PASSWORD = process.env.LIFEOS_DEMO_PASSWORD ?? 'lifeos-demo-2026';

const db = await connect();
if ((await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [DEMO_EMAIL])).length) {
  console.log('Demo account already exists. Run `pnpm db:reset` first for a clean demo.');
  process.exit(0);
}
const s = await register(db, { email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'Demo User (fictional)' });
const ws = await personalWorkspaceId(db, s.userId);
const ctx = ctxFor(db, s.userId);
await devSetPlan(db, s.userId, 'family');
await db.query('UPDATE users SET onboarded_at = now() WHERE id = $1', [s.userId]);
const t = todayIn('Asia/Kolkata');

await createTask(ctx, ws, { title: 'Submit scholarship form (DEMO)', dueDate: t, dueTime: '17:00', priority: 3, reminderOffsets: [0] });
await createTask(ctx, ws, { title: 'Pay rent (DEMO)', dueDate: addDays(t, 5), recurrence: { freq: 'monthly', interval: 1, byMonthDay: Number(addDays(t, 5).slice(8)) }, reminderOffsets: [-1440, 0] });
await createTask(ctx, ws, { title: 'Book train tickets for the trip (DEMO)', dueDate: addDays(t, 2), tags: ['travel'] });
await createTask(ctx, ws, { title: 'Collect laundry (DEMO)', dueDate: addDays(t, -1) });
await createPromise(ctx, ws, { direction: 'waiting_on', description: 'Refund for returned running shoes (DEMO)', counterparty: 'Example Sports Store', expectedBy: addDays(t, -2) });
await createPromise(ctx, ws, { direction: 'i_promised', description: 'Send the signed rental agreement to the landlord (DEMO)', counterparty: 'Mr. Example Landlord', expectedBy: addDays(t, 3) });
await createSubscription(ctx, ws, { name: 'ExampleFlix (DEMO)', amountMinor: 64_900, cycle: 'monthly', nextRenewalDate: addDays(t, 8) });
await createSubscription(ctx, ws, { name: 'Cloud Photos Example (DEMO)', amountMinor: 1_49_000, cycle: 'yearly', nextRenewalDate: addDays(t, 40), trialEndsOn: addDays(t, 4) });
await createBill(ctx, ws, { name: 'Electricity (DEMO)', category: 'electricity', amountMinor: 1_84_200, cycle: 'monthly', nextDueDate: addDays(t, 6) });
const p = await createPurchase(ctx, ws, { productName: 'Example noise-cancelling headphones (DEMO)', merchant: 'Example Electronics', purchaseDate: addDays(t, -3), amountMinor: 14_99_000 });
await addWarranty(ctx, p.id, { startsOn: addDays(t, -3), months: 12 });
await addReturnWindow(ctx, p.id, { deadline: addDays(t, 4) });
await createEvent(ctx, ws, { title: 'Dentist appointment (DEMO)', date: addDays(t, 1), startTime: '11:00', endTime: '11:30', location: 'Example Dental Clinic', remindMinutesBefore: [60] });
await createWorkflow(ctx, ws, { title: 'University application (DEMO)', templateKey: 'university_application', deadline: addDays(t, 25) });
await createLifeEvent(ctx, ws, { title: 'Weekend trip (DEMO)', templateKey: 'travel', startsOn: addDays(t, 12), endsOn: addDays(t, 14), location: 'Example Hills' });
await createRoutine(ctx, ws, { title: 'Weekly review (DEMO)', recurrence: { freq: 'weekly', interval: 1, byWeekday: [6] }, timeOfDay: '18:00' });
const c = await createCapture(ctx, ws, { text: 'DEMO message — Hi parents, reminder: submit the field trip consent form by ' + addDays(t, 6).split('-').reverse().join('/') + '. The annual day rehearsal is on ' + addDays(t, 10).split('-').reverse().join('/') + ' at 4pm in the school hall.' });
await processCapture(db, c.capture.id);

const fam = await createFamily(ctx, 'Demo family (fictional)');
const partner = await register(db, { email: 'partner.demo@lifeos.test', password: DEMO_PASSWORD, displayName: 'Demo Partner (fictional)' });
const inv = await inviteMember(ctx, fam.id, 'partner.demo@lifeos.test', 'adult');
await acceptInvitation(ctxFor(db, partner.userId), inv.token);
await createTask(ctx, fam.id, { title: 'Pick up groceries (DEMO)', assigneeId: partner.userId, dueDate: t, kind: 'family_task' });
const list = await createShoppingList(ctx, fam.id, 'Groceries');
for (const item of ['Milk', 'Rice', 'Tomatoes']) await addShoppingItem(ctx, list.id, item);

await db.close();
console.log(`Demo ready. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD} (or partner.demo@lifeos.test). All data is fictional and marked DEMO.`);

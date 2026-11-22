# Reminder engine

Code: `packages/core/src/reminders.ts`, `worker.ts`.

## Model
A reminder is a row: recipient, target (task, event, promise, warranty, return window, subscription, bill occurrence, document, workflow, routine, life event), kind (one-time, advance, due, follow-up, renewal, expiry, routine), channels, status (`scheduled`, `delivered`, `dismissed`, `completed`, `cancelled`, `failed`), and either a fixed instant or an **anchor** (`anchor_date`, `anchor_time` or the user's default time, `offset_minutes`).

`fire_at` is computed from the anchor in the user's timezone (`time.ts → zonedToUtc`). In a DST gap the time moves forward; in an overlap the earlier instant is used. Changing timezone or default reminder time re-computes every anchored reminder (invariant 23).

## Delivery (`deliverDue`, every 3 s by default)
1. Claim due reminders with `FOR UPDATE SKIP LOCKED` (safe with several workers).
2. If the target is closed (task completed/cancelled, subscription cancelled, bill paid, promise resolved …) → cancel instead of delivering (defence in depth for invariant 6).
3. If inside the user's quiet hours → move to the end of quiet hours, mark `quiet_deferred`.
4. In-app: insert a notification keyed by `reminder:channel:moment` (unique) → delivered.
5. Web push: one attempt row per device keyed the same way; sent **after** the transaction commits.
6. Failed pushes retry with exponential backoff (up to 5 attempts); 404/410 disables that subscription.

## Guarantees (each has a test)
No duplicate delivery on retries or repeated ticks · cancelled/completed targets stop reminders · snooze re-arms the same row (never duplicates the task or reminder) · one live reminder per target/kind/moment · reminders survive restarts (they're rows).

## Features
Snooze (1 hour / tomorrow from the bell; any time via API), dismiss, delivery trail per reminder (`/api/v1/reminders/:id/trail`), quiet hours, per-user default time, history on the task page.

Not implemented: notification grouping (each reminder is its own notification), per-reminder priority, email channel.

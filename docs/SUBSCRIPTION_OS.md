# SubscriptionOS and bills

Code: `packages/core/src/commitments.ts`; UI `/app/subscriptions`, `/app/bills`.

## Subscriptions
Service, category, price + currency, cycle (weekly/monthly/quarterly/yearly), next renewal, trial end, account label, status (trial, active, cancellation pending, cancelled, paused), history (`subscription_events`).
* Reminder 3 days before renewal (configurable) and 2 days before a trial ends.
* **Renewals are not assumed:** when the renewal date passes, the subscription shows "Did it renew?"; only the user's confirmation advances the date (optionally recording a price change).
* **Cancellation is organised, not performed:** "Plan to cancel" adds a checklist (where to cancel, access end, download data, UPI mandate/auto-pay, save confirmation); "It's cancelled" records the date and proof and cancels future reminders (invariant 18 keeps the records).
* Totals per currency (monthly equivalent and yearly), never summed across currencies; items with no price are counted separately.

## Bills
Name, type, payee, amount (or "varies"), currency, cycle (once/monthly/quarterly/yearly), next due date. Each due date is an occurrence (unique per bill and date) with reminders 3 days before and on the day. Display status: upcoming, due, overdue, **paid (you reported)**, cancelled. Reporting a payment cancels that occurrence's reminders and creates the next occurrence once. `verified_paid` exists in the schema for a future authorised source; nothing writes it.

LifeOS does not connect to banks, move money or cancel services.

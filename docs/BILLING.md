# Billing

Code: `packages/core/src/billing.ts`; UI `/app/billing`, `/pricing`.

| Plan | Price (hypothesis) | Features | Limits (configurable) |
|---|---|---|---|
| Free | ₹0 | Tasks, reminders, calendar, capture, search, export, promises, subscriptions & bills, routines, life events | 30 files read/month, 0.5 GB, 200 questions/month |
| Plus | ₹149/mo or ₹1,490/yr | + Purchase Protection, LifeAdmin, LifeGraph explorer, FollowThrough suggestions, automations (25) | 500 files, 10 GB, 2,000 questions |
| Family | ₹299/mo or ₹2,990/yr | + family spaces (2, up to 8 people each) | 1,000 files, 50 GB, 4,000 questions |

Override with `LIFEOS_PLANS_JSON` (deep-merged). A "Power" tier was not added (the specification said to wait for demand).

* **Entitlements are enforced in services**, not by hiding buttons (`requireFeature`, `requireWorkspaceFeature`). Family spaces use the owner's plan.
* **Metering:** `usage_counters` incremented atomically inside the operation's transaction; exceeding a limit rolls back with HTTP 402 `quota_exceeded`. Metered: automatic file reading (per capture with files), storage bytes, assistant questions. If reading quota runs out, the capture is still stored and the user told why nothing was read.
* **Trial:** 14 days, no card, once per account, ends by itself (expiry computed at read time).
* **Cancel/downgrade:** never deletes data; premium records stay readable, creating new ones returns 402 (invariant 18).
* **Razorpay:** `POST /api/v1/webhooks/razorpay` verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body), is idempotent on event id, maps `subscription.*` events to plan status using `notes.lifeos_user_id`/`notes.lifeos_plan`, and only a signed event can activate a paid plan. **Not implemented:** creating Razorpay plans/subscriptions or a checkout page; not tested against Razorpay. No payment is ever fabricated.
* **Development:** `/api/v1/billing/dev-plan` switches plans when `NODE_ENV !== production` or `LIFEOS_ENABLE_DEV_BILLING=1` (used by E2E). Never enable in production.

Not implemented: billing history UI, invoices/GST, proration, annual renewal notices by email.

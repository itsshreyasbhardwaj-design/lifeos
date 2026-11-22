# Product analytics

Code: `packages/core/src/privacy.ts → track()`.

Off by default; recorded only after the user turns on *Product analytics* in Privacy. Events (allow-listed): `capture_created`, `candidate_confirmed`, `candidate_rejected`, `task_completed`, `reminder_created`, `document_retrieved`, `search_performed`, `trial_started`, `plan_cancelled`, `family_task_assigned`, `admin_workflow_created`, `onboarding_completed`. Each event's properties are typed (number, boolean, or a fixed enum); anything else is dropped, so document contents, titles and file names cannot be recorded. The subject is an HMAC of the user id.

`funnel(since)` aggregates counts per event and distinct subjects — enough for first capture, capture→confirmation, first completion, reminder creation, retrieval, trial starts and cancellations. Not implemented: a dashboard UI, retention cohorts, trial-to-paid (no real payments), processing cost per customer (usage counters exist; cost mapping does not).

Feedback (`/app/settings` → Feedback) stores kind + message; users are asked not to paste document contents.

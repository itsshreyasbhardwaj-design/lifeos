# Database

PostgreSQL schema in `packages/core/migrations/0001_init.sql` (57 tables), applied by `packages/core/src/db.ts → migrate()` and tracked in `schema_migrations`.

```bash
pnpm db:migrate     # apply pending migrations (also runs automatically on connect)
pnpm db:reset       # development only: delete the embedded database and re-create it
```

`DATABASE_URL` selects the driver: `postgres://…` → `pg` pool; a path → PGlite data directory (default `data/pglite`); `memory://` → in-memory PGlite (tests).

## Conventions

* Every user-data row carries `workspace_id` (FK, `ON DELETE CASCADE`). Authorization = membership of that workspace, or an unexpired, unrevoked grant (documents only).
* Ids are application-generated prefixed strings (`tsk_…`, `cap_…`, `doc_…`), 100 bits of entropy.
* Money: `bigint` minor units + ISO-4217 `currency`. Never floats, never summed across currencies.
* A date the source didn't state is `NULL`. Date-only values are `date` and are returned to JavaScript as `'YYYY-MM-DD'` strings (custom type parsers on both drivers) so they can't shift by timezone.

## Constraints that enforce product invariants

| Constraint | Invariant |
|---|---|
| `candidate_accept_needs_review` CHECK | A suggestion cannot be `accepted` without `reviewed_at` and a created record |
| `tasks_series_occurrence_key` partial UNIQUE (series_id, occurrence_date) | Recurring tasks never duplicate an occurrence |
| `tasks_client_id_key`, `captures_client_id_key` partial UNIQUE | Offline replays are idempotent |
| `reminders_dedupe_key` partial UNIQUE on scheduled reminders | No duplicate live reminder for the same target/kind/moment |
| `notification_attempts.idempotency_key` UNIQUE, `notifications.idempotency_key` UNIQUE | Delivery retries never double-notify |
| `bill_occurrences` UNIQUE (bill_id, due_date), `routine_occurrences` UNIQUE (routine_id, occurs_on) | No duplicate occurrences |
| `warranties.basis`, `return_windows.basis` CHECK in (user_entered, document_confirmed) | Terms are never "assumed from policy" |
| `bill_occurrences.status` includes `verified_paid` but no code path writes it | "Paid" is user-reported unless an authorised source exists |
| `events_timing` CHECK | All-day events have a date; timed events have ordered start/end |
| `document_access_grants` CHECK exactly one grantee | Grants are to one person or one family space |

## Table groups

Identity (`users`, `sessions`, `api_tokens`, `user_consents`, `rate_limit_buckets`) · Workspaces (`workspaces`, `memberships`, `invitations`) · Capture (`captures`, `capture_files`, `extraction_candidates`) · LifeGraph (`contacts`, `life_links`, `record_history`) · Tasks (`task_lists`, `tasks`, `task_dependencies`, `checklist_items`) · Commitments (`promises`) · Calendar (`calendar_events`, `calendar_imports`) · Reminders (`reminders`, `notification_attempts`, `notifications`, `push_subscriptions`) · Vault (`documents`, `document_versions`, `document_access_grants`) · Purchases (`purchases`, `warranties`, `return_windows`, `service_records`) · Subscriptions & bills (`service_subscriptions`, `subscription_events`, `bills`, `bill_occurrences`) · Planning (`admin_workflows`, `life_events`, `event_participants`, `routines`, `routine_occurrences`) · Family (`shopping_lists`, `shopping_items`, `comments`) · Intelligence (`search_index`, `saved_searches`, `memory_preferences`, `automation_rules`, `action_proposals`) · Billing (`billing_subscriptions`, `usage_counters`, `payment_events`) · Operations (`audit_events`, `background_jobs`, `sync_conflicts`, `product_events`, `feedback`).

Tables from the specification that were **not** created because nothing would use them yet: `profiles` (merged into `users`), `relationship_history` (covered by `record_history`), `extraction_jobs`/`extraction_reviews` (jobs table + candidate review columns + `record_history`), `assistant_conversations` (questions are not stored — privacy), `export_requests`/`deletion_requests` (export and deletion are synchronous), `calendar_integrations`/`sync_records` (no external calendar integration), `workflow_templates` (templates are code), `task_tags` (a `text[]` with the task).

## Search index

`search_index` holds one row per searchable record with a generated `tsvector` combining the `simple` configuration (keeps Hindi/Bengali tokens and reference numbers as written) and `english` (stemming). Services upsert it in the same transaction as the write.

## Indexing note for production

All list queries filter by workspace first; indexes lead with `workspace_id`. If you add row-level security later, keep every index tenant-leading (see [PERFORMANCE.md](PERFORMANCE.md)).

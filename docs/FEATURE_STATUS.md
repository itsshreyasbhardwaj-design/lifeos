# Feature status

Every feature from the specification, classified honestly. **Verified** means an automated test exercises it against real PostgreSQL (unit/integration) and/or in a real browser (E2E); the column says which. Test counts and runs are in [TEST_RESULTS.md](TEST_RESULTS.md).

Legend: ✅ Completed and verified · 🟡 Implemented but unverified · 🟠 Partially implemented · ❌ Not implemented · ⛔ Blocked (needs something outside this build)

## Definition of done (spec Part 40)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Authentication works | ✅ | security suite; every E2E registers through the UI |
| 2 | User accounts persist | ✅ | integration (PGlite on disk in dev/E2E) |
| 3 | Personal workspaces | ✅ | created on registration; all suites |
| 4 | Universal capture | ✅ | E2E A (image), B (PDF), G (offline), extension, share target |
| 5 | OCR and PDF parsing (documented inputs) | ✅ | `ocr.test.ts` (screenshot OCR, PDF text), E2E A/B |
| 6 | Suggested actions reviewable | ✅ | E2E A/B; invariants 1–2 |
| 7 | Confirmed actions persist | ✅ | flow test, E2E A |
| 8 | TaskOS | ✅ | invariants 5–8, E2E A/E |
| 9 | FollowThrough | ✅ | invariants 9/21, Today proposals |
| 10 | Promise Tracker | ✅ | Workflow C (service + E2E) |
| 11 | LifeAdmin | ✅ | Workflow D (service + E2E) |
| 12 | Reminder scheduling | ✅ | flow test, invariants 6/7/23, unit DST tests |
| 13 | Recurrences | ✅ | unit + invariant 5 |
| 14 | Calendar | ✅ | ICS unit tests, agenda in E2E B/F; drag-and-drop 🟡 (manual only) |
| 15 | LifeGraph relationships | ✅ | flow test (source link), E2E A (navigate to source) |
| 16 | Life Vault | ✅ | invariants 11/13, E2E D/E |
| 17 | Purchase Protection | ✅ | Workflow B (service + E2E) |
| 18 | Warranty reminders | ✅ | Workflow B service test |
| 19 | Return reminders | ✅ | Workflow B service test, E2E agenda |
| 20 | Subscription tracking | ✅ | Workflow F (service + E2E) |
| 21 | Bill tracking | 🟡 | service code + UI; covered indirectly (bill extraction unit test, agenda query); no dedicated bill-paid test |
| 22 | FamilyOS | ✅ | Workflow E (service + E2E) |
| 23 | Family permissions | ✅ | invariant 12, cross-family suite, E2E E |
| 24 | Life Events | 🟡 | service + UI, rendered in smoke crawl; no dedicated test |
| 25 | Routine Manager | 🟡 | service + UI; reminder idempotency fix reasoned, not tested |
| 26 | Life Search | ✅ | invariants 14/15, Workflow B, E2E E |
| 27 | Local Life AI | ✅ | Workflows B/C (`ask`), invariant 15 |
| 28 | User-approved automation | 🟠 | proposals + approval/undo verified (invariants 9/21); rule evaluation (`evaluateAutomations`) not tested |
| 29 | Browser extension (documented browsers) | ✅ (Chromium) | E2E extension test; Firefox/Safari ❌ |
| 30 | PWA installability | 🟠 | manifest + service worker verified in Chromium; install prompt and real devices not verified |
| 31 | Offline workflows | ✅ | Workflow G (service + E2E) |
| 32 | Subscription entitlements | ✅ | invariants 18/19, Workflow H |
| 33 | Data export | ✅ | security suite (scope) |
| 34 | Data deletion | ✅ | invariant 16 |
| 35 | Security tests pass | ✅ | `security.test.ts`, E2E security |
| 36 | End-to-end tests pass | see TEST_RESULTS | |
| 37 | Production build succeeds | ✅ | `pnpm build` |
| 38 | Documentation accurate | 🟡 | written against the code; reviewed by the author only |

## By module

| Module | Feature | Status |
|---|---|---|
| Capture | text, notes, paste, files, multiple files, drag/drop, paste images | ✅ |
| | links (fetch + SSRF guard) | 🟡 fetch path not run in tests (guard unit-tested) |
| | voice notes | 🟠 stored, not transcribed |
| | PWA share target | 🟠 endpoint verified; real share sheet not |
| | email forwarding | ❌ |
| | duplicate detection, reprocess, failure survival, manual suggestion | ✅ |
| Extraction | Indian/ISO/written/relative dates, ranges, times, recurrence, money, references, receipts, bills, subscriptions, events, promises | ✅ (unit) |
| | measured accuracy | ❌ no labelled set |
| | Hindi/Bengali text understanding | ❌ |
| | optional AI provider adapters | ❌ |
| | correction learning (merchant → category) | 🟡 |
| LifeGraph | links with provenance, history, related records | ✅ |
| | graph view | 🟡 rendered, not tested |
| | link suggestions / merging | ❌ |
| Tasks | quick add NLP, views, subtasks, checklists, dependencies, bulk, recurrence, assignment | ✅ |
| Calendar | views, overlay, conflicts, ICS import/export | ✅ |
| | drag-and-drop | 🟡 |
| | Google/Outlook | ❌ |
| Reminders | durable, idempotent, snooze, cancel, quiet hours, DST, timezone change | ✅ |
| | in-app channel | ✅ |
| | Web Push | 🟠 crypto verified; device delivery unverified |
| | email / native push | ❌ |
| | grouping, diagnostics UI | 🟠 trail API only |
| Vault | upload, encryption, versions, expiry, sharing, revocation, access log, deletion | ✅ |
| | S3/R2 | ❌ |
| Purchases | purchases, warranties, returns, refunds, service history, claims checklist | ✅ / 🟡 (claims, service not tested) |
| Subscriptions & bills | as above | ✅ / 🟡 |
| LifeAdmin | templates, statuses, evidence, history | ✅ |
| Family | spaces, roles, invites, shared tasks, shopping, comments, activity, sharing | ✅ (shopping/comments 🟡) |
| | minors' consent flow | ⛔ legal |
| Life Events / Routines | | 🟡 |
| Search | full-text, filters, saved searches, permission-scoped | ✅ (saved searches 🟡) |
| | semantic search | ❌ (optional in spec) |
| Life AI | question families, sources, briefings | ✅ / 🟡 (briefings) |
| Life Agent | rules builder, proposals, approval, undo | 🟠 |
| PWA | manifest, SW, offline page, push handler | 🟠 |
| Offline | queued captures/tasks, idempotent sync, conflicts | ✅ (conflict UI ❌) |
| Extension | Chromium MV3 | ✅ |
| i18n | en/hi/bn navigation + core flow | 🟠 (machine-authored, partial coverage) |
| Billing | plans, entitlements, trials, metering, cancel/downgrade | ✅ |
| | Razorpay webhooks | 🟠 verified with local signatures only |
| | Razorpay checkout | ⛔ needs a Razorpay account |
| Privacy | consents, export, deletion, analytics without content | ✅ |
| Marketing | 17 pages, demo, SEO (metadata, sitemap, robots, JSON-LD, OG image) | ✅ (rendered + E2E smoke) |
| Native mobile apps | | ❌ (API is ready; no app) |

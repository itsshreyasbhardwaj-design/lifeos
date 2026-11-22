# LifeOS

**Never forget what matters.** Save anything important — a screenshot, a receipt, a PDF, a message, a link — and LifeOS suggests what it means, asks you to confirm, reminds you at the right time, keeps the action linked to where it came from, and finds it again months later.

```
CAPTURE → UNDERSTAND → CONFIRM → CONNECT → REMIND → FOLLOW THROUGH → COMPLETE → PRESERVE
```

India-first (Indian date formats, ₹ with lakh grouping, Hindi and Bengali interface), private by design, and it runs with **no external services or paid keys**: embedded PostgreSQL, local OCR, deterministic extraction.

> **Status:** an early, working build — not production-ready. What is verified, what is only implemented, and what is missing is listed honestly in [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) and [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## What it does

| | |
|---|---|
| **Life Inbox** | Text, notes, links, screenshots, photos, PDFs, receipts, voice notes, browser extension, PWA share target, offline drafts |
| **Life Intelligence** | Local PDF text + Tesseract OCR; dates (Indian formats, relative, ranges, recurrence), money, merchants, references; suggestions with the source excerpt; asks when a year, time or day/month order is unclear |
| **LifeGraph** | Every record linked to its source and related records, with provenance and history |
| **TaskOS & FollowThrough** | Natural-language quick add, smart views, subtasks, checklists, dependencies, repeats without duplicates, waiting states, approval-gated next-step suggestions |
| **Reminders** | Durable, idempotent, quiet hours, DST/timezone-safe, snooze, in-app + Web Push |
| **Calendar** | Day/week/month/agenda, overlay of every dated commitment, drag-to-reschedule, conflicts, ICS import/export |
| **Purchase Protection** | Purchases, receipts, warranties and return windows from your own documents, refund follow-ups, claim checklists |
| **Subscriptions & bills** | Renewal and trial reminders, user-confirmed renewals, cancellation checklists, user-reported payments |
| **Life Vault** | Encrypted documents, versions, expiry reminders, full-text search, per-document sharing with expiry and revocation, access log |
| **Promise Tracker** | I promised / they promised / waiting on, with follow-ups |
| **LifeAdmin, Life Events, Routines** | Template checklists, honest statuses, packing lists, routines without streaks |
| **FamilyOS** | Family spaces with roles, shared tasks, calendar and shopping, explicit sharing — personal data never exposed |
| **Life AI** | Answers from your own records with sources; briefings; automation rules that only ever propose |
| **SaaS** | Free / Plus / Family plans enforced server-side, trials, metering, Razorpay webhook verification, export and deletion |

## Quick start

```bash
pnpm install
pnpm setup:ocr     # optional, ~11 MB English OCR model for reading images
pnpm dev           # http://localhost:3200
```

Optional fictional demo data: `pnpm seed:demo`, then sign in as `demo@lifeos.test` / `lifeos-demo-2026`.

Requirements: Node ≥ 22.18, pnpm 11. No Docker, database server or API keys.

## Verify

```bash
pnpm verify        # lint, typecheck, unit + integration tests (real PostgreSQL via PGlite), production build
pnpm test:e2e      # Playwright: Workflows A–H, security, PWA, extension (fresh build + throwaway database)
pnpm bench         # measured performance on this machine
```

## Repository

```
apps/web            Next.js app: marketing site, app UI, JSON API (/api/v1), PWA
apps/extension      Manifest V3 browser extension (no host permissions)
packages/extract    Zero-dependency extraction engine
packages/core       Domain services, PostgreSQL schema + migrations, jobs, reminders, auth, billing
workers/background  Standalone worker for PostgreSQL-server deployments
tests/e2e           Playwright end-to-end tests
docs/               Architecture, module docs, status and readiness reports
```

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Security: [SECURITY.md](SECURITY.md).

## Principles

1. Suggestions are not records — you confirm everything.
2. Never guess a year, a time, a warranty or a renewal.
3. Every action remembers its source.
4. Nothing leaves LifeOS on your behalf: no emails sent, no payments, no forms submitted.
5. Family membership never exposes personal records.
6. Your data is yours: export it all, delete it all.

## License

MIT — see [LICENSE](LICENSE).

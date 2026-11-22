# Architecture

LifeOS is a **modular monolith**: one deployable web app, one PostgreSQL schema, and a small set of packages with hard boundaries.

```
lifeos/
├── apps/
│   ├── web/              Next.js 16 (App Router): marketing site, app UI, JSON API (/api/v1), PWA, share target
│   └── extension/        Manifest V3 browser extension (plain JS, no build step)
├── packages/
│   ├── extract/          Zero-dependency extraction engine: dates, money, entities, candidates, quick add
│   └── core/             Domain services, PostgreSQL schema + migrations, jobs, reminders, auth, billing
├── workers/background/   Standalone worker for PostgreSQL-server deployments
├── tests/e2e/            Playwright end-to-end tests (Workflows A–H, security, PWA, extension)
├── scripts/              migrate, seed-demo, setup-ocr, bench, make-icons
└── docs/
```

Packages that the specification suggested but that would have held no independent code (`ui`, `lifegraph`, `task-engine`, `notifications`, …) were not created; that logic lives as modules inside `packages/core` (`links.ts`, `tasks.ts`, `reminders.ts`, `push.ts`). Splitting them later is a mechanical move because each module only imports `db.ts`, `access.ts`, `audit.ts` and `search-index.ts`.

## Request path

```
Browser ──► Next.js page (server component) ──► core service ──► PostgreSQL
   │                                     ▲
   └──► fetch /api/v1/* ──► dispatcher ──┘   (auth · CSRF · rate limit · error mapping)
Extension / future mobile app ──► /api/v1/* with a scoped bearer token
```

* **Server components read through core services directly** with the signed-in user's context. There is no looser path to the database for pages: every service call takes `ctx.userId` and authorises in SQL.
* **All mutations go through `/api/v1`** (`apps/web/src/server/api.ts`): one route table, one place for authentication, CSRF origin checks, rate limits and error mapping. The same API serves the web UI, the extension and any future native app.
* **Background work** (extraction, document OCR, reminder delivery, routine reminders, automation evaluation) runs from a durable job table. With embedded PostgreSQL the web server runs the loop in-process (`instrumentation.ts` → `startWorker`); with a PostgreSQL server, `pnpm worker` runs it separately and several workers can share the table (`FOR UPDATE SKIP LOCKED`).

## Data

* **PostgreSQL** is the only store. Local development and tests use **PGlite** (PostgreSQL 17 compiled to WASM, in-process) so nothing needs installing; production can point `DATABASE_URL` at a PostgreSQL server. The same SQL and migrations run on both. See [DATABASE.md](DATABASE.md).
* **Files** are encrypted before they touch disk (per-file AES-256-GCM key, wrapped by a key derived from `LIFEOS_SECRET`). The `BlobStore` interface is where an S3-compatible adapter would go; only the local adapter exists. See [DOCUMENT_VAULT.md](DOCUMENT_VAULT.md).

## Load-bearing decisions

| Decision | Why |
|---|---|
| Hand-written SQL migrations instead of Drizzle/Prisma | Constraints that enforce invariants (e.g. "an accepted suggestion must have a review") are visible in one file; no generator or extra dependency. The `Db` interface is four methods, so adding an ORM later is possible. |
| PGlite for dev/test | Real PostgreSQL semantics (CHECKs, partial unique indexes, `tsvector`, `SKIP LOCKED`) with zero setup. Tests run against it, not mocks. |
| Deterministic extraction, no LLM | Works without paid keys, runs offline, cannot be prompt-injected, and its output can be explained ("rule `receipt.warranty_term`"). |
| Suggestions, never records | Extraction writes `extraction_candidates` only. Records are created by `confirmCandidate`, which requires a user and refuses incomplete dates. |
| Stored vs derived status | Tasks store what a person sets (open, waiting, completed…). "Overdue", "due", "upcoming" are computed at read time so they can't go stale. |
| Reminders as rows anchored in local time | `fire_at` is recomputed from `(anchor_date, anchor_time, timezone, offset)` so DST and timezone changes keep 09:00 at 09:00. |
| Authorization in SQL | List queries join `memberships`; family membership never reaches a personal workspace; limited members are filtered per row. |

## Runtime constraints worth knowing

* PGlite is **single-process**. The web server holds the only connection (shared across Next.js bundles through `globalThis`); never run `pnpm worker` against the same data directory.
* Next.js `transpilePackages` compiles `@lifeos/core` and `@lifeos/extract` from TypeScript source; PGlite, tesseract.js and unpdf are loaded with bundler-ignored dynamic imports so their WASM assets resolve at runtime.
* Server components cannot pass functions to client components. Forms use `ApiForm` with serialisable props (`extra`, named `transform`, `redirectTo="/x/:id"`).

# Deployment

## Local development (no services needed)
```bash
pnpm install
pnpm setup:ocr          # optional: downloads the English OCR model (~11 MB) for image capture
pnpm dev                # http://localhost:3200 — embedded PostgreSQL in data/pglite
pnpm seed:demo          # optional: fictional demo account demo@lifeos.test / lifeos-demo-2026
```
Requirements: Node ≥ 22.18 (Node 24 used in development), pnpm 11. No Docker, Homebrew, Rust or paid keys.

## Single-node self-hosting (embedded PostgreSQL)
```bash
cp .env.example .env    # set LIFEOS_SECRET (32+ chars) and LIFEOS_PUBLIC_URL
pnpm build && pnpm start
```
The web process runs the background worker in-process. Back up `data/` (database **and** `data/files`, plus `LIFEOS_SECRET` — files cannot be decrypted without it). PGlite is single-process: run exactly one web process per data directory.

## PostgreSQL server (recommended for production)
```bash
DATABASE_URL=postgres://user:pass@host:5432/lifeos pnpm start     # web (migrations run on first connect)
DATABASE_URL=postgres://… LIFEOS_INPROCESS_WORKER=0 pnpm start     # if you prefer a separate worker:
DATABASE_URL=postgres://… pnpm worker
```
The `pg` driver is an optional dependency. **The PostgreSQL-server path has not been exercised in this build** (all automated tests use PGlite, which runs the same SQL). Verify it in staging before relying on it.

## Serverless / scheduled ticks
If the platform can't run a long-lived worker, set `LIFEOS_CRON_SECRET` and call `POST /api/v1/cron/tick` with header `x-cron-secret` every minute.

## Environment
See `.env.example`. Required in production: `LIFEOS_SECRET`. Strongly recommended: `DATABASE_URL` (Postgres), `LIFEOS_PUBLIC_URL`, VAPID keys (`LIFEOS_VAPID_PUBLIC`, `LIFEOS_VAPID_PRIVATE_PEM`, `LIFEOS_VAPID_SUBJECT`), `LIFEOS_TRUST_PROXY=1` behind a reverse proxy, `RAZORPAY_WEBHOOK_SECRET` only once Razorpay is configured.

## Docker
Not provided: this machine has no Docker to verify an image. A Dockerfile would need Node 24, `pnpm install --frozen-lockfile`, `pnpm build`, a volume for `data/`, and `LIFEOS_SECRET`.

## Checklist before going live
See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) and [REMAINING_MANUAL_ACTIONS.md](REMAINING_MANUAL_ACTIONS.md).

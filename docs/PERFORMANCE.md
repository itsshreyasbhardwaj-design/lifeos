# Performance

All numbers below were **measured** on 2026-11-22 on the build machine: Apple M2 (8 cores), 8 GB RAM, macOS (arm64), Node 24.16.0. They are not projections for other hardware. Re-run with `pnpm bench`.

## Server-side operations (`pnpm bench`, embedded PostgreSQL in memory)

| Operation | Result | Notes |
|---|---|---|
| Start embedded PostgreSQL + apply migrations | 1,771 ms | cold, once per process |
| Extraction engine: receipt → candidates | p50 0.1 ms · p95 0.1 ms | n=500 |
| Create task (incl. reminder + search index) | p50 1.7 ms · p95 2.3 ms | n=300 |
| List tasks, "upcoming" view, 2,000 tasks | p50 11.2 ms · p95 12.1 ms | n=50 |
| Full-text search over 2,000 indexed records | p50 1.0 ms · p95 1.1 ms | n=100 |
| Text capture + extraction job | p50 2.6 ms · p95 2.9 ms | n=50 |
| One delivery tick claiming 500 due reminders | 206 ms | 300 task reminders delivered + 200 reminders pointing at missing records cancelled |
| PDF text extraction, 1-page receipt (38 KB) | p50 5.5 ms · p95 97.3 ms | first call loads pdf.js |
| Image OCR, Tesseract WASM, 18 KB screenshot | p50 473 ms · p95 501 ms | includes starting a worker each time |
| Upload 5 MB (validate + encrypt + store) | p50 17.3 ms · p95 23.0 ms | n=5 |

Observed outside the benchmark: the first OCR on a cold process took ~7.5 s (WASM + 11 MB model load); in the running dev server a screenshot capture went from upload to suggestions in ~3 s; E2E Workflow A (register → OCR → confirm → complete) took 3.4–5.2 s per browser.

## Client (production build, measured with Playwright)

| Page | JS transferred (gzip) | DOMContentLoaded | Load |
|---|---|---|---|
| `/` (marketing + live demo) | 152 KB | 96 ms | 216 ms |
| `/login` | 139 KB | 24 ms | 48 ms |
| `/app` (Today) | 164 KB | 117 ms | 117 ms |
| `/app/tasks` | 164 KB | 57 ms | 58 ms |
| `/app/calendar` | 150 KB (sum of the 8 chunks it loads) | 72 ms | 83 ms |

Localhost, warm server, desktop Chromium — no network latency or CPU throttling. All client JS in the build: 775 KB raw / 254 KB gzip across 24 chunks; CSS: 35 KB raw / 7 KB gzip. Icons are the only images; there are no web fonts (system font stack), which helps low-end Android.

## Targets and where they stand

| Target | Goal | Status |
|---|---|---|
| Capture acknowledged | < 300 ms server time | ✅ capture insert is a few ms; files add ~17 ms per 5 MB |
| Text capture → suggestions | < 1 s | ✅ ~3 ms work + up to one worker interval (3 s default; configurable) |
| Image capture → suggestions | < 10 s on a small server | ✅ on M2 (0.5 s warm); **not measured on low-end hardware** |
| Search | < 100 ms at 10k records | ✅ 1 ms at 2k; 10k not measured |
| Reminder lateness | < 1 interval | ✅ by design (3 s polling); not measured under load |
| First-load JS | < 200 KB gzip | ✅ 139–164 KB |
| Low-end Android | usable | ❓ not measured (no device or CPU-throttled run) |

## Not measured
Load/concurrency, PostgreSQL-server latency, low-end devices, slow networks (3G), memory under sustained OCR. Known scaling limits: one Tesseract worker per image (pool needed), PGlite is single-process.

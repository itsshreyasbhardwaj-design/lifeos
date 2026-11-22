# Test results

Run on 2026-11-22, Apple M2 / macOS / Node 24.16.0. Re-run with `pnpm verify` and `pnpm test:e2e`.

## Summary

| Suite | Result |
|---|---|
| Extraction unit tests (`packages/extract`) | **24 / 24 passed** |
| Core unit tests (`units.test.ts`) | **14 / 14 passed** |
| Core integration — capture flow, Workflows B–H, 25 invariants, security, modules, OCR/PDF, DB | **55 / 55 passed** |
| **Unit + integration total** | **93 / 93 passed**, 0 skipped |
| End-to-end (Playwright, production build) | **17 / 17 passed** in one run (1.1 min), 0 retries, 0 flaky |
| Production build (`next build`) | ✅ 50 routes |
| Typecheck (root + web) | ✅ 0 errors |
| Lint (oxlint) | ✅ 0 errors, 14 style warnings |
| Dependency audit (`pnpm audit`) | ✅ No known vulnerabilities |
| GitHub Actions CI (first run, commit `91daa53`) | ✅ verify (Node 22) · verify (Node 24) · e2e — all green on ubuntu-latest |

## End-to-end detail

| Test | Desktop Chromium | Mobile Chromium (Pixel 7) | Mobile WebKit (iPhone 14) |
|---|---|---|---|
| Workflow A — screenshot → OCR → review → confirm → reminder → Today → source → complete | ✅ 3.4 s | ✅ 3.6 s | ✅ 5.2 s |
| Workflow B — receipt PDF → purchase/warranty/return → reminders → search → original | ✅ | — | — |
| Workflow C — promise → follow-up → waiting list → resolve | ✅ | — | — |
| Workflow D — LifeAdmin → documents → steps → evidence → submitted → confirmed → history | ✅ | — | — |
| Workflow E — family invite → assign → complete → share one doc → privacy → revoke | ✅ | — | — |
| Workflow F — subscription → renewal reminder → cancellation → no future reminders | ✅ | — | — |
| Workflow G — offline capture → reconnect → synced once | ✅ | — | — |
| Workflow H — trial → premium → server entitlement → downgrade keeps data | ✅ | — | — |
| Security — 401s, CSRF, cross-user page/API/search, headers | ✅ | — | — |
| PWA — manifest/share target, service worker active, share endpoint | ✅ | — | — |
| i18n — Hindi navigation | ✅ | — | — |
| Marketing pages + interactive demo | ✅ | ✅ | ✅ |
| Browser extension — scoped token, note, task | ✅ | — | — |

Mobile projects are **device emulation** in Playwright (viewport, user agent, touch) — not real phones.

## Bugs the test runs found (all fixed)
1. Workflow A/B: `tesseract.js` and `unpdf` (loaded at runtime) could not be resolved from the Next.js build because pnpm's strict layout didn't expose them to `apps/web`; a stuck OCR job then blocked the single worker loop, delaying reminders. Fixed: direct dependencies, separate job/reminder loops, job and OCR timeouts.
2. Workflows E–H: without a trusted proxy every client was rate-limited as one IP ("local") — would have throttled all real users after 10 sign-ups an hour.
3. Eight screens crashed at runtime because server components passed functions to a client form component (types couldn't see it); found by a page crawl.
4. Quick add "pay rent on the 5th of every month" created a task with no date, so it never repeated.
5. Dark-mode contrast on highlights/buttons; card overflow at 375 px.
6. Stale `$2` parameter type in task views; a wrong alias in the calendar bill overlay; an analytics-free comma expression.

## Not covered
See [TESTING.md](TESTING.md#what-is-not-tested-automatically).

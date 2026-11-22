# Production readiness

**Verdict: not ready for a public launch.** It is a working, well-tested v0.1 suitable for a private beta on a single node with trusted users — after the "before any deployment" items below.

## Ready
* Core flows work end to end in real browsers (desktop Chromium; phone emulation in Chromium and WebKit for the capture→reminder→complete flow).
* All 25 specified invariants have passing tests against real PostgreSQL semantics.
* Authorization model (personal vs family, limited role, grants) tested for leakage.
* Files encrypted at rest; SSRF, upload, CSRF, session and webhook protections tested.
* Production build succeeds; CSP and security headers set.
* Export and deletion work.

## Must fix before real users
| Item | Why | Ref |
|---|---|---|
| Run on a PostgreSQL server and test it | PGlite is single-process; the `pg` path is untested | KNOWN_ISSUES #1 |
| Email channel (verification, reset, invites) | Users can't recover accounts | #2 |
| Legal review + DPDP compliance + children's consent | Handles personal documents of Indian users | #4 |
| Backups & restore runbook, secret management | Files are unreadable without `LIFEOS_SECRET` | DEPLOYMENT |
| HTTPS + trusted proxy config | Cookies are `Secure`; IP rate limits need it | DEPLOYMENT |

## Should fix before charging money
Razorpay checkout and tested activation · GST invoices · billing history · price validation.

## Should fix before scale
OCR worker pool · nonce CSP · PostgreSQL connection tuning · observability (structured logs, error tracking, uptime) · load test · extraction accuracy evaluation.

## Operational facts
* Default workers: jobs and reminders each poll every 3 s; reminder delivery claims up to 200 per tick.
* Measured performance: see [PERFORMANCE.md](PERFORMANCE.md).
* Dependency audit: see [TEST_RESULTS.md](TEST_RESULTS.md).

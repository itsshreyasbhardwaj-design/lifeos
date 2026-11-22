# Security

See also the repository-level [SECURITY.md](../SECURITY.md) for reporting.

## Controls
| Area | Implementation | Tested |
|---|---|---|
| Passwords | Argon2id (19 MiB, t=2) | unit |
| Sessions | Hashed 256-bit tokens, HttpOnly/SameSite=Lax, sliding expiry, revocation, other sessions revoked on password change | security suite |
| MFA | TOTP with encrypted secret; pending sessions authorise nothing | security suite |
| API tokens | Hashed, scoped, revocable | security suite |
| Authorization | Workspace membership in every query; non-members get 404 (no id probing); limited role filtered per row | cross-user + cross-family suites, E2E |
| Family privacy | Personal workspace unreachable via family membership | invariants 11–15, E2E Workflow E |
| CSRF | Origin/Sec-Fetch-Site check on cookie-authenticated mutations; SameSite=Lax | E2E |
| CORS | Only extension origins, only token requests, no credentials | E2E (extension) |
| Rate limiting | Postgres-backed per account/IP for login, register, MFA, capture, ask, export | security suite (login) |
| Uploads | Magic-byte sniffing; HTML/SVG/executables refused; type mismatch refused; 20 MB cap; safe file names; served with `CSP: sandbox`, `nosniff`, attachment for downloads | unit |
| SSRF | URL capture: http(s) on 80/443 only, no credentials, all resolved addresses checked against private/loopback/link-local/CGNAT/metadata/mapped ranges, connection pinned to the checked IP, redirects re-validated, size/time caps. Push endpoints limited to vendor push hosts | unit |
| Files at rest | Envelope encryption (AES-256-GCM, per-file keys) | unit (tamper detection) |
| Prompt injection | Extraction is rules-only; captured text cannot trigger actions | unit + security suite |
| Billing | Webhooks require valid HMAC; idempotent by event id; entitlements checked server-side | security suite, invariants 18–19 |
| Headers | CSP (no `unsafe-eval` in production), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, referrer policy, permissions policy | E2E |
| Audit | Sign-ins, failures, document views/downloads/shares/revocations, plan changes, deletions, task status changes, proposal execution | invariant 20 |

## Known gaps
* CSP allows `'unsafe-inline'` for scripts and styles (Next.js inline runtime). A nonce-based CSP is the next step.
* No email verification or password reset (no email channel).
* No external penetration test has been performed. Dependency audit: see [TEST_RESULTS.md](TEST_RESULTS.md).
* `LIFEOS_SECRET` rotation tooling (re-wrapping file keys) is not written.

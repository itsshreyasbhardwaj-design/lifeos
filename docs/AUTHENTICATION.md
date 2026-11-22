# Authentication

Implemented in `packages/core/src/auth.ts`; HTTP glue in `apps/web/src/server/api.ts` and `session.ts`.

* **Passwords:** Argon2id via `@noble/hashes` (pure JS) at the OWASP floor (19 MiB, t=2, p=1). Minimum 10 characters. A dummy hash keeps login timing the same for unknown emails.
* **Sessions:** random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production unless `LIFEOS_INSECURE_COOKIES=1`). Only `sha256(token)` is stored. 30-day sliding expiry (refreshed at most every 10 minutes). Sessions are listed and revocable in Settings; changing the password signs out every other session.
* **Two-step verification:** TOTP (RFC 6238, verified against the RFC test vector). The secret is stored encrypted. A login for an MFA account creates a *pending* session that authorises nothing until `/auth/mfa` succeeds.
* **API tokens:** `lfo_…` bearer tokens with scopes (`capture:write`, `tasks:write`, `read`), stored hashed, revocable, `last_used_at` recorded. Used by the browser extension; the basis for native apps.
* **Rate limits** (Postgres-backed, survive restarts): 8 failed logins per account per 15 min, 40 per IP; 10 registrations per IP per hour; 6 MFA attempts per session per 15 min. Client IP is only taken from `X-Forwarded-For` when `LIFEOS_TRUST_PROXY=1`.
* **CSRF:** cookie-authenticated non-GET API requests must carry an `Origin` matching the host (or `Sec-Fetch-Site: same-origin`); otherwise 403. Bearer-token requests carry no ambient credentials and are exempt. Session cookies are `SameSite=Lax`.
* **Authorization** is not part of authentication: every service call authorises against workspace membership — see [SECURITY.md](SECURITY.md).

Not implemented: email verification, password reset by email (no email channel), OAuth/social sign-in, WebAuthn/passkeys.

# Known issues and limitations

Honest list as of the v0.1 build. Severity: **H** blocks a real launch, **M** noticeable, **L** minor.

| # | Sev | Issue |
|---|---|---|
| 1 | H | **PostgreSQL-server driver untested.** All automated tests run on PGlite. The `pg` path shares the SQL but has never connected to a real server in this build. |
| 2 | H | **No email channel**: no email verification, password reset, invitation emails or email reminders. Invitations are links the inviter sends. |
| 3 | H | **Payments not live.** Razorpay webhook verification exists; checkout/subscription creation does not. Paid plans can only be reached via trial or the dev switch. |
| 4 | H | **Legal review missing.** Privacy policy and terms are drafts; DPDP Act 2023 obligations (notice, consent records, grievance officer, children's verifiable parental consent) are not reviewed or implemented. |
| 5 | M | **Hindi and Bengali strings are machine-authored** and cover navigation and the core capture→review→today flow only; other screens are English. Not yet reviewed by native speakers. |
| 6 | M | **Extraction rules are English-only.** Hindi/Bengali text in captures is stored and searchable but not interpreted. Only Devanagari/Bengali digits are normalised. |
| 7 | M | **No measured extraction accuracy.** There is no labelled evaluation set; unit tests cover representative cases only. |
| 8 | M | **OCR cost:** each image starts a Tesseract worker (~2–8 s on an M-series Mac, longer on small servers). Fine for a single node; a worker pool is needed at scale. OCR is English-only by default (`pnpm setup:ocr hin ben` adds models, not tested). |
| 9 | M | **Web Push delivery not verified on real devices**; encryption/VAPID verified by tests only. iOS requires Home Screen install. |
| 10 | M | **Share target and PWA install not tested on real Android/iOS devices.** |
| 11 | M | CSP permits `'unsafe-inline'` scripts/styles (Next.js runtime). Nonce-based CSP not done. |
| 12 | M | Embedded PostgreSQL is single-process: one web process per data directory, no horizontal scaling without a PostgreSQL server. |
| 13 | M | Voice notes are stored without transcription. |
| 14 | L | Offline mode doesn't show existing records (by design: nothing personal is cached); offline task drafts arrive as Inbox notes. Sync-conflict resolution is API-only (no screen). |
| 15 | L | Recurring calendar events can't have single-occurrence exceptions; ICS `EXDATE` is reported and ignored. |
| 16 | L | Notifications are not grouped; no per-reminder priority. |
| 17 | L | Contacts/organisations exist in the schema but have no screens; no automatic link suggestions or record merging in LifeGraph. |
| 18 | L | Account deletion is immediate; there's no grace period/undo. Audit/analytics retention periods are not set. |
| 19 | L | `LIFEOS_SECRET` rotation tool (re-wrap file keys) not written. |
| 20 | L | Migration `0001_init.sql` was edited during initial development; any local database created earlier must be reset (`pnpm db:reset`). Future changes must be new migrations. |
| 21 | L | No Dockerfile (no Docker on the build machine to verify one). |
| 22 | L | Lint has style warnings (unnecessary escapes in regexes, intentional control-character regexes). |

# Next steps

Ordered by what most reduces launch risk.

1. **Run against a real PostgreSQL server** in CI (service container) — the whole suite, plus `pnpm worker` as a separate process. Fix anything PGlite tolerated.
2. **Email channel** (SMTP adapter behind an interface): verification, password reset, invitation delivery, optional email reminders with consent.
3. **Legal & compliance**: lawyer-reviewed privacy policy and terms; DPDP Act notice/consent records, grievance contact, data-retention schedule; verifiable parental consent before allowing minors.
4. **Extraction evaluation set**: 200+ invented-but-realistic Indian receipts, bills, school messages and renewal emails with expected candidates; report precision/recall per field in CI; regressions fail the build.
5. **Payments**: Razorpay plan/subscription creation + hosted checkout, webhook-driven activation (already implemented), invoices with GST, billing history page; test in Razorpay test mode.
6. **Real-device testing**: Android Chrome (install, share target, push), iPhone Home Screen PWA (push), low-end Android performance profile.
7. **Native-speaker review** of Hindi/Bengali; extend translations to all screens; Hindi date words in extraction.
8. **OCR worker pool** and a queue concurrency setting; image downscaling before OCR.
9. **Nonce-based CSP**; secret rotation tooling; external penetration test.
10. Optional AI adapter (user-configured, consent-gated), using the same candidate/review contract.
11. Google/Outlook calendar import via OAuth (read-only first).
12. S3/R2 `BlobStore` adapter; Dockerfile; backup/restore runbook.

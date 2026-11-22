# Remaining manual actions

Things a person has to do — they need accounts, money, legal judgement, devices or decisions that an automated build can't make.

## Before any public deployment
- [ ] Choose hosting and provision **PostgreSQL** (and run the test suite against it — see NEXT_STEPS #1).
- [ ] Generate and store `LIFEOS_SECRET` in a secret manager; back it up separately from the database (files are unreadable without it).
- [ ] Generate VAPID keys for push and set `LIFEOS_VAPID_*`; set `LIFEOS_PUBLIC_URL`.
- [ ] Put the app behind HTTPS with a reverse proxy; set `LIFEOS_TRUST_PROXY=1` so IP rate limits apply.
- [ ] Set up backups of PostgreSQL and the file store; test a restore.
- [ ] Decide the license (MIT chosen for consistency with other repos; AGPL-3.0 would require hosted forks to publish changes).

## Legal (India-first)
- [ ] Lawyer review of `/privacy-policy` and `/terms` (both marked draft).
- [ ] DPDP Act 2023: notice, consent records, grievance officer contact, retention schedule, breach process.
- [ ] Children: verifiable parental consent flow before minors may sign up.
- [ ] Trademark check for "LifeOS" (it is a common name).

## Payments
- [ ] Create a Razorpay account (business KYC), plans for Plus/Family monthly/yearly, webhook endpoint `https://<host>/api/v1/webhooks/razorpay`, and set `RAZORPAY_KEY_ID`/`RAZORPAY_WEBHOOK_SECRET`.
- [ ] Implement checkout (not built) and test in Razorpay test mode.
- [ ] GST registration/invoicing decisions.

## Product
- [ ] Native-speaker review of Hindi and Bengali strings.
- [ ] Real-device tests: Android Chrome (install, share sheet, push), iPhone PWA (push after Home Screen install).
- [ ] Publish the browser extension to the Chrome Web Store (developer account, privacy disclosures) if wanted.
- [ ] Set a public support/contact address on `/contact`.
- [ ] Validate pricing hypotheses (₹149 / ₹299) with real users before charging.

## Repository
- [ ] Create the GitHub repository and push (not done without your go-ahead), then confirm CI runs green.

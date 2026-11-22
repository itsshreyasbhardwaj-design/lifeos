# Security policy

LifeOS stores personal documents and commitments, so security reports are welcome and taken seriously.

## Reporting
Please **do not open a public issue**. Use GitHub's private vulnerability reporting ("Report a vulnerability" on the Security tab of this repository). Include steps to reproduce and the impact you expect. We aim to acknowledge within 5 working days.

## Scope
In scope: authentication and sessions, authorization between users and family spaces, file storage and sharing, the API, the browser extension, SSRF in link capture, the service worker, billing webhooks.

Please don't access other people's data, degrade service for others, or run automated scanners against instances you don't own.

## Design notes
The controls and their tests are listed in [docs/SECURITY.md](docs/SECURITY.md).

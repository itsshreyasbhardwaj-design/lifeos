# Privacy

* **Collected:** account details, what the user captures, confirmed records, reminders and their delivery status, security audit events. Not collected: passwords for other services, payment card data, government portal credentials, messages from other apps (only what the user pastes or shares).
* **Processing:** all text extraction and OCR happen on the LifeOS server. No content goes to an external AI service. Captured links are fetched once by the server. Push payloads are end-to-end encrypted to the device.
* **Consent:** `product_analytics`, `external_ai_processing`, `email_notifications`, `push_notifications` — all default **off**. Analytics events are allow-listed names with typed properties (numbers, booleans, enums) under an HMAC pseudonym; free text cannot be recorded (invariant 24, tested).
* **Family:** see [FAMILY_OS.md](FAMILY_OS.md). Sharing is explicit, per document, revocable.
* **Children:** no profiling, advertising, covert tracking or location. Minor accounts can't be adults in family spaces. Verifiable parental consent is **not implemented** — required before onboarding minors in India (DPDP Act 2023) and elsewhere.
* **Export:** a ZIP of every record the user created (JSON) and their original files, decrypted (`/api/v1/privacy/export`). Records others created in shared spaces are not included.
* **Deletion (invariant 16):** immediate and irreversible after password + email confirmation. Refused while the user owns a family space with other members. Deletes the personal workspace, its records and files; removes family memberships (family records they authored stay with the author cleared); audit rows are kept with the actor and metadata removed.
* **Retention:** audit events and anonymised product events are kept indefinitely in this build — a retention schedule should be set before launch.
* **Local device:** offline drafts sit in IndexedDB until synced; nothing else personal is cached by the service worker.

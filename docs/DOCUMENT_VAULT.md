# Life Vault

Code: `packages/core/src/documents.ts`, `storage.ts`, `crypto.ts`; UI `/app/vault`.

* **Upload** images, PDFs and text (magic-byte validated, 20 MB default, HTML/SVG/executables refused). Titles, categories, tags, issuer, issued/expiry dates, notes, sensitive flag.
* **Encryption at rest:** each file gets a random 256-bit key (AES-256-GCM); that key is wrapped with a key derived (HKDF) from `LIFEOS_SECRET`. Rotating the secret means re-wrapping 32-byte keys. Files are served only through `/api/v1/files/document/:id` after an access check, with `Content-Security-Policy: sandbox` and `nosniff`.
* **Versions:** upload new versions; all kept and listed.
* **Text extraction** runs as a background job so PDFs and images are searchable.
* **Expiry reminders** 30 and 7 days before.
* **Duplicate detection** by content hash, reported not merged.
* **Sharing:** one document at a time, to a person who shares a family space with you or to a whole family space; view-only or download; optional expiry; revocable; enforced at read time (invariants 11, 13). View-only hides download and serves inline — anyone who can view can still save what they see, and the UI says so.
* **Access history:** every view/download is in the audit log, shown to the owner.
* **Deletion** removes every version from disk and frees storage quota.

Not implemented: S3/R2 adapter (the `BlobStore` interface is ready), public share links, field masking for ID numbers inside files, DigiLocker (uploads are never presented as verified records).

# Life Inbox (Universal Capture)

Code: `packages/core/src/captures.ts`, UI `apps/web/src/components/capture.tsx`, `app/app/inbox/*`.

## Ways in
| Method | Status |
|---|---|
| Text, quick note, pasted message | Implemented, E2E-verified |
| Links (fetched once, SSRF-guarded) | Implemented, unit-tested guard; URL fetching is disabled in E2E runs |
| Screenshots / images (local OCR) | Implemented, E2E-verified (Chromium, WebKit, mobile Chromium projects) |
| PDFs (text layer) / receipts | Implemented, E2E-verified |
| Multiple files per capture (up to 10), drag & drop, paste images | Implemented |
| Voice notes (MediaRecorder → audio file) | Stored only; **no transcription** |
| Browser extension (page, selection, link, note, task) | Implemented, E2E-verified for note/task |
| PWA share target (`/share`) | Implemented, endpoint E2E-verified; not tested from a real phone share sheet |
| Offline drafts (IndexedDB queue) | Implemented, E2E-verified |
| Email forwarding | Not implemented |

## Lifecycle
`received → queued → processing → review_required | extracted → confirmed | organized → archived`, or `failed`. The capture row and its files are written **before** any reading happens; `processCapture` never throws for content problems — it records `failed` with the reason and the original stays (invariant 3). "Read again" re-queues it; older pending suggestions are marked `superseded`.

## Duplicates
Each capture stores a SHA-256 over its text, URL and file hashes; each file stores its own hash. A repeat is reported to the user (`similar`, `duplicateFiles`) and both copies are kept — nothing is merged (invariant 4). Offline/extension retries carry a `clientId` and return the original capture instead of creating another.

## Review
The review screen shows the original (image, PDF, audio, text) with the exact excerpts each suggestion came from highlighted, editable suggestion cards, flagged fields with pickers (year choosers, day/month alternatives, amount choices, promise direction), a "Remind me" toggle, and "Add your own" for when nothing was found. Confirming creates the record, links it to the capture (`derived_from`), and records who confirmed what in the capture's history.

## Deletion policy (invariant 25)
Deleting a capture deletes its files and pending suggestions. Records already confirmed from it are **kept** (they were confirmed facts) and their source reference is cleared. Receipts saved to the Vault have their own encrypted copy.

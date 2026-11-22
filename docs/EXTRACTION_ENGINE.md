# Extraction engine

`packages/extract` — zero runtime dependencies, deterministic, runs on the server and in the browser (the marketing demo uses it client-side).

## Pipeline
1. **Validate** (upload sniffing in `core/files.ts`) → 2. **Read text** (`core/ocr.ts`: PDF text via unpdf/pdf.js; images via Tesseract WASM with a locally stored model; plain text) → 3. **Normalise** (Devanagari/Bengali digits → ASCII, whitespace) → 4. **Dates/times/ranges/recurrence** (`dates.ts`) → 5. **Money** (`money.ts`) → 6. **Entities**: merchants, organisations, titled people, references, locations (`entities.ts`) → 7. **Classify** the document (receipt, subscription notice, bill, appointment, travel, certificate, policy, message) → 8. **Candidates** with evidence excerpts and offsets, flagged uncertainties and rule provenance (`candidates.ts`) → 9. **User review** → 10. **Confirmed records** (`core/captures.ts → confirmCandidate`).

## Dates — the rules
* Formats: ISO (`2026-11-22`, `…T10:30`), numeric `22/11/2026`, `22-11-26`, `22.11.2026`, written (`22 Nov 2026`, `22nd of November`, `November 22, 2026`, with weekdays), month–year (`March 2027`), ranges (`3–5 Dec 2026`, `Dec 3-5`), relative (`today`, `tomorrow`, `day after tomorrow`, `next Friday`, `by Friday`, `in 3 days`, `within 5-7 business days`, `next week`, `end of month`), times (`5pm`, `5:30 PM`, `17:30`, `noon`) and time ranges.
* **No invented years:** `3 December` returns `{y: null}` and an uncertainty; confirmation is refused until a year is chosen.
* **No invented times:** date-only stays date-only. Reminders for date-only items fire at the user's *own* default reminder time, and the UI says so.
* **Ambiguous numerics:** `04/05/2027` is flagged with both readings; the user's date-order setting (DMY for India) picks the primary one.
* **Relative dates** record their anchor (source date if given, else capture date). `next Friday` offers both plausible Fridays.
* Invalid dates (`31/02/2027`) are rejected, not rolled over.

## What becomes what
| Signal | Candidate |
|---|---|
| Receipt/invoice | purchase (product, seller, date, amount, order ref) + warranty **only if a term is written** + return window **only if a policy is written** — all citing the same source |
| Renewal / trial notice | subscription (name, price, cycle, renewal, trial end) |
| Bill / statement | bill (biller, category, amount due, due date) |
| Appointment wording + date, or a timed date | event |
| "last date / deadline / before" + date | deadline |
| Imperative or "remind me to" | task (with recurrence if written) |
| "we will refund…", "expected delivery" | promise: waiting_on |
| "I will…" / "we will…" | promise with a *direction* uncertainty |
| Certificate / policy / ticket with "valid till" | document with expiry |

Derived values are flagged, e.g. a warranty end computed from "1 year warranty" + purchase date carries `derived_from_term`; a return deadline counted from delivery vs purchase carries `window_start` with both alternatives.

## Correction learning
When a user corrects a purchase category, `memory_preferences` stores `merchant_category:<merchant>` for that user only and pre-fills it next time. Nothing trains a global model.

## Prompt injection
The engine is rules over text; instructions inside a capture are inert text. Tests assert that an injection payload creates nothing and only yields pending suggestions.

## Accuracy evidence
24 unit tests on representative inputs (see `packages/extract/test/extract.test.ts`) and E2E runs on a real screenshot (OCR) and a real PDF receipt. **There is no measured accuracy figure on a labelled corpus**; building one is listed in [NEXT_STEPS.md](NEXT_STEPS.md). Rules are English-language; Hindi/Bengali *text* is searchable but not interpreted.

## Optional AI providers
Not implemented. The design keeps model output in the same candidate shape so any future adapter would still pass through review; the `external_ai_processing` consent exists and is off.

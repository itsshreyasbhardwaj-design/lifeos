# Life AI

Code: `packages/core/src/intelligence.ts`; UI `/app/ai`, ask box on `/app/search`.

**Everything here is local and deterministic.** No language model is called. Answers are assembled from the user's own authorised records and always list those records as sources; if nothing matches, the answer says so. Questions are not stored.

Supported question families: what to do today/tomorrow/this week/next week (agenda + overdue) · what am I waiting for · what did I promise · warranty end for a product, or warranties ending soon · open returns/refunds · subscriptions renewing in a period · bills due · documents expiring · unfinished household tasks · anything else → ranked keyword search over receipts/documents/captures with the caveat "keyword matches, not a confirmed answer".

Briefings (`/app/briefings`): daily, weekly and monthly summaries built from the calendar overlay, important unfinished tasks, and admin completed this month — no productivity scores or streaks.

Personal memory: `memory_preferences` holds user-approved preferences (currently merchant → category learned from corrections). Default reminder time, quiet hours and date order are explicit settings.

Not implemented: an external/local LLM adapter, conversational follow-ups, rephrasing. The `external_ai_processing` consent exists and defaults off.

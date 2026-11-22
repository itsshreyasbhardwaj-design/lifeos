# TaskOS

Code: `packages/core/src/tasks.ts`, `recurrence.ts`; quick add in `packages/extract/src/quickadd.ts`.

* **Quick add** in plain words with a live preview: "Remind me to submit the form next Friday at 5pm #school !!" → title, date, time, tags, priority; ambiguities shown before saving. A repeat with no start ("pay rent on the 5th of every month") starts at its first occurrence computed from the rule. A bare time with no day is flagged, not dated.
* Lists, tags, priorities (0–3), due date + optional time, start date, estimates, notes, subtasks, checklists, dependencies, attachments via links, completion history.
* **Smart views:** Today (incl. overdue), Tomorrow, This week, Upcoming, Overdue, Waiting, No date, Assigned to me, Completed, All. Filter by list/tag/text, sort by due/priority/created/title, bulk complete/reschedule/cancel.
* **Recurrence** (`recurrence.ts`): daily/weekly/monthly/yearly with interval, weekdays, day of month, until, count. Month-end clamps (31st → 28/29/30), 29 Feb → 28 Feb in non-leap years. Completing or skipping an occurrence creates the next one **exactly once** — enforced by a unique index on (series, occurrence date), so reopening and re-completing, retries or concurrent requests can't duplicate.
* **Concurrency:** every task has a `version`; edits can pass `expectedVersion` and get 409 instead of overwriting. Offline edits use this (see [OFFLINE_SYNC.md](OFFLINE_SYNC.md)).
* Reminders: `reminder_offsets` (minutes relative to the due moment) are copied to each new occurrence.

# Routines

Code: `packages/core/src/planning.ts`; UI `/app/routines`.

Daily, weekdays, chosen weekdays or monthly; optional time and reminders. Each day is recorded as done or skipped (unique per day — recording twice updates); pause, resume, archive. Reminders are scheduled for the next 48 hours by an idempotent hourly job that never re-creates a reminder for an occurrence that already had one or was already recorded.

Deliberately absent: streaks, scores, "missed" counters. Skipping is a normal choice.

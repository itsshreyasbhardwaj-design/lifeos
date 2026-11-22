# Life Calendar

Code: `packages/core/src/calendar.ts`, `ics.ts`; UI `/app/calendar`.

* **Views:** day, week (hour grid), month, 30-day agenda.
* **Events:** appointments (fixed), hard deadlines, flexible plans, time blocks; all-day or timed; timezone stored per event; buffer minutes; daily/weekly/monthly/yearly repeats; reminders 15 min / 1 h / 1 day before.
* **Overlay:** task due dates, bill due dates, subscription renewals and trial ends, warranty ends, return deadlines, document expiries, life events, LifeAdmin deadlines and promises' expected dates are computed into the calendar at read time — never copied, so they can't disagree with the record.
* **Drag and drop:** non-recurring events move to another day (month) or hour (week), keeping their duration, with version checks; overlay deadlines only move by editing their record.
* **Conflicts:** creating or moving a timed event returns overlapping events (buffers included) as a warning; nothing is blocked.
* **ICS import:** VEVENTs with `DTSTART/DTEND` (UTC, TZID, floating, all-day with exclusive end), `SUMMARY`, `DESCRIPTION`, `LOCATION`, `RRULE` (FREQ, INTERVAL, BYDAY without ordinals, BYMONTHDAY, COUNT, UNTIL). Re-importing updates by UID instead of duplicating. Unsupported content (EXDATE, positional BYDAY like `2TU`, overridden instances) is reported as a warning, never silently dropped.
* **ICS export:** RFC 5545 with escaping and 75-octet folding.
* **External calendars are never modified.** Google/Outlook sync is not implemented.

Not implemented: recurring-event exceptions (edit one occurrence), time-blocking suggestions/auto-scheduling.

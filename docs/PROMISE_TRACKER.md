# Promise Tracker / WaitingOS

Code: `packages/core/src/promises.ts`, UI `/app/promises`.

Directions: **I promised**, **they promised**, **waiting on**. Fields: description, counterparty, recorded date, expected-by, notes, status (`open`, `fulfilled`, `not_fulfilled`, `cancelled`), resolution note, source capture.

* A follow-up reminder is scheduled on the expected date (or a chosen follow-up date); more can be added.
* Resolving cancels pending follow-ups; reopening allows new ones.
* Overdue items appear on Today and in "What am I waiting for?" answers, and feed FollowThrough suggestions.
* Captured messages like "your refund will be processed within 5–7 business days" become waiting-on suggestions; "I'll send it by Friday" carries a direction uncertainty because the author can't be known from text.

Status is always what the user reports. Counterparties are free text the user typed — LifeOS stores nothing about other people beyond that.

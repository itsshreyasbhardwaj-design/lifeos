# FollowThrough

Code: `packages/core/src/tasks.ts` (lifecycle), `intelligence.ts` (suggestions, proposals).

## States
Stored: `open`, `in_progress`, `waiting` (with `waiting_on` and `waiting_since`), `completed`, `cancelled`, `skipped` (recurring occurrences), `archived`. Derived at read time: due, overdue, upcoming, scheduled. "Suggested" and "needs confirmation" are extraction candidates; "rescheduled" is a history event. Transitions are validated (e.g. a completed task can be reopened or archived, not set to waiting).

## Features
Subtasks, checklists, dependencies (cycle-checked; a task can't be completed while a dependency is open), completion notes and evidence links, reopening, assignment with accept/decline in family spaces, history, comments.

## Suggestions (proposals)
`suggestNextActions` creates pending proposals from confirmed facts: an overdue "they promised/waiting on" item → follow-up task; a return window closing within 3 days → "decide whether to return"; a task waiting 7+ days → chase reminder. Each carries its evidence and a dedupe key so it's suggested once. Approving re-validates the stored payload with zod (invariant 21), executes only inside LifeOS, and allows undo for 24 hours. There is no proposal kind that sends messages, pays, submits or cancels anything (invariants 9–10). Refund follow-ups offer a copy-only message draft.

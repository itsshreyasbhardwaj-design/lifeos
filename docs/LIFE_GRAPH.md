# LifeGraph

Code: `packages/core/src/links.ts`, UI on every record page ("Source & connections") and `/app/graph`.

Every link row has: source record, target record, relation (`derived_from`, `receipt_for`, `warranty_of`, `return_window_of`, `refund_follow_up_for`, `service_of`, `evidence_for`, `follow_up_for`, `part_of`, …), workspace, timestamp, creator and **provenance** (`confirmed_extraction` with the candidate and capture ids, `user`, or `system`). A unique key stops duplicate links; self-links are refused.

Links are created automatically when the user confirms a suggestion (record → capture), saves a receipt (document → purchase), adds a warranty/return/service record, starts a refund follow-up, approves a FollowThrough proposal, or attaches evidence to a workflow/event/task. Adding and removing links is recorded in `record_history`.

`neighbours()` returns linked records with titles, filtered to workspaces the viewer can fully read. The graph view (Plus) draws up to 60 nodes radially with a plain list beside it; the list on each record is the primary navigation.

Not implemented: automatic *suggestions* of links between existing records (e.g. "this receipt looks like that purchase"), merging records, contacts as a first-class UI (the `contacts` table exists but has no screens).

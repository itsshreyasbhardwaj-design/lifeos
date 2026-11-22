# Life Search

Code: `packages/core/src/search.ts`, `search-index.ts`; UI `/app/search`.

* One PostgreSQL full-text index (`search_index`) for tasks, captures (including OCR text), documents (including extracted text), purchases, warranties, return windows, subscriptions, bills, promises, calendar events, workflows, life events, routines and shopping items. Updated in the same transaction as each write.
* Prefix matching ("inv" finds "invoice"), `simple` + `english` configurations, ranked with `ts_rank_cd`, highlighted snippets. Filters: type, date range, workspace. Saved searches.
* **Authorization is in the query** (invariants 14/15): eligible rows are those in workspaces where the caller is a full member, documents granted to them (unexpired, unrevoked), and — for limited members — only tasks assigned to them and shopping items.

Not implemented: semantic/vector search (the specification made it optional; no external vector DB is required), fuzzy matching of misspellings (would need `pg_trgm`).

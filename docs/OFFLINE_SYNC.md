# Offline sync

Client: `apps/web/src/lib/offline.ts`; server: `packages/core/src/sync.ts`, `captures.ts`.

* While offline (or when a request fails with a network error), captures — **including files, stored as Blobs** — and quick-added tasks are queued in IndexedDB with a client id. The offline page can add drafts too.
* On the `online` event (and on app load) the queue is replayed. Captures post to `/api/v1/captures` with the client id; tasks go through `/api/v1/sync`. The server treats `(workspace, user, client id)` as an idempotency key (unique index), so replays — including two tabs flushing at once — never duplicate. Items leave IndexedDB only after the server accepts them.
* `/api/v1/sync` also accepts `task.update` and `task.status` with the version the change was based on. If the server version moved, nothing is overwritten: a `sync_conflicts` row is stored with both payloads and the user chooses "keep mine" or "keep server" (invariant 17).

Limits: records are not cached for offline *reading* (privacy choice); offline task drafts arrive as Inbox notes to review rather than as tasks; conflict resolution UI is API-level (`/api/v1/sync/conflicts`) with no dedicated screen yet.

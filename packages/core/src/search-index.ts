/**
 * Keeps the unified search index in step with records. Services call
 * `indexRecord` in the same transaction as the write, so search cannot show
 * a record that was rolled back or miss one that was committed.
 */
import type { Queryable } from './db.ts';

export interface IndexEntry {
  entityType: string;
  entityId: string;
  workspaceId: string;
  title: string;
  body?: string | null;
  occursOn?: string | null;
  status?: string | null;
}

export async function indexRecord(q: Queryable, e: IndexEntry): Promise<void> {
  await q.query(
    `INSERT INTO search_index (entity_type, entity_id, workspace_id, title, body, occurs_on, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, title = EXCLUDED.title,
       body = EXCLUDED.body, occurs_on = EXCLUDED.occurs_on, status = EXCLUDED.status, updated_at = now()`,
    [e.entityType, e.entityId, e.workspaceId, e.title.slice(0, 500), (e.body ?? '').slice(0, 20_000), e.occursOn ?? null, e.status ?? null],
  );
}

export async function unindexRecord(q: Queryable, entityType: string, entityId: string): Promise<void> {
  await q.query('DELETE FROM search_index WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
}

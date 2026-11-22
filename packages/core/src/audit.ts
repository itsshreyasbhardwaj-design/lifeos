import type { Queryable } from './db.ts';

export interface AuditEntry {
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Never put document contents or free text here — ids, counts and enums only. */
  meta?: Record<string, unknown>;
}

export async function audit(q: Queryable, e: AuditEntry): Promise<void> {
  await q.query('INSERT INTO audit_events (workspace_id, actor_id, action, entity_type, entity_id, meta) VALUES ($1,$2,$3,$4,$5,$6)', [
    e.workspaceId ?? null, e.actorId ?? null, e.action, e.entityType ?? null, e.entityId ?? null, JSON.stringify(e.meta ?? {}),
  ]);
}

/** Version history of a record: what changed, by whom. Shown in the record's history panel. */
export async function recordHistory(
  q: Queryable,
  h: { workspaceId: string; entityType: string; entityId: string; action: string; changes?: Record<string, unknown>; actorId: string | null },
): Promise<void> {
  await q.query('INSERT INTO record_history (workspace_id, entity_type, entity_id, action, changes, actor_id) VALUES ($1,$2,$3,$4,$5,$6)', [
    h.workspaceId, h.entityType, h.entityId, h.action, JSON.stringify(h.changes ?? {}), h.actorId,
  ]);
}

export async function historyFor(q: Queryable, entityType: string, entityId: string) {
  return q.query<{ action: string; changes: Record<string, unknown>; actor_id: string | null; actor_name: string | null; at: Date }>(
    `SELECT h.action, h.changes, h.actor_id, u.display_name AS actor_name, h.at
       FROM record_history h LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.entity_type = $1 AND h.entity_id = $2 ORDER BY h.at, h.id`,
    [entityType, entityId],
  );
}

/** Field-level diff for history entries. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

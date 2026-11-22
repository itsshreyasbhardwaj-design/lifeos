/**
 * LifeGraph: typed, provenance-carrying links between records.
 *
 * A link says *why* two things are connected (derived_from, receipt_for,
 * warranty_of, follow_up_for …) and *who* said so (extraction the user
 * confirmed, the user directly, or the system as a side effect).
 */
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';
import { recordHistory } from './audit.ts';
import { invalid } from './errors.ts';

export type NodeType =
  | 'capture' | 'task' | 'calendar_event' | 'document' | 'purchase' | 'warranty' | 'return_window' | 'service_record'
  | 'subscription' | 'bill' | 'promise' | 'contact' | 'admin_workflow' | 'life_event' | 'routine' | 'reminder';

export const RELATIONS = [
  'derived_from', 'receipt_for', 'warranty_of', 'return_window_of', 'refund_follow_up_for', 'service_of', 'reminder_for',
  'evidence_for', 'document_for', 'related_to', 'follow_up_for', 'part_of', 'promised_by', 'involves', 'renewal_of', 'invoice_for',
] as const;
export type Relation = (typeof RELATIONS)[number];

export interface Provenance {
  source: 'confirmed_extraction' | 'user' | 'system';
  candidateId?: string;
  captureId?: string;
  note?: string;
}

export async function link(
  q: Queryable,
  l: { workspaceId: string; fromType: NodeType; fromId: string; toType: NodeType; toId: string; relation: Relation; provenance: Provenance; actorId: string | null },
): Promise<string | null> {
  if (!RELATIONS.includes(l.relation)) throw invalid('Unknown relationship type.');
  const id = newId('lnk');
  const rows = await q.query<{ id: string }>(
    `INSERT INTO life_links (id, workspace_id, from_type, from_id, to_type, to_id, relation, provenance, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (from_type, from_id, to_type, to_id, relation) DO NOTHING RETURNING id`,
    [id, l.workspaceId, l.fromType, l.fromId, l.toType, l.toId, l.relation, JSON.stringify(l.provenance), l.actorId],
  );
  if (rows[0]) {
    await recordHistory(q, { workspaceId: l.workspaceId, entityType: l.fromType, entityId: l.fromId, action: 'link_added', changes: { relation: l.relation, to: `${l.toType}:${l.toId}`, provenance: l.provenance.source }, actorId: l.actorId });
  }
  return rows[0]?.id ?? null;
}

export async function unlink(q: Queryable, workspaceId: string, linkId: string, actorId: string): Promise<void> {
  const rows = await q.query<{ from_type: string; from_id: string; to_type: string; to_id: string; relation: string }>(
    'DELETE FROM life_links WHERE id = $1 AND workspace_id = $2 RETURNING from_type, from_id, to_type, to_id, relation', [linkId, workspaceId],
  );
  const r = rows[0];
  if (r) await recordHistory(q, { workspaceId, entityType: r.from_type, entityId: r.from_id, action: 'link_removed', changes: { relation: r.relation, to: `${r.to_type}:${r.to_id}` }, actorId });
}

export interface LinkedRecord {
  linkId: string;
  direction: 'out' | 'in';
  relation: string;
  type: string;
  id: string;
  title: string | null;
  provenance: Provenance;
  createdAt: Date;
}

/**
 * Records connected to one node, with titles resolved from the search index.
 * Only links inside workspaces the viewer can read are returned; the caller
 * has already authorised the node itself.
 */
export async function neighbours(q: Queryable, viewerId: string, type: string, id: string): Promise<LinkedRecord[]> {
  return q.query<LinkedRecord>(
    `WITH ws AS (SELECT workspace_id FROM memberships WHERE user_id = $3 AND role <> 'limited')
     SELECT l.id AS "linkId", 'out' AS direction, l.relation, l.to_type AS type, l.to_id AS id, si.title, l.provenance, l.created_at AS "createdAt"
       FROM life_links l LEFT JOIN search_index si ON si.entity_type = l.to_type AND si.entity_id = l.to_id
      WHERE l.from_type = $1 AND l.from_id = $2 AND l.workspace_id IN (SELECT workspace_id FROM ws)
     UNION ALL
     SELECT l.id, 'in', l.relation, l.from_type, l.from_id, si.title, l.provenance, l.created_at
       FROM life_links l LEFT JOIN search_index si ON si.entity_type = l.from_type AND si.entity_id = l.from_id
      WHERE l.to_type = $1 AND l.to_id = $2 AND l.workspace_id IN (SELECT workspace_id FROM ws)
     ORDER BY "createdAt"`,
    [type, id, viewerId],
  );
}

/** Two-hop neighbourhood for the optional graph view. */
export async function graph(q: Queryable, viewerId: string, workspaceId: string, limit = 300) {
  return q.query<{ id: string; from_type: string; from_id: string; to_type: string; to_id: string; relation: string; from_title: string | null; to_title: string | null }>(
    `SELECT l.id, l.from_type, l.from_id, l.to_type, l.to_id, l.relation, a.title AS from_title, b.title AS to_title
       FROM life_links l
       LEFT JOIN search_index a ON a.entity_type = l.from_type AND a.entity_id = l.from_id
       LEFT JOIN search_index b ON b.entity_type = l.to_type AND b.entity_id = l.to_id
      WHERE l.workspace_id = $1 AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role <> 'limited')
      ORDER BY l.created_at DESC LIMIT $3`,
    [workspaceId, viewerId, limit],
  );
}

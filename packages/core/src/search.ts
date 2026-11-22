/**
 * Life Search: one PostgreSQL full-text index over every record type.
 *
 * Authorization is part of the query (invariants 14 and 15): a row is only
 * eligible if it sits in a workspace where the caller is a full member, is a
 * document granted to them, or — for limited members — is a task assigned to
 * them or a shopping item. There is no "search everything, filter later".
 */
import type { Queryable } from './db.ts';
import type { Ctx } from './context.ts';

export const LINKS: Record<string, (id: string) => string> = {
  task: (id) => `/app/tasks/${id}`,
  capture: (id) => `/app/inbox/${id}`,
  document: (id) => `/app/vault/${id}`,
  purchase: (id) => `/app/purchases/${id}`,
  warranty: () => `/app/purchases`,
  return_window: () => `/app/purchases`,
  subscription: (id) => `/app/subscriptions#${id}`,
  bill: (id) => `/app/bills#${id}`,
  promise: (id) => `/app/promises#${id}`,
  calendar_event: (id) => `/app/calendar?event=${id}`,
  admin_workflow: (id) => `/app/admin/${id}`,
  life_event: (id) => `/app/events/${id}`,
  routine: (id) => `/app/routines#${id}`,
  shopping_item: () => `/app/family`,
};

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  snippet: string;
  occursOn: string | null;
  status: string | null;
  workspaceId: string;
  workspaceName: string;
  link: string;
  rank: number;
}

export interface SearchFilters {
  types?: string[];
  from?: string;
  to?: string;
  workspaceIds?: string[];
  limit?: number;
}

/** Builds a prefix tsquery from free text: "lapt rece" matches "laptop receipt". */
export function prefixQuery(text: string): string | null {
  const words = (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 0).slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => `${w}:*`).join(' & ');
}

const STOP = new Set(['my', 'the', 'a', 'an', 'is', 'where', 'what', 'which', 'when', 'find', 'show', 'me', 'i', 'do', 'does', 'of', 'for', 'to', 'in', 'on', 'did']);

export async function search(ctx: Ctx, text: string, filters: SearchFilters = {}, q: Queryable = ctx.db): Promise<SearchHit[]> {
  const meaningful = text.split(/\s+/).filter((w) => !STOP.has(w.toLowerCase())).join(' ');
  const pq = prefixQuery(meaningful || text);
  if (!pq) return [];
  return q.query<SearchHit>(
    `WITH full_ws AS (SELECT workspace_id FROM memberships WHERE user_id = $1 AND role <> 'limited'),
          limited_ws AS (SELECT workspace_id FROM memberships WHERE user_id = $1 AND role = 'limited'),
          granted AS (
            SELECT g.document_id FROM document_access_grants g
             WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > $7)
               AND (g.grantee_user_id = $1 OR g.grantee_workspace_id IN (SELECT workspace_id FROM full_ws)))
     SELECT s.entity_type AS type, s.entity_id AS id, s.title,
            ts_headline('simple', s.body, to_tsquery('simple', $2), 'MaxWords=18, MinWords=6, ShortWord=2, StartSel=«, StopSel=»') AS snippet,
            s.occurs_on::text AS "occursOn", s.status, s.workspace_id AS "workspaceId", w.name AS "workspaceName",
            ts_rank_cd(s.tsv, to_tsquery('simple', $2)) AS rank
       FROM search_index s JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.tsv @@ to_tsquery('simple', $2)
        AND (
          s.workspace_id IN (SELECT workspace_id FROM full_ws)
          OR (s.entity_type = 'document' AND s.entity_id IN (SELECT document_id FROM granted))
          OR (s.workspace_id IN (SELECT workspace_id FROM limited_ws) AND (
                s.entity_type = 'shopping_item'
                OR (s.entity_type = 'task' AND s.entity_id IN (SELECT id FROM tasks WHERE assignee_id = $1))))
        )
        AND ($3::text[] IS NULL OR s.entity_type = ANY($3))
        AND ($4::date IS NULL OR s.occurs_on >= $4)
        AND ($5::date IS NULL OR s.occurs_on <= $5)
        AND ($6::text[] IS NULL OR s.workspace_id = ANY($6))
      ORDER BY rank DESC, s.updated_at DESC
      LIMIT $8`,
    [ctx.userId, pq, filters.types?.length ? filters.types : null, filters.from ?? null, filters.to ?? null, filters.workspaceIds?.length ? filters.workspaceIds : null, ctx.now, Math.min(filters.limit ?? 30, 100)],
  ).then((rows) => rows.map((r) => ({ ...r, rank: Number(r.rank), link: (LINKS[r.type] ?? (() => '/app'))(r.id) })));
}

export async function saveSearch(ctx: Ctx, name: string, query: string, filters: SearchFilters = {}) {
  const { newId } = await import('./ids.ts');
  const id = newId('svs');
  await ctx.db.query('INSERT INTO saved_searches (id, user_id, name, query, filters) VALUES ($1,$2,$3,$4,$5)', [id, ctx.userId, name.slice(0, 80), query.slice(0, 500), JSON.stringify(filters)]);
  return { id };
}

export async function savedSearches(ctx: Ctx) {
  return ctx.db.query('SELECT id, name, query, filters FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC', [ctx.userId]);
}

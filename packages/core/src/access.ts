/**
 * Authorization. One rule: a row is visible if you belong to its workspace with
 * a role that allows it, or you hold a live grant to it. Family membership never
 * reaches into anyone's personal workspace.
 */
import type { Queryable } from './db.ts';
import { forbidden, notFound } from './errors.ts';

export type Role = 'owner' | 'adult' | 'member' | 'limited';
export type Permission = 'read' | 'write' | 'manage_members' | 'invite' | 'share_documents' | 'read_documents';

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ['read', 'write', 'manage_members', 'invite', 'share_documents', 'read_documents'],
  adult: ['read', 'write', 'invite', 'share_documents', 'read_documents'],
  member: ['read', 'write', 'read_documents'],
  // Limited members (e.g. a child or a household helper) see shopping lists and
  // the tasks assigned to them, nothing else. Enforced per query in services.
  limited: [],
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[role].includes(perm);
}

export interface Membership {
  workspaceId: string;
  kind: 'personal' | 'family';
  name: string;
  role: Role;
}

export async function memberships(q: Queryable, userId: string): Promise<Membership[]> {
  return q.query<Membership>(
    `SELECT w.id AS "workspaceId", w.kind, w.name, m.role
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 ORDER BY (w.kind = 'personal') DESC, w.created_at`,
    [userId],
  );
}

export async function roleIn(q: Queryable, userId: string, workspaceId: string): Promise<Role | null> {
  const rows = await q.query<{ role: Role }>('SELECT role FROM memberships WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
  return rows[0]?.role ?? null;
}

/**
 * Throws not_found for non-members (so ids cannot be probed) and forbidden
 * for members whose role lacks the permission.
 */
export async function requireRole(q: Queryable, userId: string, workspaceId: string, perm: Permission | 'member'): Promise<Role> {
  const role = await roleIn(q, userId, workspaceId);
  if (!role) throw notFound('Workspace');
  if (perm !== 'member' && !can(role, perm)) throw forbidden();
  return role;
}

export async function personalWorkspaceId(q: Queryable, userId: string): Promise<string> {
  const rows = await q.query<{ id: string }>(`SELECT id FROM workspaces WHERE owner_id = $1 AND kind = 'personal'`, [userId]);
  if (!rows[0]) throw notFound('Personal workspace');
  return rows[0].id;
}

/**
 * Loads a row by id and checks the caller may act on it. Returns the row.
 * `table` must be a trusted literal — never user input.
 */
export async function loadScoped<T extends { workspace_id: string }>(
  q: Queryable,
  userId: string,
  table: string,
  id: string,
  perm: Permission,
  what = 'Record',
): Promise<T & { _role: Role }> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('bad table');
  const rows = await q.query<T>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) throw notFound(what);
  const role = await roleIn(q, userId, row.workspace_id);
  if (!role) throw notFound(what);
  if (role === 'limited') {
    // Limited members may act only on tasks assigned to them and shopping lists.
    const t = row as unknown as { assignee_id?: string };
    const allowed = (table === 'tasks' && t.assignee_id === userId) || table === 'shopping_lists' || table === 'shopping_items';
    if (!allowed) throw notFound(what);
    return { ...row, _role: role };
  }
  if (!can(role, perm)) throw forbidden();
  return { ...row, _role: role };
}

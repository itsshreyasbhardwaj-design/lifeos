/**
 * FamilyOS. A family is its own workspace. Joining one gives access to what is
 * *in* it — shared tasks, the shared calendar, shopping lists, documents
 * explicitly shared into it — and nothing from anyone's personal space.
 */
import { z } from 'zod';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { newId, newToken } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { type Role, loadScoped, requireRole, roleIn } from './access.ts';
import { plans, planOf, requireFeature } from './billing.ts';
import { sha256 } from './crypto.ts';
import { indexRecord } from './search-index.ts';

export async function createFamily(ctx: Ctx, name: string): Promise<{ id: string }> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw invalid('Name the family space.');
  return withTx(ctx.db, async (tx) => {
    await requireFeature(tx, ctx.userId, 'family', ctx.now);
    const owned = (await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM workspaces WHERE owner_id = $1 AND kind = 'family'`, [ctx.userId]))!.n;
    const limit = (await planOf(tx, ctx.userId, ctx.now)).limits.family_workspaces;
    if (owned >= limit) throw invalid(`Your plan includes ${limit} family space${limit === 1 ? '' : 's'}.`);
    const id = newId('wsp');
    await tx.query(`INSERT INTO workspaces (id, kind, name, owner_id) VALUES ($1,'family',$2,$3)`, [id, clean, ctx.userId]);
    await tx.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [id, ctx.userId]);
    await audit(tx, { actorId: ctx.userId, workspaceId: id, action: 'family.created' });
    return { id };
  });
}

export const INVITE_DAYS = 7;

export async function inviteMember(ctx: Ctx, workspaceId: string, email: string, role: Exclude<Role, 'owner'>): Promise<{ id: string; token: string; expiresAt: Date }> {
  const e = z.string().trim().toLowerCase().email('Enter a valid email.').parse(email);
  if (!['adult', 'member', 'limited'].includes(role)) throw invalid('Unknown role.');
  return withTx(ctx.db, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'invite');
    const ws = await one<{ kind: string; owner_id: string }>(tx, 'SELECT kind, owner_id FROM workspaces WHERE id = $1', [workspaceId]);
    if (ws?.kind !== 'family') throw invalid('Only family spaces have members.');
    const max = plans()[(await planOf(tx, ws.owner_id, ctx.now)).id].limits.family_members;
    const count = (await one<{ n: number }>(tx, `SELECT (SELECT count(*) FROM memberships WHERE workspace_id = $1) + (SELECT count(*) FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS n`, [workspaceId]))!.n;
    if (Number(count) >= max) throw invalid(`This family space can have up to ${max} people.`);
    const member = await one(tx, 'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND lower(u.email) = $2', [workspaceId, e]);
    if (member) throw conflict('That person is already a member.');
    const token = newToken('inv_');
    const id = newId('inv');
    const expiresAt = new Date(ctx.now.getTime() + INVITE_DAYS * 86_400_000);
    await tx.query('INSERT INTO invitations (id, workspace_id, email, role, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, workspaceId, e, role, sha256(token), ctx.userId, expiresAt]);
    await audit(tx, { actorId: ctx.userId, workspaceId, action: 'family.invited', meta: { role } });
    // LifeOS does not send email in this build: the inviter shares the link.
    return { id, token, expiresAt };
  });
}

export async function invitationInfo(q: Queryable, token: string) {
  return one<{ id: string; workspace_name: string; inviter: string | null; role: string; email: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>(
    q,
    `SELECT i.id, w.name AS workspace_name, u.display_name AS inviter, i.role, i.email, i.expires_at, i.accepted_at, i.revoked_at
       FROM invitations i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN users u ON u.id = i.invited_by WHERE i.token_hash = $1`,
    [sha256(token)],
  );
}

export async function acceptInvitation(ctx: Ctx, token: string): Promise<{ workspaceId: string }> {
  return withTx(ctx.db, async (tx) => {
    const inv = await one<{ id: string; workspace_id: string; email: string; role: Role; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>(tx, 'SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
    if (!inv || inv.revoked_at) throw notFound('Invitation');
    if (inv.accepted_at) throw invalid('This invitation was already used.');
    if (new Date(inv.expires_at).getTime() < ctx.now.getTime()) throw invalid('This invitation has expired. Ask for a new one.');
    const u = await one<{ email: string; is_minor: boolean }>(tx, 'SELECT email, is_minor FROM users WHERE id = $1', [ctx.userId]);
    if (u!.email.toLowerCase() !== inv.email.toLowerCase()) throw forbidden('This invitation was sent to a different email address.');
    // Accounts marked as belonging to a minor can only hold limited or member roles.
    const role: Role = u!.is_minor && inv.role === 'adult' ? 'member' : inv.role;
    await tx.query('INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inv.workspace_id, ctx.userId, role]);
    await tx.query('UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1', [inv.id, ctx.userId]);
    await audit(tx, { actorId: ctx.userId, workspaceId: inv.workspace_id, action: 'family.joined', meta: { role } });
    return { workspaceId: inv.workspace_id };
  });
}

export async function revokeInvitation(ctx: Ctx, invitationId: string): Promise<void> {
  const inv = await one<{ workspace_id: string }>(ctx.db, 'SELECT workspace_id FROM invitations WHERE id = $1', [invitationId]);
  if (!inv) throw notFound('Invitation');
  await requireRole(ctx.db, ctx.userId, inv.workspace_id, 'invite');
  await ctx.db.query('UPDATE invitations SET revoked_at = now() WHERE id = $1', [invitationId]);
}

export async function members(ctx: Ctx, workspaceId: string) {
  const role = await requireRole(ctx.db, ctx.userId, workspaceId, 'member');
  const people = await ctx.db.query<{ user_id: string; display_name: string; role: Role; joined_at: Date; email: string | null }>(
    `SELECT m.user_id, u.display_name, m.role, m.joined_at, CASE WHEN $2 THEN u.email ELSE NULL END AS email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.joined_at`,
    [workspaceId, role === 'owner' || role === 'adult'],
  );
  const invites = role === 'owner' || role === 'adult'
    ? await ctx.db.query(`SELECT id, email, role, expires_at, created_at FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at`, [workspaceId])
    : [];
  return { role, people, invites };
}

export async function changeRole(ctx: Ctx, workspaceId: string, userId: string, role: Exclude<Role, 'owner'>): Promise<void> {
  await requireRole(ctx.db, ctx.userId, workspaceId, 'manage_members');
  const cur = await roleIn(ctx.db, userId, workspaceId);
  if (!cur) throw notFound('Member');
  if (cur === 'owner') throw invalid('The owner’s role cannot be changed.');
  const minor = (await one<{ is_minor: boolean }>(ctx.db, 'SELECT is_minor FROM users WHERE id = $1', [userId]))?.is_minor;
  if (minor && role === 'adult') throw invalid('A minor’s account cannot hold the adult role.');
  await ctx.db.query('UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId, role]);
  await audit(ctx.db, { actorId: ctx.userId, workspaceId, action: 'family.role_changed', meta: { from: cur, to: role } });
}

/**
 * Removing someone (or leaving) takes effect on the next request: access is
 * checked against memberships on every query, and grants made *to* the family
 * space stop reaching them immediately. Tasks assigned to them are unassigned.
 */
export async function removeMember(ctx: Ctx, workspaceId: string, userId: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    if (userId !== ctx.userId) await requireRole(tx, ctx.userId, workspaceId, 'manage_members');
    const cur = await roleIn(tx, userId, workspaceId);
    if (!cur) throw notFound('Member');
    if (cur === 'owner') throw invalid('The owner cannot leave. Delete the family space instead.');
    await tx.query('DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
    await tx.query(`UPDATE tasks SET assignee_id = NULL, assignment_status = NULL WHERE workspace_id = $1 AND assignee_id = $2`, [workspaceId, userId]);
    await tx.query(`UPDATE reminders SET status = 'cancelled', cancel_reason = 'member_removed' WHERE workspace_id = $1 AND user_id = $2 AND status = 'scheduled'`, [workspaceId, userId]);
    await tx.query(`UPDATE document_access_grants SET revoked_at = now() WHERE grantee_user_id = $1 AND revoked_at IS NULL AND document_id IN (SELECT id FROM documents WHERE workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = $2))`, [userId, ctx.userId]);
    await audit(tx, { actorId: ctx.userId, workspaceId, action: userId === ctx.userId ? 'family.left' : 'family.member_removed' });
  });
}

export async function deleteFamily(ctx: Ctx, workspaceId: string): Promise<void> {
  const role = await requireRole(ctx.db, ctx.userId, workspaceId, 'manage_members');
  if (role !== 'owner') throw forbidden();
  const ws = await one<{ kind: string }>(ctx.db, 'SELECT kind FROM workspaces WHERE id = $1', [workspaceId]);
  if (ws?.kind !== 'family') throw invalid('Only family spaces can be deleted here.');
  await withTx(ctx.db, async (tx) => {
    await tx.query('DELETE FROM search_index WHERE workspace_id = $1', [workspaceId]);
    await tx.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await audit(tx, { actorId: ctx.userId, workspaceId, action: 'family.deleted' });
  });
}

// ------------------------------------------------------------------ shopping

export async function createShoppingList(ctx: Ctx, workspaceId: string, name: string) {
  await requireRole(ctx.db, ctx.userId, workspaceId, 'write');
  const id = newId('shl');
  await ctx.db.query('INSERT INTO shopping_lists (id, workspace_id, name, created_by) VALUES ($1,$2,$3,$4)', [id, workspaceId, name.trim().slice(0, 80) || 'Shopping', ctx.userId]);
  return { id };
}

async function listRole(ctx: Ctx, listId: string) {
  const l = await one<{ workspace_id: string; name: string }>(ctx.db, 'SELECT workspace_id, name FROM shopping_lists WHERE id = $1 AND archived_at IS NULL', [listId]);
  if (!l) throw notFound('List');
  const role = await roleIn(ctx.db, ctx.userId, l.workspace_id);
  if (!role) throw notFound('List');
  return l;
}

/** Limited members can add and tick items — shopping is the one thing they can change. */
export async function addShoppingItem(ctx: Ctx, listId: string, label: string, quantity?: string | null) {
  const l = await listRole(ctx, listId);
  const clean = label.trim().slice(0, 200);
  if (!clean) throw invalid('What do you need?');
  const id = newId('shi');
  await ctx.db.query('INSERT INTO shopping_items (id, list_id, workspace_id, label, quantity, added_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, listId, l.workspace_id, clean, quantity?.slice(0, 40) ?? null, ctx.userId]);
  await indexRecord(ctx.db, { entityType: 'shopping_item', entityId: id, workspaceId: l.workspace_id, title: clean, body: `${l.name} shopping list` });
  return { id };
}

export async function toggleShoppingItem(ctx: Ctx, itemId: string, done: boolean) {
  const it = await one<{ list_id: string }>(ctx.db, 'SELECT list_id FROM shopping_items WHERE id = $1', [itemId]);
  if (!it) throw notFound('Item');
  await listRole(ctx, it.list_id);
  await ctx.db.query(`UPDATE shopping_items SET done = $2, done_by = CASE WHEN $2 THEN $3 ELSE NULL END, done_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`, [itemId, done, ctx.userId]);
}

export async function shoppingLists(ctx: Ctx, workspaceId?: string) {
  const lists = await ctx.db.query<{ id: string; name: string; workspace_id: string; workspace_name: string }>(
    `SELECT l.id, l.name, l.workspace_id, w.name AS workspace_name FROM shopping_lists l JOIN memberships m ON m.workspace_id = l.workspace_id AND m.user_id = $1 JOIN workspaces w ON w.id = l.workspace_id
      WHERE l.archived_at IS NULL AND ($2::text IS NULL OR l.workspace_id = $2) ORDER BY l.created_at`,
    [ctx.userId, workspaceId ?? null],
  );
  const items = lists.length
    ? await ctx.db.query<{ id: string; list_id: string; label: string; quantity: string | null; done: boolean; added_by_name: string | null }>(
        `SELECT i.id, i.list_id, i.label, i.quantity, i.done, u.display_name AS added_by_name FROM shopping_items i LEFT JOIN users u ON u.id = i.added_by WHERE i.list_id = ANY($1) ORDER BY i.done, i.created_at`,
        [lists.map((l) => l.id)],
      )
    : [];
  return lists.map((l) => ({ ...l, items: items.filter((i) => i.list_id === l.id) }));
}

export async function clearDoneItems(ctx: Ctx, listId: string) {
  await listRole(ctx, listId);
  await ctx.db.query('DELETE FROM search_index WHERE entity_type = $1 AND entity_id IN (SELECT id FROM shopping_items WHERE list_id = $2 AND done)', ['shopping_item', listId]);
  await ctx.db.query('DELETE FROM shopping_items WHERE list_id = $1 AND done', [listId]);
}

// ------------------------------------------------------------------ comments & activity

const COMMENTABLE: Record<string, string> = { task: 'tasks', calendar_event: 'calendar_events', life_event: 'life_events', admin_workflow: 'admin_workflows', shopping_list: 'shopping_lists' };

export async function addComment(ctx: Ctx, entityType: string, entityId: string, body: string) {
  const table = COMMENTABLE[entityType];
  if (!table) throw invalid('Comments are not available here.');
  const row = await loadScoped<{ workspace_id: string }>(ctx.db, ctx.userId, table, entityId, 'read');
  const text = body.trim();
  if (!text) throw invalid('Write something first.');
  const id = newId('cmt');
  await ctx.db.query('INSERT INTO comments (id, workspace_id, entity_type, entity_id, author_id, body) VALUES ($1,$2,$3,$4,$5,$6)', [id, row.workspace_id, entityType, entityId, ctx.userId, text.slice(0, 4000)]);
  await recordHistory(ctx.db, { workspaceId: row.workspace_id, entityType, entityId, action: 'commented', actorId: ctx.userId });
  return { id };
}

export async function comments(ctx: Ctx, entityType: string, entityId: string) {
  const table = COMMENTABLE[entityType];
  if (!table) return [];
  await loadScoped(ctx.db, ctx.userId, table, entityId, 'read');
  return ctx.db.query<{ id: string; body: string; author: string | null; created_at: Date }>(`SELECT c.id, c.body, u.display_name AS author, c.created_at FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.entity_type = $1 AND c.entity_id = $2 ORDER BY c.created_at`, [entityType, entityId]);
}

/** Family activity: what changed in the shared space. Never includes personal-space events. */
export async function familyActivity(ctx: Ctx, workspaceId: string, limit = 50) {
  const role = await requireRole(ctx.db, ctx.userId, workspaceId, 'member');
  if (role === 'limited') return [];
  return ctx.db.query<{ action: string; entity_type: string; entity_id: string; actor: string | null; at: Date; title: string | null }>(
    `SELECT h.action, h.entity_type, h.entity_id, u.display_name AS actor, h.at, si.title
       FROM record_history h LEFT JOIN users u ON u.id = h.actor_id LEFT JOIN search_index si ON si.entity_type = h.entity_type AND si.entity_id = h.entity_id
      WHERE h.workspace_id = $1 ORDER BY h.at DESC LIMIT $2`,
    [workspaceId, limit],
  );
}

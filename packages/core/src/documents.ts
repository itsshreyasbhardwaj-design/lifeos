/**
 * Life Vault. Private by default: a document is visible to its own
 * workspace's members (personal = only you), or to someone holding an
 * explicit, unexpired, unrevoked grant. Every view and download is audited.
 *
 * Nothing here establishes that a document is authentic or official — it is
 * the user's copy of something, stored securely.
 */
import { z } from 'zod';
import { addDays, isIsoDate } from '@lifeos/extract';
import type { Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { can, roleIn, requireRole } from './access.ts';
import { consume } from './billing.ts';
import { blobStore, storageKey } from './storage.ts';
import { sha256 } from './crypto.ts';
import type { ValidatedFile } from './files.ts';
import { indexRecord, unindexRecord } from './search-index.ts';
import { cancelRemindersFor, scheduleReminder } from './reminders.ts';
import { enqueue, registerJob } from './jobs.ts';
import { extractText } from './ocr.ts';

export const DOCUMENT_CATEGORIES = ['receipt', 'warranty', 'certificate', 'travel', 'membership', 'agreement', 'administrative', 'education', 'insurance', 'medical', 'identity', 'personal_note', 'other'] as const;

const isoDate = z.string().refine(isIsoDate, 'Use a full date.');
export const documentMeta = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.enum(DOCUMENT_CATEGORIES).default('other'),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(20).default([]),
  issuer: z.string().trim().max(200).nullish(),
  issuedOn: isoDate.nullish(),
  expiresOn: isoDate.nullish(),
  notes: z.string().max(20_000).nullish(),
  isSensitive: z.boolean().default(false),
  sourceCaptureId: z.string().nullish(),
});

export interface DocumentRow {
  id: string; workspace_id: string; title: string; category: string; tags: string[]; issuer: string | null; issued_on: string | null; expires_on: string | null;
  notes: string | null; is_sensitive: boolean; current_version_id: string | null; source_capture_id: string | null; created_by: string | null; created_at: Date; updated_at: Date;
}

export interface DocumentAccess {
  doc: DocumentRow;
  canEdit: boolean;
  canDownload: boolean;
  viaGrant: string | null;
}

/** The single access check every document read goes through. */
export async function documentAccess(q: Queryable, userId: string, docId: string, now = new Date()): Promise<DocumentAccess> {
  const doc = await one<DocumentRow>(q, 'SELECT * FROM documents WHERE id = $1', [docId]);
  if (!doc) throw notFound('Document');
  const role = await roleIn(q, userId, doc.workspace_id);
  if (role && can(role, 'read_documents')) return { doc, canEdit: can(role, 'write'), canDownload: true, viaGrant: null };
  const grant = await one<{ id: string; can_download: boolean }>(
    q,
    `SELECT g.id, g.can_download FROM document_access_grants g
      WHERE g.document_id = $1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > $3)
        AND (g.grantee_user_id = $2 OR g.grantee_workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = $2 AND role <> 'limited'))
      ORDER BY g.can_download DESC LIMIT 1`,
    [docId, userId, now],
  );
  if (!grant) throw notFound('Document');
  return { doc, canEdit: false, canDownload: grant.can_download, viaGrant: grant.id };
}

async function reindex(q: Queryable, d: DocumentRow, text?: string | null) {
  const body = [d.category, d.tags.join(' '), d.issuer, d.notes, text ?? (await one<{ t: string | null }>(q, 'SELECT extracted_text AS t FROM document_versions WHERE id = $1', [d.current_version_id]))?.t].filter(Boolean).join('\n');
  await indexRecord(q, { entityType: 'document', entityId: d.id, workspaceId: d.workspace_id, title: d.title, body, occursOn: d.expires_on ?? d.issued_on });
}

async function expiryReminder(q: Queryable, d: DocumentRow, userId: string) {
  await cancelRemindersFor(q, 'document', d.id, 'rescheduled');
  if (!d.expires_on) return;
  for (const days of [30, 7]) {
    await scheduleReminder(q, { workspaceId: d.workspace_id, userId, targetType: 'document', targetId: d.id, kind: 'expiry', title: `${d.title} expires in ${days} days`, note: `Expires ${d.expires_on}`, anchorDate: addDays(d.expires_on, -days), anchorTime: null, createdBy: userId });
  }
}

/** Duplicate detection: the same bytes already in this space. Reported, never merged. */
export async function findDuplicate(q: Queryable, workspaceId: string, sha: string) {
  return one<{ document_id: string; title: string }>(q, `SELECT v.document_id, d.title FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.workspace_id = $1 AND v.sha256 = $2 LIMIT 1`, [workspaceId, sha]);
}

export async function createDocument(ctx: Ctx, workspaceId: string, meta: z.input<typeof documentMeta>, file: ValidatedFile | null, q: Queryable = ctx.db, existingText?: string | null): Promise<{ doc: DocumentRow; duplicateOf: { document_id: string; title: string } | null }> {
  const m = documentMeta.parse(meta);
  return withTx(q, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const id = newId('doc');
    let duplicateOf: { document_id: string; title: string } | null = null;
    let versionId: string | null = null;
    if (file) {
      const sha = sha256(file.data);
      duplicateOf = await findDuplicate(tx, workspaceId, sha);
      await consume(tx, ctx.userId, 'storage_bytes', file.size, ctx.now);
      versionId = newId('dvr');
      const key = storageKey(workspaceId, versionId);
      await blobStore().put(key, file.data);
      await tx.query(`INSERT INTO documents (id, workspace_id, title, category, tags, issuer, issued_on, expires_on, notes, is_sensitive, source_capture_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
        id, workspaceId, m.title, m.category, m.tags, m.issuer ?? null, m.issuedOn ?? null, m.expiresOn ?? null, m.notes ?? null, m.isSensitive, m.sourceCaptureId ?? null, ctx.userId,
      ]);
      await tx.query(`INSERT INTO document_versions (id, document_id, workspace_id, version, storage_key, original_name, mime_type, size_bytes, sha256, extracted_text, created_by) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)`, [
        versionId, id, workspaceId, key, file.name, file.mimeType, file.size, sha, existingText ?? null, ctx.userId,
      ]);
      await tx.query('UPDATE documents SET current_version_id = $2 WHERE id = $1', [id, versionId]);
      if (existingText === undefined) await enqueue(tx, 'document.extract', { versionId }, { dedupeKey: `docx:${versionId}` });
    } else {
      await tx.query(`INSERT INTO documents (id, workspace_id, title, category, tags, issuer, issued_on, expires_on, notes, is_sensitive, source_capture_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
        id, workspaceId, m.title, m.category, m.tags, m.issuer ?? null, m.issuedOn ?? null, m.expiresOn ?? null, m.notes ?? null, m.isSensitive, m.sourceCaptureId ?? null, ctx.userId,
      ]);
    }
    const doc = (await one<DocumentRow>(tx, 'SELECT * FROM documents WHERE id = $1', [id]))!;
    await recordHistory(tx, { workspaceId, entityType: 'document', entityId: id, action: 'created', changes: { version: file ? 1 : 0 }, actorId: ctx.userId });
    await audit(tx, { actorId: ctx.userId, workspaceId, action: 'document.created', entityType: 'document', entityId: id, meta: { duplicate: Boolean(duplicateOf), size: file?.size ?? 0 } });
    await reindex(tx, doc, existingText ?? null);
    await expiryReminder(tx, doc, ctx.userId);
    return { doc, duplicateOf };
  });
}

export async function addVersion(ctx: Ctx, docId: string, file: ValidatedFile): Promise<{ versionId: string; version: number }> {
  return withTx(ctx.db, async (tx) => {
    const a = await documentAccess(tx, ctx.userId, docId, ctx.now);
    if (!a.canEdit) throw forbidden();
    await consume(tx, ctx.userId, 'storage_bytes', file.size, ctx.now);
    const n = (await one<{ n: number }>(tx, 'SELECT COALESCE(max(version), 0)::int + 1 AS n FROM document_versions WHERE document_id = $1', [docId]))!.n;
    const versionId = newId('dvr');
    const key = storageKey(a.doc.workspace_id, versionId);
    await blobStore().put(key, file.data);
    await tx.query(`INSERT INTO document_versions (id, document_id, workspace_id, version, storage_key, original_name, mime_type, size_bytes, sha256, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      versionId, docId, a.doc.workspace_id, n, key, file.name, file.mimeType, file.size, sha256(file.data), ctx.userId,
    ]);
    await tx.query('UPDATE documents SET current_version_id = $2, updated_at = now() WHERE id = $1', [docId, versionId]);
    await enqueue(tx, 'document.extract', { versionId }, { dedupeKey: `docx:${versionId}` });
    await recordHistory(tx, { workspaceId: a.doc.workspace_id, entityType: 'document', entityId: docId, action: 'version_added', changes: { version: n }, actorId: ctx.userId });
    return { versionId, version: n };
  });
}

export async function updateDocument(ctx: Ctx, docId: string, patch: Partial<z.input<typeof documentMeta>>): Promise<DocumentRow> {
  return withTx(ctx.db, async (tx) => {
    const a = await documentAccess(tx, ctx.userId, docId, ctx.now);
    if (!a.canEdit) throw forbidden();
    const m = documentMeta.partial().parse(patch);
    const d = a.doc;
    const rows = await tx.query<DocumentRow>(
      `UPDATE documents SET title=$2, category=$3, tags=$4, issuer=$5, issued_on=$6, expires_on=$7, notes=$8, is_sensitive=$9, updated_at = now() WHERE id = $1 RETURNING *`,
      [docId, m.title ?? d.title, m.category ?? d.category, m.tags ?? d.tags, m.issuer !== undefined ? m.issuer : d.issuer, m.issuedOn !== undefined ? m.issuedOn : d.issued_on,
        m.expiresOn !== undefined ? m.expiresOn : d.expires_on, m.notes !== undefined ? m.notes : d.notes, m.isSensitive ?? d.is_sensitive],
    );
    await recordHistory(tx, { workspaceId: d.workspace_id, entityType: 'document', entityId: docId, action: 'updated', changes: m as Record<string, unknown>, actorId: ctx.userId });
    await reindex(tx, rows[0]!);
    if (m.expiresOn !== undefined) await expiryReminder(tx, rows[0]!, ctx.userId);
    return rows[0]!;
  });
}

export async function versions(ctx: Ctx, docId: string) {
  await documentAccess(ctx.db, ctx.userId, docId, ctx.now);
  return ctx.db.query<{ id: string; version: number; original_name: string; mime_type: string; size_bytes: number; created_at: Date }>(
    'SELECT id, version, original_name, mime_type, size_bytes, created_at FROM document_versions WHERE document_id = $1 ORDER BY version DESC', [docId],
  );
}

/** Reads file bytes after the access check and writes an audit record. */
export async function readDocumentFile(ctx: Ctx, docId: string, opts: { versionId?: string; purpose: 'view' | 'download' }) {
  const a = await documentAccess(ctx.db, ctx.userId, docId, ctx.now);
  if (opts.purpose === 'download' && !a.canDownload) throw forbidden('This was shared with you as view-only.');
  const v = await one<{ id: string; storage_key: string; mime_type: string; original_name: string; version: number }>(
    ctx.db, 'SELECT id, storage_key, mime_type, original_name, version FROM document_versions WHERE document_id = $1 AND id = COALESCE($2, (SELECT current_version_id FROM documents WHERE id = $1))', [docId, opts.versionId ?? null],
  );
  if (!v) throw notFound('File');
  const data = await blobStore().get(v.storage_key);
  await audit(ctx.db, { actorId: ctx.userId, workspaceId: a.doc.workspace_id, action: `document.${opts.purpose}ed`, entityType: 'document', entityId: docId, meta: { version: v.version, via_grant: Boolean(a.viaGrant) } });
  return { data, mimeType: v.mime_type, name: v.original_name, canDownload: a.canDownload };
}

export const shareInput = z.object({
  granteeUserId: z.string().nullish(),
  granteeWorkspaceId: z.string().nullish(),
  canDownload: z.boolean().default(false),
  expiresAt: z.coerce.date().nullish(),
});

/**
 * Shares one document with a person or a family space you both belong to.
 * Sharing is explicit, per document, and revocable.
 */
export async function shareDocument(ctx: Ctx, docId: string, input: z.input<typeof shareInput>): Promise<{ grantId: string }> {
  const d = shareInput.parse(input);
  if (Boolean(d.granteeUserId) === Boolean(d.granteeWorkspaceId)) throw invalid('Share with one person or one family space.');
  if (d.expiresAt && d.expiresAt.getTime() <= ctx.now.getTime()) throw invalid('The expiry must be in the future.');
  return withTx(ctx.db, async (tx) => {
    const doc = await one<DocumentRow>(tx, 'SELECT * FROM documents WHERE id = $1', [docId]);
    if (!doc) throw notFound('Document');
    await requireRole(tx, ctx.userId, doc.workspace_id, 'share_documents');
    if (d.granteeWorkspaceId) {
      const r = await roleIn(tx, ctx.userId, d.granteeWorkspaceId);
      const ws = await one<{ kind: string }>(tx, 'SELECT kind FROM workspaces WHERE id = $1', [d.granteeWorkspaceId]);
      if (!r || ws?.kind !== 'family') throw invalid('You can share into family spaces you belong to.');
    } else {
      const shared = await one(tx, `SELECT 1 FROM memberships a JOIN memberships b ON a.workspace_id = b.workspace_id JOIN workspaces w ON w.id = a.workspace_id AND w.kind = 'family' WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`, [ctx.userId, d.granteeUserId]);
      if (!shared) throw invalid('You can share with people in your family spaces.');
    }
    const grantId = newId('grt');
    await tx.query(`INSERT INTO document_access_grants (id, document_id, grantee_user_id, grantee_workspace_id, can_download, expires_at, granted_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      grantId, docId, d.granteeUserId ?? null, d.granteeWorkspaceId ?? null, d.canDownload, d.expiresAt ?? null, ctx.userId,
    ]);
    await audit(tx, { actorId: ctx.userId, workspaceId: doc.workspace_id, action: 'document.shared', entityType: 'document', entityId: docId, meta: { grant: grantId, download: d.canDownload, expires: d.expiresAt?.toISOString() ?? null } });
    return { grantId };
  });
}

export async function revokeGrant(ctx: Ctx, grantId: string): Promise<void> {
  await withTx(ctx.db, async (tx) => {
    const g = await one<{ document_id: string; workspace_id: string }>(tx, 'SELECT g.document_id, d.workspace_id FROM document_access_grants g JOIN documents d ON d.id = g.document_id WHERE g.id = $1', [grantId]);
    if (!g) throw notFound('Share');
    await requireRole(tx, ctx.userId, g.workspace_id, 'share_documents');
    await tx.query('UPDATE document_access_grants SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [grantId]);
    await audit(tx, { actorId: ctx.userId, workspaceId: g.workspace_id, action: 'document.share_revoked', entityType: 'document', entityId: g.document_id, meta: { grant: grantId } });
  });
}

export async function grantsFor(ctx: Ctx, docId: string) {
  const doc = await one<DocumentRow>(ctx.db, 'SELECT * FROM documents WHERE id = $1', [docId]);
  if (!doc) throw notFound('Document');
  await requireRole(ctx.db, ctx.userId, doc.workspace_id, 'share_documents');
  return ctx.db.query(
    `SELECT g.id, g.can_download, g.expires_at, g.revoked_at, g.created_at, u.display_name AS grantee_name, w.name AS grantee_workspace
       FROM document_access_grants g LEFT JOIN users u ON u.id = g.grantee_user_id LEFT JOIN workspaces w ON w.id = g.grantee_workspace_id
      WHERE g.document_id = $1 ORDER BY g.created_at DESC`, [docId],
  );
}

export async function accessLog(ctx: Ctx, docId: string) {
  const doc = await one<DocumentRow>(ctx.db, 'SELECT * FROM documents WHERE id = $1', [docId]);
  if (!doc) throw notFound('Document');
  await requireRole(ctx.db, ctx.userId, doc.workspace_id, 'share_documents');
  return ctx.db.query(`SELECT a.action, a.at, a.meta, u.display_name AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.entity_type = 'document' AND a.entity_id = $1 ORDER BY a.at DESC LIMIT 200`, [docId]);
}

export async function listDocuments(ctx: Ctx, opts: { category?: string; search?: string; expiringWithinDays?: number } = {}) {
  return ctx.db.query<DocumentRow & { shared_with_me: boolean; can_download: boolean; mime_type: string | null; size_bytes: number | null; workspace_name: string }>(
    `WITH mine AS (
       SELECT d.*, false AS shared_with_me, true AS can_download FROM documents d
         JOIN memberships m ON m.workspace_id = d.workspace_id AND m.user_id = $1 AND m.role IN ('owner','adult','member')
     ), granted AS (
       SELECT d.*, true AS shared_with_me, bool_or(g.can_download) AS can_download FROM documents d
         JOIN document_access_grants g ON g.document_id = d.id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > $5)
        WHERE (g.grantee_user_id = $1 OR g.grantee_workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = $1 AND role <> 'limited'))
          AND d.id NOT IN (SELECT id FROM mine)
        GROUP BY d.id
     )
     SELECT x.*, v.mime_type, v.size_bytes, w.name AS workspace_name FROM (SELECT * FROM mine UNION ALL SELECT * FROM granted) x
       LEFT JOIN document_versions v ON v.id = x.current_version_id
       JOIN workspaces w ON w.id = x.workspace_id
      WHERE ($2::text IS NULL OR x.category = $2)
        AND ($3::text IS NULL OR x.title ILIKE '%' || $3 || '%' OR $3 = ANY(x.tags))
        AND ($4::int IS NULL OR (x.expires_on IS NOT NULL AND x.expires_on <= (now()::date + $4::int)))
      ORDER BY x.updated_at DESC`,
    [ctx.userId, opts.category ?? null, opts.search ?? null, opts.expiringWithinDays ?? null, ctx.now],
  );
}

/**
 * Deletes a document and every stored version. Links pointing at it are
 * removed; records that referenced it as a receipt keep existing with the
 * reference cleared (documented deletion policy).
 */
export async function deleteDocument(ctx: Ctx, docId: string): Promise<void> {
  const keys = await withTx(ctx.db, async (tx) => {
    const a = await documentAccess(tx, ctx.userId, docId, ctx.now);
    if (!a.canEdit) throw forbidden();
    const vs = await tx.query<{ storage_key: string; size_bytes: number }>('SELECT storage_key, size_bytes FROM document_versions WHERE document_id = $1', [docId]);
    await cancelRemindersFor(tx, 'document', docId, 'document_deleted');
    await tx.query(`DELETE FROM life_links WHERE (from_type = 'document' AND from_id = $1) OR (to_type = 'document' AND to_id = $1)`, [docId]);
    await unindexRecord(tx, 'document', docId);
    await tx.query('DELETE FROM documents WHERE id = $1', [docId]);
    const total = vs.reduce((n, v) => n + Number(v.size_bytes), 0);
    if (total) await consume(tx, ctx.userId, 'storage_bytes', -total, ctx.now);
    await audit(tx, { actorId: ctx.userId, workspaceId: a.doc.workspace_id, action: 'document.deleted', entityType: 'document', entityId: docId });
    return vs.map((v) => v.storage_key);
  });
  for (const k of keys) await blobStore().delete(k);
}

registerJob('document.extract', async (db, payload) => {
  const v = await one<{ id: string; document_id: string; storage_key: string; mime_type: string }>(db, 'SELECT id, document_id, storage_key, mime_type FROM document_versions WHERE id = $1', [payload.versionId]);
  if (!v) return;
  const res = await extractText(await blobStore().get(v.storage_key), v.mime_type);
  await db.query('UPDATE document_versions SET extracted_text = $2 WHERE id = $1', [v.id, res.text || null]);
  const d = await one<DocumentRow>(db, 'SELECT * FROM documents WHERE id = $1', [v.document_id]);
  if (d && d.current_version_id === v.id) await reindex(db, d, res.text);
});

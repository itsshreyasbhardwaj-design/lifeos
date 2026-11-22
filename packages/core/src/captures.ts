/**
 * Universal Life Inbox: CAPTURE → UNDERSTAND → CONFIRM → CONNECT.
 *
 *  - A capture is stored first, processed second. If reading it fails, the
 *    capture and its files remain, marked failed, and can be reprocessed.
 *  - Processing only ever produces *candidates*. A record (task, purchase,
 *    warranty …) is created only by `confirmCandidate`, which requires a user,
 *    records the review, and refuses dates that are not fully specified.
 *  - Repeated content is detected and reported ("you saved this on …"); it is
 *    never merged with an earlier capture automatically.
 */
import { z } from 'zod';
import { type DateValue, type ExtractionOutput, extractCandidates, isIsoDate } from '@lifeos/extract';
import type { Db, Queryable } from './db.ts';
import { one, withTx } from './db.ts';
import type { Ctx } from './context.ts';
import { AppError, forbidden, invalid, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { audit, recordHistory } from './audit.ts';
import { loadScoped, requireRole } from './access.ts';
import { consume } from './billing.ts';
import { sha256 } from './crypto.ts';
import type { ValidatedFile } from './files.ts';
import { blobStore, storageKey } from './storage.ts';
import { extractText } from './ocr.ts';
import { fetchPage } from './urlfetch.ts';
import { enqueue, registerJob } from './jobs.ts';
import { indexRecord, unindexRecord } from './search-index.ts';
import { link, type NodeType } from './links.ts';
import { todayIn } from './time.ts';
import { createTask } from './tasks.ts';
import { createEvent } from './calendar.ts';
import { addReturnWindow, addWarranty, createPurchase } from './purchases.ts';
import { createBill, createSubscription } from './commitments.ts';
import { createPromise } from './promises.ts';
import { createDocument } from './documents.ts';
import { recurrenceSchema } from './recurrence.ts';

export const SOURCE_TYPES = ['text', 'note', 'paste', 'url', 'screenshot', 'image', 'pdf', 'receipt', 'file', 'voice', 'extension', 'share'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const captureInput = z.object({
  sourceType: z.enum(SOURCE_TYPES).default('text'),
  title: z.string().trim().max(300).nullish(),
  text: z.string().max(100_000).nullish(),
  url: z.string().trim().max(2000).nullish(),
  sourceDate: z.string().refine(isIsoDate, 'Use a full date.').nullish(),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullish(),
  sourceApp: z.string().max(60).nullish(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(20).default([]),
});

export interface Capture {
  id: string; workspace_id: string; created_by: string | null; client_id: string | null; source_type: SourceType; source_app: string | null; title: string | null;
  text_content: string | null; url: string | null; url_title: string | null; source_date: string | null; status: string; error: string | null; extracted_text: string | null;
  extraction_engine: string | null; extraction_note: string | null; content_sha256: string | null; tags: string[]; created_at: Date; updated_at: Date; processed_at: Date | null;
}

export interface CreateCaptureResult {
  capture: Capture;
  deduplicated: boolean;
  similar: { id: string; created_at: Date; title: string | null }[];
  duplicateFiles: { name: string; existingCaptureId: string | null; existingDocumentId: string | null }[];
}

function contentHash(text: string | null | undefined, url: string | null | undefined, files: ValidatedFile[]): string | null {
  const parts = [text?.trim() ?? '', url?.trim() ?? '', ...files.map((f) => sha256(f.data))].filter(Boolean);
  return parts.length ? sha256(parts.join('\u0000')) : null;
}

export async function createCapture(ctx: Ctx, workspaceId: string, input: z.input<typeof captureInput>, files: ValidatedFile[] = []): Promise<CreateCaptureResult> {
  const d = captureInput.parse(input);
  if (!d.text?.trim() && !d.url && files.length === 0) throw invalid('Add some text, a link or a file.');
  if (files.length > 10) throw invalid('Up to 10 files per capture.');
  if (d.url && !/^https?:\/\//i.test(d.url)) throw invalid('Links must start with http:// or https://');

  // Offline drafts and the extension retry with the same client id: return the original.
  if (d.clientId) {
    const existing = await one<Capture>(ctx.db, 'SELECT * FROM captures WHERE workspace_id = $1 AND created_by = $2 AND client_id = $3', [workspaceId, ctx.userId, d.clientId]);
    if (existing) return { capture: existing, deduplicated: true, similar: [], duplicateFiles: [] };
  }

  const hash = contentHash(d.text, d.url, files);
  const sourceType: SourceType = files.length && d.sourceType === 'text' ? (files[0]!.mimeType === 'application/pdf' ? 'pdf' : files[0]!.mimeType.startsWith('image/') ? 'image' : files[0]!.mimeType.startsWith('audio/') ? 'voice' : 'file') : d.url && d.sourceType === 'text' && !d.text ? 'url' : d.sourceType;

  return withTx(ctx.db, async (tx) => {
    await requireRole(tx, ctx.userId, workspaceId, 'write');
    const id = newId('cap');
    const similar = hash ? await tx.query<{ id: string; created_at: Date; title: string | null }>('SELECT id, created_at, title FROM captures WHERE workspace_id = $1 AND content_sha256 = $2 ORDER BY created_at DESC LIMIT 5', [workspaceId, hash]) : [];
    let rows: Capture[];
    try {
      rows = await tx.query<Capture>(
        `INSERT INTO captures (id, workspace_id, created_by, client_id, source_type, source_app, title, text_content, url, source_date, status, content_sha256, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12) RETURNING *`,
        [id, workspaceId, ctx.userId, d.clientId ?? null, sourceType, d.sourceApp ?? null, d.title ?? null, d.text?.trim() || null, d.url ?? null, d.sourceDate ?? null, hash, d.tags],
      );
    } catch (err) {
      // Two simultaneous syncs of the same draft: the unique index decides.
      if (d.clientId && String((err as Error).message).includes('captures_client_id_key')) {
        const existing = await one<Capture>(ctx.db, 'SELECT * FROM captures WHERE workspace_id = $1 AND created_by = $2 AND client_id = $3', [workspaceId, ctx.userId, d.clientId]);
        if (existing) return { capture: existing, deduplicated: true, similar: [], duplicateFiles: [] };
      }
      throw err;
    }
    const duplicateFiles: CreateCaptureResult['duplicateFiles'] = [];
    for (const f of files) {
      const sha = sha256(f.data);
      const prevCap = await one<{ capture_id: string }>(tx, 'SELECT capture_id FROM capture_files WHERE workspace_id = $1 AND sha256 = $2 LIMIT 1', [workspaceId, sha]);
      const prevDoc = await one<{ document_id: string }>(tx, 'SELECT document_id FROM document_versions WHERE workspace_id = $1 AND sha256 = $2 LIMIT 1', [workspaceId, sha]);
      if (prevCap || prevDoc) duplicateFiles.push({ name: f.name, existingCaptureId: prevCap?.capture_id ?? null, existingDocumentId: prevDoc?.document_id ?? null });
      await consume(tx, ctx.userId, 'storage_bytes', f.size, ctx.now);
      const fid = newId('cfl');
      const key = storageKey(workspaceId, fid);
      await blobStore().put(key, f.data);
      await tx.query('INSERT INTO capture_files (id, capture_id, workspace_id, storage_key, original_name, mime_type, size_bytes, sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [fid, id, workspaceId, key, f.name, f.mimeType, f.size, sha]);
    }
    await enqueue(tx, 'capture.extract', { captureId: id }, { dedupeKey: `capx:${id}:0` });
    await audit(tx, { actorId: ctx.userId, workspaceId, action: 'capture.created', entityType: 'capture', entityId: id, meta: { source: sourceType, files: files.length, similar: similar.length } });
    await indexRecord(tx, { entityType: 'capture', entityId: id, workspaceId, title: d.title ?? d.text?.slice(0, 80) ?? d.url ?? files[0]?.name ?? 'Capture', body: [d.text, d.url, files.map((f) => f.name).join(' '), d.tags.join(' ')].filter(Boolean).join('\n'), status: 'queued' });
    return { capture: rows[0]!, deduplicated: false, similar, duplicateFiles };
  });
}

async function setStatus(q: Queryable, id: string, status: string, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra);
  await q.query(`UPDATE captures SET status = $2, updated_at = now()${cols.map((c, i) => `, ${c} = $${i + 3}`).join('')} WHERE id = $1`, [id, status, ...cols.map((c) => extra[c])]);
}

export interface ProcessOptions {
  /** Set false to skip network fetches of captured URLs (tests, offline servers). */
  fetchUrls?: boolean;
  fetcher?: typeof fetchPage;
}

/**
 * Reads a capture and writes candidates. Never throws for content problems:
 * an unreadable file or blocked URL is recorded on the capture instead.
 */
export async function processCapture(db: Db, captureId: string, opts: ProcessOptions = {}): Promise<{ status: string; candidates: number }> {
  const cap = await one<Capture>(db, 'SELECT * FROM captures WHERE id = $1', [captureId]);
  if (!cap) return { status: 'missing', candidates: 0 };
  if (['archived'].includes(cap.status)) return { status: cap.status, candidates: 0 };
  await setStatus(db, captureId, 'processing');
  try {
    const user = await one<{ timezone: string; date_order: 'DMY' | 'MDY' | 'YMD' }>(db, 'SELECT timezone, date_order FROM users WHERE id = $1', [cap.created_by]);
    const tz = user?.timezone ?? 'Asia/Kolkata';
    const texts: string[] = [];
    const notes: string[] = [];
    const engines = new Set<string>();
    if (cap.title) texts.push(cap.title);
    if (cap.text_content) {
      texts.push(cap.text_content);
      engines.add('text');
    }
    if (cap.url && (opts.fetchUrls ?? process.env.LIFEOS_FETCH_URLS !== '0')) {
      try {
        const page = await (opts.fetcher ?? fetchPage)(cap.url);
        await db.query('UPDATE captures SET url_title = $2 WHERE id = $1', [captureId, page.title]);
        texts.push([page.title, page.description, page.text.slice(0, 20_000)].filter(Boolean).join('\n'));
        engines.add('url-fetch');
      } catch (err) {
        notes.push(`The link was saved but not read: ${(err as Error).message}`);
      }
    }
    const files = await db.query<{ id: string; storage_key: string; mime_type: string; original_name: string }>('SELECT id, storage_key, mime_type, original_name FROM capture_files WHERE capture_id = $1 ORDER BY created_at', [captureId]);
    let quotaHit = false;
    if (files.length) {
      try {
        await consume(db, cap.created_by!, 'extractions', 1);
      } catch (err) {
        if (err instanceof AppError && err.code === 'quota_exceeded') {
          quotaHit = true;
          notes.push(`${err.message} The files are saved; you can add the details yourself or upgrade.`);
        } else throw err;
      }
    }
    if (!quotaHit) {
      for (const f of files) {
        const res = await extractText(await blobStore().get(f.storage_key), f.mime_type);
        engines.add(res.engine);
        if (res.note) notes.push(`${f.original_name}: ${res.note}`);
        if (res.text) {
          texts.push(res.text);
          await db.query('UPDATE capture_files SET extracted_text = $2 WHERE id = $1', [f.id, res.text]);
        }
      }
    }
    const text = texts.join('\n\n').trim();
    const anchor = cap.source_date ?? todayIn(tz, new Date(cap.created_at));
    let out: ExtractionOutput | null = null;
    if (text) out = extractCandidates(text, { today: anchor, order: user?.date_order ?? 'DMY', sourceHint: [cap.source_type, ...files.map((f) => f.original_name)].join(' ') });
    const candidates = out?.candidates ?? [];
    await db.tx(async (tx) => {
      await tx.query(`UPDATE extraction_candidates SET status = 'superseded' WHERE capture_id = $1 AND status = 'pending'`, [captureId]);
      for (const c of candidates) {
        await tx.query(
          `INSERT INTO extraction_candidates (id, capture_id, workspace_id, kind, title, fields, evidence, uncertain, provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [newId('cnd'), captureId, cap.workspace_id, c.kind, c.title.slice(0, 500), JSON.stringify({ ...c.fields, _key: c.key, _relatesTo: c.relatesTo }), JSON.stringify(c.evidence), JSON.stringify(c.uncertain), JSON.stringify({ ...c.provenance, anchor, documentType: out!.documentType })],
        );
      }
      const status = candidates.length ? 'review_required' : 'extracted';
      await setStatus(tx, captureId, status, { extracted_text: text || null, extraction_engine: [...engines].join('+') || null, extraction_note: notes.join('\n') || (text ? null : 'Nothing could be read automatically. The original is saved.'), processed_at: new Date(), error: null });
      await indexRecord(tx, { entityType: 'capture', entityId: captureId, workspaceId: cap.workspace_id, title: cap.title ?? cap.url_title ?? text.slice(0, 80) ?? 'Capture', body: [text, cap.url, files.map((f) => f.original_name).join(' '), cap.tags.join(' ')].filter(Boolean).join('\n'), status });
    });
    return { status: candidates.length ? 'review_required' : 'extracted', candidates: candidates.length };
  } catch (err) {
    // Invariant 3: the original survives; only the status changes.
    await setStatus(db, captureId, 'failed', { error: String((err as Error).message).slice(0, 500) });
    return { status: 'failed', candidates: 0 };
  }
}

registerJob('capture.extract', async (db, payload) => {
  await processCapture(db, String(payload.captureId));
});

export async function reprocessCapture(ctx: Ctx, id: string): Promise<void> {
  const cap = await loadScoped<Capture>(ctx.db, ctx.userId, 'captures', id, 'write', 'Capture');
  await setStatus(ctx.db, id, 'queued');
  await enqueue(ctx.db, 'capture.extract', { captureId: id }, { dedupeKey: `capx:${id}:${Date.now()}` });
  await audit(ctx.db, { actorId: ctx.userId, workspaceId: cap.workspace_id, action: 'capture.reprocessed', entityType: 'capture', entityId: id });
}

export async function listCaptures(ctx: Ctx, opts: { status?: 'unreviewed' | 'all' | 'failed' | 'archived'; limit?: number } = {}) {
  const status = opts.status ?? 'all';
  const filter = status === 'unreviewed' ? `AND c.status IN ('queued','processing','review_required','extracted')` : status === 'failed' ? `AND c.status = 'failed'` : status === 'archived' ? `AND c.status = 'archived'` : `AND c.status <> 'archived'`;
  return ctx.db.query<Capture & { pending: number; accepted: number; file_count: number; first_mime: string | null; workspace_name: string }>(
    `SELECT c.*, w.name AS workspace_name,
            (SELECT count(*)::int FROM extraction_candidates e WHERE e.capture_id = c.id AND e.status = 'pending') AS pending,
            (SELECT count(*)::int FROM extraction_candidates e WHERE e.capture_id = c.id AND e.status = 'accepted') AS accepted,
            (SELECT count(*)::int FROM capture_files f WHERE f.capture_id = c.id) AS file_count,
            (SELECT f.mime_type FROM capture_files f WHERE f.capture_id = c.id ORDER BY f.created_at LIMIT 1) AS first_mime
       FROM captures c JOIN memberships m ON m.workspace_id = c.workspace_id AND m.user_id = $1 AND m.role <> 'limited' JOIN workspaces w ON w.id = c.workspace_id
      WHERE true ${filter} ORDER BY c.created_at DESC LIMIT $2`,
    [ctx.userId, Math.min(opts.limit ?? 100, 500)],
  );
}

export interface CandidateRow {
  id: string; capture_id: string; workspace_id: string; kind: string; title: string; fields: Record<string, unknown>; evidence: { excerpt: string; start: number; end: number }[];
  uncertain: { field: string; reason: string; message: string; alternatives?: unknown[] }[]; provenance: Record<string, unknown>; status: string;
  created_record_type: string | null; created_record_id: string | null; reviewed_by: string | null; reviewed_at: Date | null;
}

export async function getCapture(ctx: Ctx, id: string) {
  const cap = await loadScoped<Capture>(ctx.db, ctx.userId, 'captures', id, 'read', 'Capture');
  const [files, candidates] = await Promise.all([
    ctx.db.query<{ id: string; original_name: string; mime_type: string; size_bytes: number; extracted_text: string | null }>('SELECT id, original_name, mime_type, size_bytes, extracted_text FROM capture_files WHERE capture_id = $1 ORDER BY created_at', [id]),
    ctx.db.query<CandidateRow>(`SELECT * FROM extraction_candidates WHERE capture_id = $1 AND status <> 'superseded' ORDER BY created_at`, [id]),
  ]);
  return { capture: cap, files, candidates };
}

export async function readCaptureFile(ctx: Ctx, fileId: string) {
  const f = await one<{ capture_id: string; storage_key: string; mime_type: string; original_name: string; workspace_id: string }>(ctx.db, 'SELECT capture_id, storage_key, mime_type, original_name, workspace_id FROM capture_files WHERE id = $1', [fileId]);
  if (!f) throw notFound('File');
  await loadScoped(ctx.db, ctx.userId, 'captures', f.capture_id, 'read', 'File');
  await audit(ctx.db, { actorId: ctx.userId, workspaceId: f.workspace_id, action: 'capture.file_viewed', entityType: 'capture', entityId: f.capture_id });
  return { data: await blobStore().get(f.storage_key), mimeType: f.mime_type, name: f.original_name };
}

/** Lets the user add their own suggestion to a capture when nothing was found. */
export async function addManualCandidate(ctx: Ctx, captureId: string, kind: CandidateRow['kind'], title: string): Promise<string> {
  const cap = await loadScoped<Capture>(ctx.db, ctx.userId, 'captures', captureId, 'write', 'Capture');
  const id = newId('cnd');
  await ctx.db.query(`INSERT INTO extraction_candidates (id, capture_id, workspace_id, kind, title, fields, evidence, uncertain, provenance) VALUES ($1,$2,$3,$4,$5,$6,'[]','[]',$7)`, [
    id, captureId, cap.workspace_id, kind, title.slice(0, 500), JSON.stringify({ title }), JSON.stringify({ engine: 'user', version: '1', rules: ['manual'] }),
  ]);
  await setStatus(ctx.db, captureId, 'review_required');
  return id;
}

// ------------------------------------------------------------------ review

export const confirmInput = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  /** The reviewer saw the flagged fields. Required when the candidate has any. */
  acknowledgeUncertain: z.boolean().default(false),
  remind: z.boolean().default(true),
});

const iso = z.string().refine(isIsoDate, 'Use a full date (YYYY-MM-DD).');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Resolves a field: the reviewer's edit wins; otherwise the extracted value.
 * A date the source left incomplete (no year, no day) has no value until the
 * reviewer supplies one — that is how "do not invent a year" is enforced.
 */
function resolveDate(c: CandidateRow, edits: Record<string, unknown>, key: string, required: boolean, label: string): string | null {
  if (key in edits) {
    const v = edits[key];
    if (v === null || v === '') {
      if (required) throw invalid(`${label} is required.`, { field: key });
      return null;
    }
    return iso.parse(v);
  }
  const raw = c.fields[key];
  if (raw === null || raw === undefined) {
    if (required) throw invalid(`${label} is required.`, { field: key });
    return null;
  }
  if (typeof raw === 'string') return iso.parse(raw);
  const dv = raw as DateValue;
  if (!dv.iso) throw invalid(`${label}: the source says "${dv.written}" without a full date. Choose the date.`, { field: key, reason: 'incomplete_date' });
  return dv.iso;
}

function resolveTime(c: CandidateRow, edits: Record<string, unknown>, key: string, fromDateKey?: string): string | null {
  if (key in edits) return edits[key] ? hhmm.parse(edits[key]) : null;
  const v = c.fields[key];
  if (typeof v === 'string') return v;
  if (fromDateKey && c.fields[fromDateKey] && typeof c.fields[fromDateKey] === 'object') return (c.fields[fromDateKey] as DateValue).time ?? null;
  return null;
}

function val<T>(c: CandidateRow, edits: Record<string, unknown>, key: string, fallback: T): T {
  return (key in edits ? edits[key] : (c.fields[key] ?? fallback)) as T;
}

export async function confirmCandidate(ctx: Ctx, candidateId: string, input: z.input<typeof confirmInput>): Promise<{ recordType: NodeType; recordId: string; captureStatus: string }> {
  const { fields: edits, acknowledgeUncertain, remind } = confirmInput.parse(input);
  return withTx(ctx.db, async (tx) => {
    const c = await one<CandidateRow>(tx, 'SELECT * FROM extraction_candidates WHERE id = $1 FOR UPDATE', [candidateId]);
    if (!c) throw notFound('Suggestion');
    const role = await requireRole(tx, ctx.userId, c.workspace_id, 'write');
    if (role === 'limited') throw forbidden();
    if (c.status !== 'pending') throw invalid('This suggestion was already reviewed.');
    const untouched = c.uncertain.filter((u) => !(u.field in edits));
    if (untouched.length && !acknowledgeUncertain) {
      throw new AppError('needs_review', 422, 'Some details need a look before saving.', { fields: untouched.map((u) => u.field) });
    }
    const cap = (await one<Capture>(tx, 'SELECT * FROM captures WHERE id = $1', [c.capture_id]))!;
    const ws = c.workspace_id;
    const prov = { source: 'confirmed_extraction' as const, candidateId, captureId: cap.id };
    let recordType: NodeType;
    let recordId: string;

    const relatedPurchase = async (): Promise<string> => {
      if (typeof edits.purchaseId === 'string') return edits.purchaseId;
      const keys = (c.fields._relatesTo as string[] | undefined) ?? [];
      const p = await one<{ created_record_id: string | null; status: string }>(tx, `SELECT created_record_id, status FROM extraction_candidates WHERE capture_id = $1 AND kind = 'purchase' AND fields->>'_key' = ANY($2) AND status <> 'superseded' LIMIT 1`, [cap.id, keys]);
      if (!p?.created_record_id) throw invalid('Confirm the purchase first, or choose which purchase this belongs to.', { reason: 'purchase_required' });
      return p.created_record_id;
    };

    switch (c.kind) {
      case 'task':
      case 'deadline': {
        const dueDate = resolveDate(c, edits, 'dueDate', false, 'Due date');
        const recurrence = 'recurrence' in edits ? (edits.recurrence ? recurrenceSchema.parse(edits.recurrence) : null) : ((c.fields.recurrence as never) ?? null);
        const t = await createTask(ctx, ws, {
          title: String(val(c, edits, 'title', c.title)), notes: (edits.notes as string) ?? null, kind: c.kind === 'deadline' ? 'deadline' : 'task',
          dueDate, dueTime: dueDate ? resolveTime(c, edits, 'dueTime', 'dueDate') : null, recurrence, reminderOffsets: remind && dueDate ? [0] : [], sourceCaptureId: cap.id,
        }, tx);
        recordType = 'task';
        recordId = t.id;
        break;
      }
      case 'event': {
        const date = resolveDate(c, edits, 'date', true, 'Date')!;
        const startTime = resolveTime(c, edits, 'startTime', 'date');
        const allDay = 'allDay' in edits ? Boolean(edits.allDay) : !startTime;
        const { event } = await createEvent(ctx, ws, {
          title: String(val(c, edits, 'title', c.title)), date, allDay, startTime: allDay ? null : startTime, endTime: allDay ? null : resolveTime(c, edits, 'endTime'),
          location: val<string | null>(c, edits, 'location', null), kind: 'appointment', remindMinutesBefore: remind ? (allDay ? [0] : [60]) : [],
        }, tx, 'capture');
        recordType = 'calendar_event';
        recordId = event.id;
        break;
      }
      case 'purchase': {
        const purchaseDate = resolveDate(c, edits, 'purchaseDate', false, 'Purchase date');
        let receiptId: string | null = null;
        const file = await one<{ id: string; storage_key: string; original_name: string; mime_type: string; size_bytes: number; extracted_text: string | null }>(tx, 'SELECT * FROM capture_files WHERE capture_id = $1 ORDER BY created_at LIMIT 1', [cap.id]);
        if (file && val(c, edits, 'saveReceipt', true)) {
          const data = await blobStore().get(file.storage_key);
          const { doc } = await createDocument(ctx, ws, { title: `Receipt — ${String(val(c, edits, 'productName', c.title))}`, category: 'receipt', sourceCaptureId: cap.id, issuedOn: purchaseDate }, { name: file.original_name, mimeType: file.mime_type, size: data.length, data }, tx, file.extracted_text);
          receiptId = doc.id;
          await link(tx, { workspaceId: ws, fromType: 'document', fromId: doc.id, toType: 'capture', toId: cap.id, relation: 'derived_from', provenance: prov, actorId: ctx.userId });
        }
        const merchant = val<string | null>(c, edits, 'merchant', null);
        let category = val<string | null>(c, edits, 'category', null);
        if (!category && merchant) category = (await one<{ value: string }>(tx, `SELECT value #>> '{}' AS value FROM memory_preferences WHERE user_id = $1 AND key = $2`, [ctx.userId, `merchant_category:${merchant.toLowerCase()}`]))?.value ?? null;
        const p = await createPurchase(ctx, ws, {
          productName: String(val(c, edits, 'productName', null) ?? c.title), merchant, category, purchaseDate,
          amountMinor: val<number | null>(c, edits, 'amountMinor', null), currency: String(val(c, edits, 'currency', 'INR')), orderRef: val<string | null>(c, edits, 'orderRef', null),
          deliveryDate: resolveDate(c, edits, 'deliveryDate', false, 'Delivery date'), receiptDocumentId: receiptId, sourceCaptureId: cap.id,
        }, tx);
        // Correction learning: remember the category the user chose for this merchant.
        if (merchant && typeof edits.category === 'string' && edits.category) {
          await tx.query(`INSERT INTO memory_preferences (user_id, key, value, source) VALUES ($1,$2,$3,'learned_from_correction') ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [ctx.userId, `merchant_category:${merchant.toLowerCase()}`, JSON.stringify(edits.category)]);
        }
        recordType = 'purchase';
        recordId = p.id;
        break;
      }
      case 'warranty': {
        const purchaseId = await relatedPurchase();
        const startsOn = resolveDate(c, edits, 'startsOn', true, 'Warranty start')!;
        const endsOn = resolveDate(c, edits, 'endsOn', true, 'Warranty end');
        const w = await addWarranty(ctx, purchaseId, { startsOn, endsOn, terms: val<string | null>(c, edits, 'terms', null), basis: 'document_confirmed', remindDaysBefore: remind ? [30, 7] : [] }, tx, { candidateId, captureId: cap.id });
        recordType = 'warranty';
        recordId = w.id;
        break;
      }
      case 'return_window': {
        const purchaseId = await relatedPurchase();
        const deadline = resolveDate(c, edits, 'deadline', true, 'Return deadline')!;
        const r = await addReturnWindow(ctx, purchaseId, { deadline, basis: 'document_confirmed', eligibilityNotes: val<string | null>(c, edits, 'terms', null), remindDaysBefore: remind ? [2, 0] : [] }, tx, { candidateId, captureId: cap.id });
        recordType = 'return_window';
        recordId = r.id;
        break;
      }
      case 'subscription': {
        const cycle = val<string | null>(c, edits, 'cycle', null);
        if (!cycle) throw invalid('Choose how often it renews.', { field: 'cycle' });
        const s = await createSubscription(ctx, ws, {
          name: String(val(c, edits, 'name', null) ?? c.title), category: val<string | null>(c, edits, 'category', null), amountMinor: val<number | null>(c, edits, 'amountMinor', null),
          currency: String(val(c, edits, 'currency', 'INR')), cycle: cycle as 'monthly', nextRenewalDate: resolveDate(c, edits, 'nextRenewalDate', false, 'Renewal date'),
          trialEndsOn: resolveDate(c, edits, 'trialEndsOn', false, 'Trial end'), remindDaysBefore: remind ? 3 : 0,
        }, tx);
        recordType = 'subscription';
        recordId = s.id;
        break;
      }
      case 'bill': {
        const cycle = val<string | null>(c, edits, 'cycle', null);
        if (!cycle) throw invalid('Choose whether this bill repeats.', { field: 'cycle' });
        const b = await createBill(ctx, ws, {
          name: String(val(c, edits, 'name', null) ?? c.title), category: val(c, edits, 'category', 'other') as 'other', payee: val<string | null>(c, edits, 'payee', null),
          amountMinor: val<number | null>(c, edits, 'amountMinor', null), currency: String(val(c, edits, 'currency', 'INR')), cycle: cycle as 'monthly',
          nextDueDate: resolveDate(c, edits, 'dueDate', true, 'Due date')!, remindDaysBefore: remind ? 3 : 0,
        }, tx);
        recordType = 'bill';
        recordId = b.id;
        break;
      }
      case 'promise': {
        const p = await createPromise(ctx, ws, {
          direction: val(c, edits, 'direction', 'waiting_on') as 'waiting_on', description: String(val(c, edits, 'description', c.title)),
          counterparty: val<string | null>(c, edits, 'counterparty', null), expectedBy: resolveDate(c, edits, 'expectedBy', false, 'Expected date'), sourceCaptureId: cap.id,
        }, tx);
        if (!remind) await tx.query(`UPDATE reminders SET status = 'cancelled', cancel_reason = 'user_declined' WHERE target_type = 'promise' AND target_id = $1 AND status = 'scheduled'`, [p.id]);
        recordType = 'promise';
        recordId = p.id;
        break;
      }
      case 'document': {
        const file = await one<{ storage_key: string; original_name: string; mime_type: string; extracted_text: string | null }>(tx, 'SELECT * FROM capture_files WHERE capture_id = $1 ORDER BY created_at LIMIT 1', [cap.id]);
        const data = file ? await blobStore().get(file.storage_key) : null;
        const { doc } = await createDocument(ctx, ws, {
          title: String(val(c, edits, 'title', c.title)), category: val(c, edits, 'category', 'other') as 'other', issuer: val<string | null>(c, edits, 'issuer', null),
          expiresOn: resolveDate(c, edits, 'expiresOn', false, 'Expiry date'), sourceCaptureId: cap.id,
        }, file && data ? { name: file.original_name, mimeType: file.mime_type, size: data.length, data } : null, tx, file?.extracted_text ?? null);
        recordType = 'document';
        recordId = doc.id;
        break;
      }
      default:
        throw invalid('This kind of suggestion cannot be confirmed yet.');
    }

    await link(tx, { workspaceId: ws, fromType: recordType, fromId: recordId, toType: 'capture', toId: cap.id, relation: 'derived_from', provenance: prov, actorId: ctx.userId });
    await tx.query(`UPDATE extraction_candidates SET status = 'accepted', reviewed_by = $2, reviewed_at = $3, created_record_type = $4, created_record_id = $5 WHERE id = $1`, [candidateId, ctx.userId, ctx.now, recordType, recordId]);
    await recordHistory(tx, { workspaceId: ws, entityType: 'capture', entityId: cap.id, action: 'candidate_accepted', changes: { candidate: candidateId, kind: c.kind, record: `${recordType}:${recordId}`, edited_fields: Object.keys(edits), acknowledged: c.uncertain.map((u) => u.field) }, actorId: ctx.userId });
    const captureStatus = await refreshCaptureStatus(tx, cap.id);
    return { recordType, recordId, captureStatus };
  });
}

export async function rejectCandidate(ctx: Ctx, candidateId: string, reason?: string): Promise<{ captureStatus: string }> {
  return withTx(ctx.db, async (tx) => {
    const c = await one<CandidateRow>(tx, 'SELECT * FROM extraction_candidates WHERE id = $1', [candidateId]);
    if (!c) throw notFound('Suggestion');
    await requireRole(tx, ctx.userId, c.workspace_id, 'write');
    if (c.status !== 'pending') throw invalid('This suggestion was already reviewed.');
    await tx.query(`UPDATE extraction_candidates SET status = 'rejected', reviewed_by = $2, reviewed_at = $3 WHERE id = $1`, [candidateId, ctx.userId, ctx.now]);
    await recordHistory(tx, { workspaceId: c.workspace_id, entityType: 'capture', entityId: c.capture_id, action: 'candidate_rejected', changes: { candidate: candidateId, kind: c.kind, reason: reason ?? null }, actorId: ctx.userId });
    return { captureStatus: await refreshCaptureStatus(tx, c.capture_id) };
  });
}

async function refreshCaptureStatus(q: Queryable, captureId: string): Promise<string> {
  const counts = (await one<{ pending: number; accepted: number }>(q, `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'accepted')::int AS accepted FROM extraction_candidates WHERE capture_id = $1`, [captureId]))!;
  const status = counts.pending > 0 ? 'review_required' : counts.accepted > 0 ? 'confirmed' : 'organized';
  await setStatus(q, captureId, status);
  return status;
}

export async function archiveCapture(ctx: Ctx, id: string, archived = true): Promise<void> {
  const cap = await loadScoped<Capture>(ctx.db, ctx.userId, 'captures', id, 'write', 'Capture');
  await setStatus(ctx.db, id, archived ? 'archived' : 'organized');
  await audit(ctx.db, { actorId: ctx.userId, workspaceId: cap.workspace_id, action: archived ? 'capture.archived' : 'capture.unarchived', entityType: 'capture', entityId: id });
}

/**
 * Deleting a capture. Policy (invariant 25): records the user already
 * confirmed from it are kept — they were confirmed facts, not drafts — and
 * their "source" field is cleared; the capture's own files are deleted
 * (documents saved to the Vault have their own copy). Pending suggestions go.
 */
export async function deleteCapture(ctx: Ctx, id: string): Promise<{ keptRecords: number }> {
  const { keys, kept } = await withTx(ctx.db, async (tx) => {
    const cap = await loadScoped<Capture>(tx, ctx.userId, 'captures', id, 'write', 'Capture');
    const files = await tx.query<{ storage_key: string; size_bytes: number }>('SELECT storage_key, size_bytes FROM capture_files WHERE capture_id = $1', [id]);
    const keptRows = await tx.query(`SELECT 1 FROM extraction_candidates WHERE capture_id = $1 AND status = 'accepted'`, [id]);
    await tx.query(`DELETE FROM life_links WHERE (to_type = 'capture' AND to_id = $1) OR (from_type = 'capture' AND from_id = $1)`, [id]);
    await unindexRecord(tx, 'capture', id);
    await tx.query('DELETE FROM captures WHERE id = $1', [id]);
    const total = files.reduce((n, f) => n + Number(f.size_bytes), 0);
    if (total) await consume(tx, ctx.userId, 'storage_bytes', -total, ctx.now);
    await audit(tx, { actorId: ctx.userId, workspaceId: cap.workspace_id, action: 'capture.deleted', entityType: 'capture', entityId: id, meta: { kept_records: keptRows.length } });
    return { keys: files.map((f) => f.storage_key), kept: keptRows.length };
  });
  for (const k of keys) await blobStore().delete(k);
  return { keptRecords: kept };
}

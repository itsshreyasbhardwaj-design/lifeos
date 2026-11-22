import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './helpers.ts';
import { createCapture, processCapture, getCapture } from '../src/captures.ts';
import { availableOcrLangs } from '../src/ocr.ts';
import { validateUpload } from '../src/files.ts';
import { repoRoot } from '../src/db.ts';

const fixture = (f: string) => readFileSync(join(repoRoot(), 'tests', 'fixtures', f));

test('image capture: local OCR reads a screenshot and suggests the task', { skip: availableOcrLangs().includes('eng') ? false : 'OCR model not installed (pnpm setup:ocr)' }, async () => {
  const { db, user } = await setup();
  const u = await user();
  const { capture } = await createCapture(u.ctx(), u.ws, {}, [validateUpload('screenshot.png', 'image/png', fixture('screenshot.png'))]);
  const r = await processCapture(db, capture.id);
  assert.equal(r.status, 'review_required');
  const { capture: c, candidates } = await getCapture(u.ctx(), capture.id);
  assert.match(c.extracted_text ?? '', /Pay the term fees by 28\/11\/2026 at 5pm/);
  assert.equal(c.extraction_engine, 'tesseract');
  const t = candidates.find((x) => x.kind === 'task' || x.kind === 'deadline')!;
  assert.equal((t.fields.dueDate as { iso: string; time: string }).iso, '2026-11-28');
  assert.equal((t.fields.dueDate as { iso: string; time: string }).time, '17:00');
  await db.close();
});

test('PDF capture: the text layer is read and a receipt yields purchase, warranty and return', async () => {
  const { db, user } = await setup();
  const u = await user();
  const { capture } = await createCapture(u.ctx(), u.ws, { sourceType: 'receipt' }, [validateUpload('receipt.pdf', 'application/pdf', fixture('receipt.pdf'))]);
  await processCapture(db, capture.id);
  const { capture: c, candidates } = await getCapture(u.ctx(), capture.id);
  assert.equal(c.extraction_engine, 'pdf-text');
  assert.deepEqual(candidates.map((x) => x.kind).slice(0, 3), ['purchase', 'warranty', 'return_window']);
  assert.equal(candidates[0]!.fields.amountMinor, 2_999_000);
  await db.close();
});

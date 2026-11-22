/**
 * Measures the hot paths on this machine and prints a markdown table.
 * Everything runs against embedded PostgreSQL in memory, so numbers reflect
 * the code, not network latency. Run: pnpm bench
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, arch } from 'node:os';
import { join } from 'node:path';

process.env.LIFEOS_ARGON_FAST = '1';
process.env.LIFEOS_SECRET ??= 'bench-secret-bench-secret-bench-secret-0123';
process.env.LIFEOS_FILES_DIR = mkdtempSync(join(tmpdir(), 'lifeos-bench-'));
process.env.LIFEOS_FETCH_URLS = '0';

const { connect } = await import('../packages/core/src/db.ts');
const { register } = await import('../packages/core/src/auth.ts');
const { personalWorkspaceId } = await import('../packages/core/src/access.ts');
const { ctxFor } = await import('../packages/core/src/context.ts');
const { createTask, listTasks } = await import('../packages/core/src/tasks.ts');
const { search } = await import('../packages/core/src/search.ts');
const { scheduleReminder, deliverDue } = await import('../packages/core/src/reminders.ts');
const { createCapture, processCapture } = await import('../packages/core/src/captures.ts');
const { extractCandidates } = await import('../packages/extract/src/index.ts');
const { extractText, availableOcrLangs } = await import('../packages/core/src/ocr.ts');
const { validateUpload } = await import('../packages/core/src/files.ts');

const rows: [string, string, string][] = [];
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
async function time(label: string, n: number, fn: (i: number) => Promise<unknown> | unknown, note = '') {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn(i);
    xs.push(performance.now() - t);
  }
  rows.push([label, `p50 ${pct(xs, 50).toFixed(1)} ms · p95 ${pct(xs, 95).toFixed(1)} ms`, `n=${n}${note ? ` · ${note}` : ''}`]);
}

const t0 = performance.now();
const db = await connect({ url: 'memory://' });
rows.push(['Start embedded PostgreSQL + apply migrations', `${(performance.now() - t0).toFixed(0)} ms`, 'n=1, cold']);
const s = await register(db, { email: 'bench@example.test', password: 'bench-password-123', displayName: 'Bench' });
const ws = await personalWorkspaceId(db, s.userId);
const ctx = ctxFor(db, s.userId);

const RECEIPT = 'Croma\nTax Invoice\nInvoice No: CRM/24/88812\nInvoice Date: 15/11/2026\nItem: Sony WH-1000XM5 Headphones Qty 1 ₹29,990.00\nGrand Total ₹29,990.00\n1 year manufacturer warranty.\n7 days replacement policy.';
await time('Extraction engine: receipt → candidates', 500, () => extractCandidates(RECEIPT, { today: '2026-11-22' }));
await time('Create task (with reminder + search index)', 300, (i) => createTask(ctx, ws, { title: `Benchmark task ${i} invoice renewal`, dueDate: '2026-12-01', reminderOffsets: [0] }));
for (let i = 0; i < 1700; i++) await createTask(ctx, ws, { title: `Filler ${i} ${['passport', 'electricity', 'school', 'insurance', 'laptop'][i % 5]}` });
await time('List tasks, "upcoming" view (2,000 tasks)', 50, () => listTasks(ctx, { view: 'upcoming' }));
await time('Full-text search (2,000 indexed records)', 100, () => search(ctx, 'laptop invoice'));
await time('Capture text + run extraction job', 50, async (i) => {
  const { capture } = await createCapture(ctx, ws, { text: `Pay the electricity bill of ₹1,${i}00 by ${String((i % 27) + 1).padStart(2, '0')}/12/2026` });
  await processCapture(db, capture.id);
});
const now = new Date('2026-12-01T10:00:00Z');
for (let i = 0; i < 500; i++) await scheduleReminder(db, { workspaceId: ws, userId: s.userId, targetType: 'document', targetId: `doc_bench_${i}`, kind: 'one_time', title: `R${i}`, fireAt: new Date(now.getTime() - 1000 - i), createdBy: s.userId });
const td = performance.now();
const rep = await deliverDue(db, now, { batch: 500 });
rows.push(['Deliver 500 due reminders (one tick)', `${(performance.now() - td).toFixed(0)} ms`, `delivered=${rep.delivered} cancelled=${rep.cancelled}`]);

const pdfPath = 'tests/fixtures/receipt.pdf';
if (existsSync(pdfPath)) {
  const buf = readFileSync(pdfPath);
  await time('PDF text extraction (1-page receipt)', 10, () => extractText(buf, 'application/pdf'), `${(buf.length / 1024).toFixed(0)} KB`);
}
const pngPath = 'tests/fixtures/screenshot.png';
if (existsSync(pngPath) && availableOcrLangs().includes('eng')) {
  const buf = readFileSync(pngPath);
  await time('Image OCR, Tesseract WASM (screenshot)', 3, () => extractText(buf, 'image/png'), `${(buf.length / 1024).toFixed(0)} KB, includes worker start`);
} else rows.push(['Image OCR', 'not measured', 'fixture or OCR model missing']);
const big = validateUpload('big.txt', 'text/plain', Buffer.alloc(5 * 1024 * 1024, 'a'));
await time('Upload 5 MB file (validate + encrypt + store)', 5, () => createCapture(ctx, ws, {}, [big]));

await db.close();
console.log(`\nHardware: ${cpus()[0]?.model} × ${cpus().length}, ${(totalmem() / 1024 ** 3).toFixed(0)} GB RAM, ${platform()} ${arch()}, Node ${process.version}\n`);
console.log('| Operation | Result | Notes |\n|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);

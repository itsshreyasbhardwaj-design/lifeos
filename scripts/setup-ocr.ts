/**
 * One-time download of Tesseract language models so image OCR runs offline.
 * Source: the tessdata files published for tesseract.js. No account or key.
 *   pnpm setup:ocr            → English
 *   pnpm setup:ocr eng hin ben → English, Hindi, Bengali
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ocrModelDir, OCR_LANGS } from '../packages/core/src/ocr.ts';

const BASE = 'https://tessdata.projectnaptha.com/4.0.0';
const dir = ocrModelDir();
mkdirSync(dir, { recursive: true });
const langs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const lang of langs.length ? langs : ['eng']) {
  if (!(OCR_LANGS as readonly string[]).includes(lang)) throw new Error(`Unknown language ${lang}. Known: ${OCR_LANGS.join(', ')}`);
  const target = join(dir, `${lang}.traineddata.gz`);
  if (existsSync(target)) {
    console.log(`${lang}: already present`);
    continue;
  }
  const res = await fetch(`${BASE}/${lang}.traineddata.gz`);
  if (!res.ok) throw new Error(`${lang}: download failed (HTTP ${res.status})`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log(`${lang}: downloaded`);
}
console.log(`Models in ${dir}. Image OCR now runs offline.`);

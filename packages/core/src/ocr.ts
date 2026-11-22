/**
 * Local text extraction. Nothing leaves the machine.
 *   - PDF: embedded text layer via unpdf (pdf.js). Scans without a text layer
 *     are reported as such, not guessed at.
 *   - Images: Tesseract (WASM) with a model downloaded once by `pnpm setup:ocr`.
 *     Without the model, images are stored and the user is told why no text
 *     was read.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './db.ts';

export type OcrEngine = 'pdf-text' | 'tesseract' | 'plain-text' | 'none';

export interface TextResult {
  engine: OcrEngine;
  status: 'extracted' | 'no_text' | 'unsupported' | 'unavailable' | 'failed';
  text: string;
  note: string | null;
  ms: number;
}

export function ocrModelDir(): string {
  return process.env.LIFEOS_OCR_DIR ?? join(repoRoot(), 'data', 'ocr-models');
}

export const OCR_LANGS = ['eng', 'hin', 'ben'] as const;

export function availableOcrLangs(): string[] {
  return OCR_LANGS.filter((l) => existsSync(join(ocrModelDir(), `${l}.traineddata.gz`)) || existsSync(join(ocrModelDir(), `${l}.traineddata`)));
}

export function normaliseText(t: string): string {
  return t.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractText(data: Buffer, mimeType: string): Promise<TextResult> {
  const started = performance.now();
  const done = (r: Omit<TextResult, 'ms'>): TextResult => ({ ...r, ms: Math.round(performance.now() - started) });
  try {
    if (mimeType === 'text/plain') return done({ engine: 'plain-text', status: 'extracted', text: normaliseText(data.toString('utf8')), note: null });
    if (mimeType === 'application/pdf') {
      const name = 'unpdf';
      const { extractText: pdfText, getDocumentProxy } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as typeof import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await pdfText(pdf, { mergePages: true });
      const clean = normaliseText(String(text ?? ''));
      if (clean.length < 8) return done({ engine: 'pdf-text', status: 'no_text', text: '', note: 'This PDF has no text layer (it is probably a scan). The file is saved; add the details yourself.' });
      return done({ engine: 'pdf-text', status: 'extracted', text: clean, note: null });
    }
    if (mimeType.startsWith('image/')) {
      if (mimeType === 'image/heic') return done({ engine: 'none', status: 'unsupported', text: '', note: 'HEIC photos are saved but cannot be read on this server. Export as JPEG to have the text read.' });
      const langs = availableOcrLangs();
      if (!langs.includes('eng')) {
        return done({ engine: 'none', status: 'unavailable', text: '', note: 'Text recognition for images is not set up on this server (run `pnpm setup:ocr`). The image is saved.' });
      }
      const name = 'tesseract.js';
      const { createWorker } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as typeof import('tesseract.js');
      // A stuck OCR worker must never stall the job queue: give up after the timeout.
      const timeoutMs = Number(process.env.LIFEOS_OCR_TIMEOUT_MS ?? 60_000);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`reading the image took longer than ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      });
      let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
      try {
        worker = await Promise.race([createWorker(langs.join('+'), 1, { langPath: ocrModelDir(), cacheMethod: 'none', gzip: true, logger: () => {} }), timeout]);
        const { data: out } = await Promise.race([worker.recognize(data), timeout]);
        const clean = normaliseText(out.text ?? '');
        if (clean.length < 4) return done({ engine: 'tesseract', status: 'no_text', text: '', note: 'No readable text was found in this image.' });
        return done({ engine: 'tesseract', status: 'extracted', text: clean, note: 'Text was read from an image, so it may contain mistakes. Check every field.' });
      } finally {
        clearTimeout(timer);
        await worker?.terminate().catch(() => undefined);
      }
    }
    if (mimeType.startsWith('audio/')) {
      return done({ engine: 'none', status: 'unsupported', text: '', note: 'Voice notes are saved, but there is no on-device transcription in this build. Add a short note describing it.' });
    }
    return done({ engine: 'none', status: 'unsupported', text: '', note: 'This file type cannot be read automatically.' });
  } catch (err) {
    return done({ engine: 'none', status: 'failed', text: '', note: `The file could not be read automatically (${(err as Error).message.slice(0, 120)}). It is saved; add the details yourself.` });
  }
}

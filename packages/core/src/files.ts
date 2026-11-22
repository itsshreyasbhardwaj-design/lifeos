/**
 * Upload validation: size, an allow-list of types, and a magic-byte check so
 * a file cannot claim to be a PNG while being HTML or an executable.
 */
import { invalid } from './errors.ts';

export const MAX_UPLOAD_BYTES = Number(process.env.LIFEOS_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);

const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['image/heic', (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1)$/.test(b.subarray(8, 12).toString('latin1'))],
  ['application/pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-'],
  ['audio/webm', (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3],
  ['audio/ogg', (b) => b.subarray(0, 4).toString('latin1') === 'OggS'],
  ['audio/wav', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE'],
  ['audio/mpeg', (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)],
  ['audio/mp4', (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(M4A |mp42|isom|M4B )$/.test(b.subarray(8, 12).toString('latin1'))],
];

export const ALLOWED_TYPES = [...SIGNATURES.map(([t]) => t), 'text/plain'] as const;

export function sniff(buf: Buffer): string | null {
  for (const [type, test] of SIGNATURES) if (buf.length >= 12 && test(buf)) return type;
  return looksLikePlainText(buf) ? 'text/plain' : null;
}

function looksLikePlainText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4096);
  if (sample.includes(0)) return false;
  const text = sample.toString('utf8');
  // HTML and SVG are refused: they can carry script.
  if (/<\s*(html|script|svg|iframe|!doctype)/i.test(text)) return false;
  return !text.includes('�');
}

export interface ValidatedFile {
  name: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

export function validateUpload(name: string, claimedType: string, data: Buffer): ValidatedFile {
  if (data.length === 0) throw invalid('The file is empty.');
  if (data.length > MAX_UPLOAD_BYTES) throw invalid(`Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  const actual = sniff(data);
  if (!actual) throw invalid('This file type is not supported. Use an image, PDF, text file or audio note.');
  // Claimed type is advisory; the bytes decide. A mismatch between families is refused.
  const family = (t: string) => t.split('/')[0];
  if (claimedType && claimedType !== 'application/octet-stream' && family(claimedType) !== family(actual) && !(claimedType === 'application/pdf' && actual === 'application/pdf')) {
    throw invalid('The file contents do not match its type.');
  }
  return { name: safeName(name), mimeType: actual, size: data.length, data };
}

export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const clean = base.normalize('NFKC').replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || 'file';
}

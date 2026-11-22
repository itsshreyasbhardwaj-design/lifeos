/** Generates the PWA icons as PNGs with no image library: a navy rounded square, a white "L" and a blue dot. */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../packages/core/src/zip.ts';

function png(size: number, maskable: boolean): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0 : Math.round(size * 0.06);
  const r = maskable ? 0 : Math.round(size * 0.2);
  const set = (x: number, y: number, c: [number, number, number, number]) => px.set(c, (y * size + x) * 4);
  const inRounded = (x: number, y: number) => {
    const lo = pad, hi = size - pad - 1;
    if (x < lo || y < lo || x > hi || y > hi) return false;
    const cx = x < lo + r ? lo + r : x > hi - r ? hi - r : x;
    const cy = y < lo + r ? lo + r : y > hi - r ? hi - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const s = size / 100;
  const inL = (x: number, y: number) => (x >= 34 * s && x <= 46 * s && y >= 26 * s && y <= 72 * s) || (x >= 34 * s && x <= 68 * s && y >= 62 * s && y <= 72 * s);
  const inDot = (x: number, y: number) => (x - 66 * s) ** 2 + (y - 34 * s) ** 2 <= (8 * s) ** 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!inRounded(x, y)) set(x, y, [0, 0, 0, 0]);
    else if (inL(x, y)) set(x, y, [255, 255, 255, 255]);
    else if (inDot(x, y)) set(x, y, [59, 130, 246, 255]);
    else set(x, y, [11, 18, 32, 255]);
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = 'apps/web/public';
writeFileSync(`${out}/icon-192.png`, png(192, false));
writeFileSync(`${out}/icon-512.png`, png(512, false));
writeFileSync(`${out}/icon-maskable-512.png`, png(512, true));
writeFileSync(`${out}/icon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="6" y="6" width="88" height="88" rx="20" fill="#0b1220"/><path d="M34 26h12v36h22v10H34z" fill="#fff"/><circle cx="66" cy="34" r="8" fill="#3b82f6"/></svg>`);
console.log('icons written');

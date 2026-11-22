/**
 * Private file storage. Files are encrypted before they touch disk
 * (envelope encryption, see crypto.ts) and are only ever served through an
 * authorised route — there are no public URLs.
 *
 * The BlobStore interface is what an S3-compatible adapter would implement;
 * only the local adapter exists in this build (see docs/DOCUMENT_VAULT.md).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { decryptBlob, encryptBlob } from './crypto.ts';
import { repoRoot } from './db.ts';

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9_]+\/[a-z0-9_]+$/;

export function storageKey(workspaceId: string, fileId: string): string {
  const key = `${workspaceId}/${fileId}`;
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
  return key;
}

export function localStore(root = process.env.LIFEOS_FILES_DIR ?? join(repoRoot(), 'data', 'files')): BlobStore {
  const base = resolve(root);
  const pathFor = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
    const p = resolve(base, key);
    if (!p.startsWith(base + '/')) throw new Error('Path escapes storage root');
    return p;
  };
  return {
    async put(key, data) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, encryptBlob(data), { mode: 0o600 });
    },
    async get(key) {
      return decryptBlob(await readFile(pathFor(key)));
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

let store: BlobStore | null = null;
export function blobStore(): BlobStore {
  store ??= localStore();
  return store;
}
export function setBlobStore(s: BlobStore): void {
  store = s;
}

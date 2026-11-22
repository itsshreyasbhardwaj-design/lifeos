'use client';

/**
 * Offline queue in IndexedDB. Captures (including files) and quick-added
 * tasks made while offline are stored here with a client id, then replayed
 * when the browser is back online. The server treats the client id as an
 * idempotency key, so a replay after a flaky reconnect cannot duplicate.
 *
 * Privacy: queued items are on this device until synced. They are removed
 * from IndexedDB as soon as the server accepts them.
 */
export interface QueuedCapture {
  clientId: string;
  kind: 'capture';
  createdAt: string;
  workspaceId?: string;
  fields: Record<string, string>;
  files: { name: string; type: string; blob: Blob }[];
}
export interface QueuedTask {
  clientId: string;
  kind: 'task';
  createdAt: string;
  workspaceId: string;
  quick: string;
}
export type Queued = QueuedCapture | QueuedTask;

const DB = 'lifeos-offline';
const STORE = 'queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const newClientId = () => `c${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12)}`;
export const enqueue = (item: Queued) => tx('readwrite', (s) => s.put(item));
export const queued = () => tx<Queued[]>('readonly', (s) => s.getAll() as IDBRequest<Queued[]>);
const remove = (id: string) => tx('readwrite', (s) => s.delete(id));

let flushing = false;

/** Sends everything queued. Returns how many were accepted. */
export async function flush(): Promise<{ sent: number; failed: number }> {
  if (flushing || !navigator.onLine) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of await queued()) {
      try {
        if (item.kind === 'capture') {
          const form = new FormData();
          for (const [k, v] of Object.entries(item.fields)) form.set(k, v);
          form.set('clientId', item.clientId);
          if (item.workspaceId) form.set('workspaceId', item.workspaceId);
          for (const f of item.files) form.append('files', new File([f.blob], f.name, { type: f.type }));
          const res = await fetch('/api/v1/captures', { method: 'POST', body: form, credentials: 'same-origin' });
          if (!res.ok && res.status !== 409) throw new Error(String(res.status));
        } else {
          const res = await fetch('/api/v1/sync', {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ops: [{ op: 'capture.create', clientId: item.clientId, workspaceId: item.workspaceId, payload: { text: item.quick, sourceType: 'note' } }] }),
          });
          if (!res.ok) throw new Error(String(res.status));
        }
        await remove(item.clientId);
        sent++;
      } catch {
        failed++;
      }
    }
  } finally {
    flushing = false;
  }
  if (sent) window.dispatchEvent(new CustomEvent('lifeos:synced', { detail: { sent } }));
  return { sent, failed };
}

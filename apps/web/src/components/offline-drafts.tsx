'use client';

import { useEffect, useState } from 'react';
import { enqueue, flush, newClientId, queued, type Queued } from '@/lib/offline';

export function OfflineDrafts() {
  const [text, setText] = useState('');
  const [items, setItems] = useState<Queued[]>([]);
  const [online, setOnline] = useState(false);
  const reload = () => queued().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    setOnline(navigator.onLine);
    reload();
    const on = async () => { setOnline(true); await flush(); reload(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return (
    <div className="mt-6 space-y-4">
      <form onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await enqueue({ clientId: newClientId(), kind: 'capture', createdAt: new Date().toISOString(), fields: { text, sourceType: 'note' }, files: [] }); setText(''); reload(); }} className="card space-y-2 p-4">
        <label htmlFor="draft" className="label">Quick note</label>
        <textarea id="draft" className="field min-h-28" value={text} onChange={(e) => setText(e.target.value)} placeholder="What do you need to remember?" />
        <button className="btn btn-primary">Save draft on this device</button>
      </form>
      <div className="card p-4">
        <p className="text-sm font-semibold">Waiting to sync ({items.length})</p>
        <ul className="mt-2 space-y-1 text-sm">{items.map((i) => <li key={i.clientId} className="truncate muted">{i.kind === 'capture' ? (i.fields.text ?? i.fields.url ?? `${i.files.length} file(s)`) : i.quick}</li>)}</ul>
        {online && <a href="/app" className="btn mt-3">Back online — open LifeOS</a>}
      </div>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { X } from 'lucide-react';
import { api, useToast } from './api';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  group_name: string;
  kind: string;
  note?: string | null;
}

export function Checklist({ ownerType, ownerId, items, canEdit = true, groupHint }: { ownerType: string; ownerId: string; items: ChecklistItem[]; canEdit?: boolean; groupHint?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const groups = [...new Set(items.map((i) => i.group_name))];
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label="Checklist progress">
            <div className="h-full bg-[var(--color-emerald)] transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs muted">{done} of {items.length} done</p>
        </div>
      )}
      {groups.map((g) => (
        <div key={g} className="mb-3">
          {g && <p className="mb-1 text-xs font-semibold uppercase tracking-wide muted">{g}</p>}
          <ul className="space-y-1">
            {items.filter((i) => i.group_name === g).map((i) => (
              <li key={i.id} className="group flex items-center gap-2 text-sm">
                <input type="checkbox" id={`chk-${i.id}`} checked={i.done} disabled={!canEdit} onChange={async (e) => { try { await api(`/checklists/${i.id}`, { method: 'PATCH', body: { done: e.target.checked } }); router.refresh(); } catch (err) { toast((err as Error).message, 'error'); } }} />
                <label htmlFor={`chk-${i.id}`} className={`flex-1 ${i.done ? 'line-through muted' : ''}`}>{i.label}{i.kind === 'document' && <span className="chip ml-2">document</span>}</label>
                {canEdit && <button className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${i.label}`} onClick={async () => { await api(`/checklists/${i.id}`, { method: 'DELETE' }); router.refresh(); }}><X size={13} /></button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {canEdit && (
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!label.trim()) return; await api('/checklists', { body: { ownerType, ownerId, items: [label], group: groupHint } }); setLabel(''); router.refresh(); }}>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
          <button className="btn">Add</button>
        </form>
      )}
    </div>
  );
}

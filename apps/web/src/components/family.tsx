'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, useToast } from './api';

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setErr(null);
      try {
        const r = await api<{ link: string }>(`/family/${workspaceId}/invites`, { body: { email: f.get('email'), role: f.get('role') } });
        setLink(r.link);
        router.refresh();
      } catch (er) {
        setErr((er as Error).message);
      }
    }}>
      <p className="text-sm font-semibold">Invite someone</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input name="email" type="email" required className="field" placeholder="Their email" aria-label="Email" />
        <select name="role" className="field" aria-label="Role"><option value="member">Member</option><option value="adult">Adult</option><option value="limited">Limited</option></select>
        <button className="btn btn-primary">Create link</button>
      </div>
      {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
      {link && (
        <div className="rounded-lg bg-[var(--color-blue-soft)]/50 p-2 text-xs">
          <p className="mb-1">Send this link yourself (LifeOS doesn’t email it). It works once, for 7 days, and only for that email address.</p>
          <div className="flex gap-2"><input readOnly value={link} className="field !py-1 text-xs" aria-label="Invitation link" onFocus={(e) => e.target.select()} /><button type="button" className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(link); toast('Link copied.'); }}>Copy</button></div>
        </div>
      )}
    </form>
  );
}

export function ShoppingList({ list }: { list: { id: string; name: string; items: { id: string; label: string; quantity: string | null; done: boolean; added_by_name: string | null }[] } }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between"><p className="text-sm font-semibold">{list.name}</p>{list.items.some((i) => i.done) && <button className="btn btn-ghost btn-sm" onClick={async () => { await api(`/shopping/${list.id}/clear`, { body: {} }); router.refresh(); }}>Clear ticked</button>}</div>
      <ul className="space-y-1">{list.items.map((i) => (
        <li key={i.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" id={`si-${i.id}`} checked={i.done} onChange={async (e) => { await api(`/shopping-items/${i.id}`, { method: 'PATCH', body: { done: e.target.checked } }); router.refresh(); }} />
          <label htmlFor={`si-${i.id}`} className={i.done ? 'line-through muted' : ''}>{i.label}{i.quantity ? ` × ${i.quantity}` : ''}</label>
          {i.added_by_name && <span className="text-[11px] muted">· {i.added_by_name}</span>}
        </li>
      ))}</ul>
      <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!label.trim()) return; await api(`/shopping/${list.id}/items`, { body: { label } }); setLabel(''); router.refresh(); }}>
        <input className="field !py-1.5" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add item" aria-label={`Add to ${list.name}`} /><button className="btn btn-sm">Add</button>
      </form>
    </div>
  );
}

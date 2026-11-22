'use client';

import { useMemo, useState } from 'react';
import { Bell, Check, Quote } from 'lucide-react';
import { extractCandidates, type Candidate } from '@lifeos/extract';

const SAMPLES = [
  { label: 'School message', text: 'Hi parents, reminder: submit the field trip consent form by 28/11/2026. The annual day rehearsal is on 2 Dec 2026 at 4pm in the school hall. Please also pay the bus fee before 30/11/2026.' },
  { label: 'Electronics receipt', text: 'Croma\nTax Invoice\nInvoice No: CRM/26/10442\nInvoice Date: 15/11/2026\nItem: Noise-cancelling headphones   Qty 1   ₹14,990.00\nGrand Total ₹14,990.00\n1 year manufacturer warranty.\n7 days replacement policy.' },
  { label: 'Refund email', text: 'Your refund of ₹2,499 for order 402-5550198-0014 will be processed within 5-7 business days.' },
];

const fieldDate = (v: unknown) => (v && typeof v === 'object' && 'iso' in (v as object) ? ((v as { iso: string | null }).iso ?? `“${(v as { written: string }).written}” — year needed`) : typeof v === 'string' ? v : null);

export function Demo() {
  const [text, setText] = useState(SAMPLES[0]!.text);
  const [state, setState] = useState<Record<string, 'confirmed' | 'done' | 'dismissed'>>({});
  const today = '2026-11-22';
  const out = useMemo(() => extractCandidates(text, { today }), [text]);
  const dateOf = (c: Candidate) => fieldDate(c.fields.dueDate ?? c.fields.date ?? c.fields.deadline ?? c.fields.endsOn ?? c.fields.expectedBy ?? c.fields.purchaseDate);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-xs">
        <span className="font-semibold">Interactive demo · fictional sample data · runs in your browser · nothing is saved</span>
        <span className="flex gap-1.5">{SAMPLES.map((s) => <button key={s.label} className={`btn btn-sm ${text === s.text ? 'btn-primary' : ''}`} onClick={() => { setText(s.text); setState({}); }}>{s.label}</button>)}</span>
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b border-[var(--line)] p-4 md:border-b-0 md:border-r">
          <label htmlFor="demo-text" className="label">1 · Capture (edit it, or paste your own)</label>
          <textarea id="demo-text" className="field min-h-56 font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); setState({}); }} />
          <p className="mt-2 text-xs muted">Relative dates are read as if today were {today}.</p>
        </div>
        <div className="space-y-3 p-4">
          <p className="label">2 · Review what LifeOS understood</p>
          {out.candidates.length === 0 && <p className="text-sm muted">Nothing to suggest yet — try one of the samples.</p>}
          {out.candidates.map((c) => {
            const st = state[c.key];
            if (st === 'dismissed') return null;
            return (
              <div key={c.key} className={`rounded-xl border p-3 ${st === 'done' ? 'border-[var(--color-emerald)] opacity-70' : 'border-[var(--line)]'}`}>
                <div className="flex items-center justify-between gap-2"><span className="chip chip-blue">{c.kind.replace('_', ' ')}</span>{c.uncertain.length > 0 && !st && <span className="chip chip-amber">{c.uncertain.length} to check</span>}</div>
                <p className={`mt-2 text-sm font-semibold ${st === 'done' ? 'line-through' : ''}`}>{c.title}</p>
                {dateOf(c) && <p className="text-xs muted">{dateOf(c)}</p>}
                <p className="evidence mt-2 text-xs"><Quote size={11} className="mr-1 inline" aria-hidden />{c.evidence[0]?.excerpt}</p>
                {!st && c.uncertain.slice(0, 1).map((u) => <p key={u.message} className="warn mt-2 text-xs">{u.message}</p>)}
                <div className="mt-2 flex gap-2">
                  {!st && <><button className="btn btn-sm btn-primary" onClick={() => setState((s) => ({ ...s, [c.key]: 'confirmed' }))}>Confirm</button><button className="btn btn-sm" onClick={() => setState((s) => ({ ...s, [c.key]: 'dismissed' }))}>Dismiss</button></>}
                  {st === 'confirmed' && <><span className="chip chip-green"><Bell size={11} aria-hidden /> Reminder set</span><button className="btn btn-sm" onClick={() => setState((s) => ({ ...s, [c.key]: 'done' }))}><Check size={13} /> Mark done</button></>}
                  {st === 'done' && <span className="chip chip-green"><Check size={11} aria-hidden /> Completed — source kept</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

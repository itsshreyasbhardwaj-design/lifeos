'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Quote } from 'lucide-react';
import { api, useToast } from './api';

export interface Candidate {
  id: string;
  kind: string;
  title: string;
  status: string;
  fields: Record<string, unknown>;
  evidence: { excerpt: string; start: number; end: number }[];
  uncertain: { field: string; reason: string; message: string; alternatives?: unknown[] }[];
  provenance: { engine?: string; rules?: string[]; anchor?: string; documentType?: string };
  created_record_type: string | null;
  created_record_id: string | null;
}

interface DateValue {
  iso: string | null;
  partial: { y: number | null; m: number | null; d: number | null };
  written: string;
  time: string | null;
}

const KIND_LABEL: Record<string, string> = {
  task: 'Task', deadline: 'Deadline', event: 'Appointment', purchase: 'Purchase', warranty: 'Warranty', return_window: 'Return window',
  subscription: 'Subscription', bill: 'Bill', promise: 'Commitment', document: 'Document',
};

const RECORD_LINK: Record<string, (id: string) => string> = {
  task: (id) => `/app/tasks/${id}`, calendar_event: (id) => `/app/calendar?event=${id}`, purchase: (id) => `/app/purchases/${id}`, warranty: () => '/app/purchases',
  return_window: () => '/app/purchases', subscription: (id) => `/app/subscriptions#${id}`, bill: (id) => `/app/bills#${id}`, promise: (id) => `/app/promises#${id}`, document: (id) => `/app/vault/${id}`,
};

type FieldSpec = { key: string; label: string; type: 'text' | 'date' | 'time' | 'money' | 'select' | 'textarea' | 'readonly'; options?: [string, string][] };

const CYCLES: [string, string][] = [['', 'Choose…'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
const FIELDS: Record<string, FieldSpec[]> = {
  task: [{ key: 'title', label: 'Task', type: 'text' }, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'dueTime', label: 'Time', type: 'time' }],
  deadline: [{ key: 'title', label: 'What is due', type: 'text' }, { key: 'dueDate', label: 'Deadline', type: 'date' }, { key: 'dueTime', label: 'Time', type: 'time' }],
  event: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'startTime', label: 'Starts', type: 'time' }, { key: 'endTime', label: 'Ends', type: 'time' }, { key: 'location', label: 'Where', type: 'text' }],
  purchase: [
    { key: 'productName', label: 'Product', type: 'text' }, { key: 'merchant', label: 'Seller', type: 'text' }, { key: 'purchaseDate', label: 'Purchase date', type: 'date' },
    { key: 'amountMinor', label: 'Amount paid', type: 'money' }, { key: 'orderRef', label: 'Order / invoice number', type: 'text' }, { key: 'deliveryDate', label: 'Delivered on', type: 'date' },
    { key: 'category', label: 'Category', type: 'select', options: [['', '—'], ['electronics', 'Electronics'], ['appliances', 'Appliances'], ['furniture', 'Furniture'], ['clothing', 'Clothing'], ['vehicle', 'Vehicle'], ['other', 'Other']] },
  ],
  warranty: [{ key: 'startsOn', label: 'Warranty starts', type: 'date' }, { key: 'endsOn', label: 'Warranty ends', type: 'date' }, { key: 'terms', label: 'Wording in the document', type: 'readonly' }],
  return_window: [{ key: 'deadline', label: 'Last day to return', type: 'date' }, { key: 'terms', label: 'Wording in the document', type: 'readonly' }],
  subscription: [{ key: 'name', label: 'Service', type: 'text' }, { key: 'amountMinor', label: 'Price', type: 'money' }, { key: 'cycle', label: 'Renews', type: 'select', options: CYCLES }, { key: 'nextRenewalDate', label: 'Next renewal', type: 'date' }, { key: 'trialEndsOn', label: 'Trial ends', type: 'date' }],
  bill: [
    { key: 'name', label: 'Bill', type: 'text' }, { key: 'amountMinor', label: 'Amount (blank if it varies)', type: 'money' }, { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'cycle', label: 'Repeats', type: 'select', options: [['', 'Choose…'], ['once', 'Just once'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']] },
    { key: 'category', label: 'Type', type: 'select', options: [['other', 'Other'], ['electricity', 'Electricity'], ['water', 'Water'], ['gas', 'Gas'], ['internet', 'Internet'], ['mobile', 'Mobile'], ['rent', 'Rent'], ['education', 'Education'], ['insurance', 'Insurance'], ['maintenance', 'Maintenance'], ['membership', 'Membership']] },
  ],
  promise: [
    { key: 'direction', label: 'Who promised', type: 'select', options: [['i_promised', 'I promised'], ['they_promised', 'They promised me'], ['waiting_on', 'I am waiting on this']] },
    { key: 'description', label: 'What', type: 'textarea' }, { key: 'counterparty', label: 'With', type: 'text' }, { key: 'expectedBy', label: 'Expected by', type: 'date' },
  ],
  document: [
    { key: 'title', label: 'Title', type: 'text' }, { key: 'issuer', label: 'Issued by', type: 'text' }, { key: 'expiresOn', label: 'Expires', type: 'date' },
    { key: 'category', label: 'Category', type: 'select', options: [['other', 'Other'], ['certificate', 'Certificate'], ['insurance', 'Insurance'], ['travel', 'Travel'], ['membership', 'Membership'], ['agreement', 'Agreement'], ['administrative', 'Administrative'], ['education', 'Education'], ['identity', 'Identity']] },
  ],
};

function initialValue(v: unknown, type: FieldSpec['type']): string {
  if (v === null || v === undefined) return '';
  if (type === 'money') return typeof v === 'number' ? (v / 100).toFixed(v % 100 === 0 ? 0 : 2) : '';
  if (typeof v === 'object' && 'iso' in (v as object)) return (v as DateValue).iso ?? '';
  return String(v);
}

function timeFrom(fields: Record<string, unknown>, key: string): string {
  const dateKey = key === 'dueTime' ? 'dueDate' : key === 'startTime' ? 'date' : null;
  if (typeof fields[key] === 'string') return fields[key] as string;
  if (dateKey && fields[dateKey] && typeof fields[dateKey] === 'object') return (fields[dateKey] as DateValue).time ?? '';
  return '';
}

function CandidateCard({ c, anchor }: { c: Candidate; anchor?: string }) {
  const router = useRouter();
  const toast = useToast();
  const specs = FIELDS[c.kind] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(specs.map((s) => [s.key, s.type === 'time' ? timeFrom(c.fields, s.key) : initialValue(c.fields[s.key], s.type)])));
  const [original] = useState(values);
  const [remind, setRemind] = useState(true);
  const [saveReceipt, setSaveReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));

  if (c.status !== 'pending') {
    return (
      <article className="card p-4 opacity-90" aria-label={`${KIND_LABEL[c.kind]} — ${c.status}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm"><span className="chip mr-2">{KIND_LABEL[c.kind] ?? c.kind}</span><span className="font-medium">{c.title}</span></p>
          {c.status === 'accepted' ? (
            <Link href={RECORD_LINK[c.created_record_type ?? '']?.(c.created_record_id ?? '') ?? '/app'} className="chip chip-green"><CheckCircle2 size={12} aria-hidden /> Saved — open</Link>
          ) : (
            <span className="chip">Dismissed</span>
          )}
        </div>
      </article>
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const fields: Record<string, unknown> = {};
    for (const s of specs) {
      if (s.type === 'readonly') continue;
      if (values[s.key] === original[s.key]) continue;
      const v = values[s.key]!;
      fields[s.key] = v === '' ? null : s.type === 'money' ? Math.round(Number(v.replace(/[,₹\s]/g, '')) * 100) : v;
    }
    // Choices the user must make even when they leave the default.
    for (const k of ['cycle', 'direction']) if (specs.some((s) => s.key === k) && values[k] && !(k in fields)) fields[k] = values[k];
    if (c.kind === 'purchase') fields.saveReceipt = saveReceipt;
    try {
      await api(`/candidates/${c.id}/confirm`, { body: { fields, acknowledgeUncertain: true, remind } });
      toast(`${KIND_LABEL[c.kind]} saved${remind && c.kind !== 'purchase' && c.kind !== 'document' ? ' with a reminder' : ''}.`);
      router.refresh();
    } catch (err) {
      const e = err as Error & { details?: { field?: string } };
      setError({ message: e.message, field: e.details?.field });
    } finally {
      setBusy(false);
    }
  }

  const flagged = new Map(c.uncertain.map((u) => [u.field, u]));
  const remindLabel: Record<string, string> = {
    task: 'Remind me when it is due', deadline: 'Remind me on the deadline', event: 'Remind me before it starts', warranty: 'Remind me 30 and 7 days before it ends',
    return_window: 'Remind me 2 days before and on the last day', subscription: 'Remind me 3 days before it renews', bill: 'Remind me 3 days before and on the due date', promise: 'Remind me to follow up on the expected date',
  };

  return (
    <article className="card p-4" aria-label={`Suggested ${KIND_LABEL[c.kind] ?? c.kind}`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="chip chip-blue">{KIND_LABEL[c.kind] ?? c.kind}</span>
        {c.uncertain.length > 0 && <span className="chip chip-amber"><AlertTriangle size={12} aria-hidden /> {c.uncertain.length} to check</span>}
      </header>
      {c.evidence.slice(0, 2).map((e, i) => (
        <blockquote key={i} className="evidence mb-3"><Quote size={12} className="mr-1 inline text-[var(--color-violet)]" aria-hidden />{e.excerpt}</blockquote>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        {specs.map((s) => {
          const u = flagged.get(s.key);
          const raw = c.fields[s.key];
          const partial = raw && typeof raw === 'object' && 'partial' in (raw as object) ? (raw as DateValue) : null;
          const id = `${c.id}-${s.key}`;
          return (
            <div key={s.key} className={s.type === 'textarea' || s.type === 'readonly' || s.key === 'title' || s.key === 'productName' ? 'sm:col-span-2' : ''}>
              <label htmlFor={id} className="label">{s.label}</label>
              {s.type === 'readonly' ? (
                <p id={id} className="text-sm muted">{String(raw ?? '—')}</p>
              ) : s.type === 'select' ? (
                <select id={id} className="field" value={values[s.key]} onChange={(e) => set(s.key, e.target.value)}>
                  {s.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : s.type === 'textarea' ? (
                <textarea id={id} className="field min-h-16" value={values[s.key]} onChange={(e) => set(s.key, e.target.value)} />
              ) : (
                <input id={id} className="field" type={s.type === 'money' ? 'text' : s.type} inputMode={s.type === 'money' ? 'decimal' : undefined} value={values[s.key]} onChange={(e) => set(s.key, e.target.value)} aria-invalid={error?.field === s.key || undefined} aria-describedby={u ? `${id}-u` : undefined} />
              )}
              {u && (
                <div id={`${id}-u`} className="warn mt-1.5">
                  <p><AlertTriangle size={12} className="mr-1 inline" aria-hidden />{u.message}</p>
                  {u.reason === 'year_missing' && partial?.partial.m && partial.partial.d && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[0, 1].map((k) => {
                        const y = Number((anchor ?? new Date().toISOString()).slice(0, 4)) + k;
                        const iso = `${y}-${String(partial.partial.m).padStart(2, '0')}-${String(partial.partial.d).padStart(2, '0')}`;
                        return <button key={y} type="button" className={`btn btn-sm ${values[s.key] === iso ? 'btn-primary' : ''}`} onClick={() => set(s.key, iso)}>{iso}</button>;
                      })}
                    </div>
                  )}
                  {u.alternatives && u.alternatives.length > 1 && typeof u.alternatives[0] === 'string' && /^\d{4}-/.test(String(u.alternatives[0])) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(u.alternatives as string[]).map((a) => <button key={a} type="button" className={`btn btn-sm ${values[s.key] === a ? 'btn-primary' : ''}`} onClick={() => set(s.key, a)}>{a}</button>)}
                    </div>
                  )}
                  {u.alternatives && typeof u.alternatives[0] === 'number' && s.type === 'money' && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(u.alternatives as number[]).map((a) => <button key={a} type="button" className="btn btn-sm" onClick={() => set(s.key, (a / 100).toFixed(a % 100 === 0 ? 0 : 2))}>₹{(a / 100).toLocaleString('en-IN')}</button>)}
                    </div>
                  )}
                  {u.alternatives && s.key === 'direction' && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(u.alternatives as string[]).map((a) => <button key={a} type="button" className={`btn btn-sm ${values.direction === a ? 'btn-primary' : ''}`} onClick={() => set('direction', a)}>{a.replace('_', ' ')}</button>)}
                    </div>
                  )}
                </div>
              )}
              {partial && !partial.iso && !u && <p className="mt-1 text-xs text-amber-700">Written as “{partial.written}” — choose the full date.</p>}
            </div>
          );
        })}
      </div>
      {c.fields.recurrence ? <p className="mt-3 text-xs"><span className="chip">Repeats: {JSON.stringify(c.fields.recurrence).replace(/[{}"]/g, '').replace(/,/g, ', ')}</span></p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        {remindLabel[c.kind] && <label className="flex items-center gap-2"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> {remindLabel[c.kind]}</label>}
        {c.kind === 'purchase' && <label className="flex items-center gap-2"><input type="checkbox" checked={saveReceipt} onChange={(e) => setSaveReceipt(e.target.checked)} /> Save the original as the receipt in Documents</label>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{error.message}</p>}
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] muted">Suggested by {c.provenance.engine === 'user' ? 'you' : `${c.provenance.engine ?? 'rules'} · ${(c.provenance.rules ?? []).join(', ')}`}{c.provenance.anchor ? ` · relative dates counted from ${c.provenance.anchor}` : ''}</p>
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={async () => { await api(`/candidates/${c.id}/reject`, { body: {} }); router.refresh(); }}>Dismiss</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={confirm}>{busy ? 'Saving…' : 'Confirm'}</button>
        </div>
      </footer>
    </article>
  );
}

export function ReviewBoard({ candidates, anchor }: { candidates: Candidate[]; anchor?: string }) {
  const order = ['purchase', 'warranty', 'return_window', 'deadline', 'task', 'event', 'bill', 'subscription', 'promise', 'document'];
  const sorted = [...candidates].sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending') || order.indexOf(a.kind) - order.indexOf(b.kind));
  return <div className="space-y-4">{sorted.map((c) => <CandidateCard key={c.id} c={c} anchor={anchor} />)}</div>;
}

export function ProcessingWatcher({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!['queued', 'processing'].includes(status)) return;
    const t = setInterval(async () => {
      const r = await api<{ capture: { status: string } }>(`/captures/${id}`).catch(() => null);
      if (r && !['queued', 'processing'].includes(r.capture.status)) router.refresh();
    }, 1200);
    return () => clearInterval(t);
  }, [id, status, router]);
  if (!['queued', 'processing'].includes(status)) return null;
  return <p role="status" className="flex items-center gap-2 text-sm muted"><Loader2 size={16} className="animate-spin" aria-hidden /> Reading your capture… images can take a few seconds.</p>;
}

export function ManualSuggestion({ captureId }: { captureId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState('task');
  const [title, setTitle] = useState('');
  return (
    <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; await api(`/captures/${captureId}/candidates`, { body: { kind, title } }); setTitle(''); router.refresh(); }}>
      <select aria-label="Kind" className="field !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
        {Object.entries(KIND_LABEL).filter(([k]) => !['warranty', 'return_window'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input aria-label="Title" className="field min-w-48 flex-1" placeholder="What should LifeOS remember?" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn">Add</button>
    </form>
  );
}

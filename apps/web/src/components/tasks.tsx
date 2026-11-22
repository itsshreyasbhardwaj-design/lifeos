'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Check, Flag, Repeat, Users } from 'lucide-react';
import { parseQuickAdd } from '@lifeos/extract';
import { api, useToast } from './api';
import { enqueue, newClientId } from '@/lib/offline';

export function QuickAdd({ today, placeholder, workspaceId, locale }: { today: string; placeholder: string; workspaceId: string; locale: string }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (text.trim().length > 2 ? parseQuickAdd(text, { today, locale }) : null), [text, today, locale]);
  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      await api('/tasks', { body: { quick: text, workspaceId } });
      setText('');
      toast(parsed?.dueDate ? `Added for ${parsed.interpretation.split(' · ')[1]}` : 'Task added');
      router.refresh();
    } catch (err) {
      if (err instanceof TypeError) {
        await enqueue({ clientId: newClientId(), kind: 'task', createdAt: new Date().toISOString(), workspaceId, quick: text });
        setText('');
        toast('Saved offline as a note. It will reach your Inbox when you reconnect.');
      } else toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card p-3">
      <label htmlFor="quick-add" className="sr-only">Quick add a task</label>
      <div className="flex gap-2">
        <input id="quick-add" className="field" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoComplete="off" />
        <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>Add</button>
      </div>
      {parsed && (
        <p className="mt-2 text-xs" aria-live="polite">
          <span className="muted">Will save as </span>
          <span className="font-semibold">{parsed.interpretation}</span>
          {parsed.uncertain.map((u) => <span key={u.message} className="ml-2 text-amber-700">· {u.message}</span>)}
        </p>
      )}
    </div>
  );
}

export interface TaskRowData {
  id: string;
  title: string;
  status: string;
  priority: number;
  due_date: string | null;
  due_time: string | null;
  tags?: string[];
  series_id?: string | null;
  workspace_kind?: string;
  workspace_name?: string;
  assignee_name?: string | null;
  waiting_on?: string | null;
  subtask_count?: number;
  subtasks_done?: number;
  kind?: string;
}

export function TaskRow({ t, today, selectable, selected, onSelect }: { t: TaskRowData; today: string; selectable?: boolean; selected?: boolean; onSelect?: (id: string, v: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [done, setDone] = useState(t.status === 'completed');
  const overdue = !done && t.due_date && t.due_date < today;
  async function toggle() {
    const next = !done;
    setDone(next);
    try {
      const r = await api<{ next: { due_date: string } | null }>(`/tasks/${t.id}/status`, { body: { status: next ? 'completed' : 'open' } });
      if (next) toast(r.next ? `Done. Next one is on ${r.next.due_date}.` : 'Done.');
      router.refresh();
    } catch (err) {
      setDone(!next);
      toast((err as Error).message, 'error');
    }
  }
  return (
    <li className="flex items-start gap-3 py-2.5">
      {selectable && <input type="checkbox" className="mt-1.5" aria-label={`Select ${t.title}`} checked={selected} onChange={(e) => onSelect?.(t.id, e.target.checked)} />}
      <button onClick={toggle} role="checkbox" aria-checked={done} aria-label={`${done ? 'Reopen' : 'Complete'} ${t.title}`}
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition ${done ? 'border-[var(--color-emerald)] bg-[var(--color-emerald)] text-white' : 'border-slate-300 hover:border-[var(--color-emerald)]'}`}>
        {done && <Check size={13} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/app/tasks/${t.id}`} className={`text-sm font-medium hover:underline ${done ? 'line-through muted' : ''}`}>{t.title}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {t.due_date && <span className={overdue ? 'chip chip-rose' : t.due_date === today ? 'chip chip-amber' : 'chip chip-blue'}>{overdue ? 'Overdue · ' : ''}{t.due_date}{t.due_time ? ` ${t.due_time}` : ''}</span>}
          {t.priority > 0 && <span className="chip"><Flag size={11} aria-hidden /> P{4 - t.priority}</span>}
          {t.series_id && <span className="chip" title="Repeats"><Repeat size={11} aria-hidden /> repeats</span>}
          {t.status === 'waiting' && <span className="chip chip-violet">Waiting{t.waiting_on ? ` on ${t.waiting_on}` : ''}</span>}
          {t.kind && t.kind !== 'task' && <span className="chip">{t.kind.replace(/_/g, ' ')}</span>}
          {t.workspace_kind === 'family' && <span className="chip chip-violet"><Users size={11} aria-hidden /> {t.workspace_name}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span>}
          {(t.subtask_count ?? 0) > 0 && <span className="chip">{t.subtasks_done}/{t.subtask_count} subtasks</span>}
          {t.tags?.map((tag) => <span key={tag} className="chip">#{tag}</span>)}
        </div>
      </div>
    </li>
  );
}

export function TaskList({ tasks, today, bulk }: { tasks: TaskRowData[]; today: string; bulk?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [date, setDate] = useState('');
  const onSelect = (id: string, v: boolean) => setSel((s) => {
    const n = new Set(s);
    if (v) n.add(id);
    else n.delete(id);
    return n;
  });
  async function run(action: unknown) {
    const r = await api<{ ok: string[]; failed: { error: string }[] }>('/tasks/bulk', { body: { ids: [...sel], action } });
    toast(`${r.ok.length} updated${r.failed.length ? `, ${r.failed.length} could not be (${r.failed[0]!.error})` : ''}`, r.failed.length ? 'error' : 'ok');
    setSel(new Set());
    router.refresh();
  }
  return (
    <>
      {bulk && sel.size > 0 && (
        <div className="sticky top-14 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--color-navy)] px-3 py-2 text-sm text-white">
          <span className="font-semibold">{sel.size} selected</span>
          <button className="btn btn-sm" onClick={() => run({ kind: 'complete' })}>Complete</button>
          <input type="date" className="field !w-auto !py-1 text-sm" aria-label="Reschedule to" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn-sm" disabled={!date} onClick={() => run({ kind: 'reschedule', dueDate: date })}>Reschedule</button>
          <button className="btn btn-sm btn-danger" onClick={() => run({ kind: 'cancel' })}>Cancel tasks</button>
        </div>
      )}
      <ul className="divide-y divide-[var(--line)]">
        {tasks.map((t) => <TaskRow key={t.id} t={t} today={today} selectable={bulk} selected={sel.has(t.id)} onSelect={onSelect} />)}
      </ul>
    </>
  );
}

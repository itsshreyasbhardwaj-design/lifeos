'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type DragEvent } from 'react';
import { api, useToast } from './api';

export interface Item {
  type: string;
  id: string;
  title: string;
  date: string;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay: boolean;
  nature: 'fixed' | 'deadline' | 'flexible';
  status?: string | null;
  workspaceName: string;
  link: string;
  recurring?: boolean;
  version?: number;
}

const TONE: Record<string, string> = {
  event: 'bg-[var(--color-blue-soft)] text-blue-900 border-blue-300',
  task: 'bg-[var(--color-emerald-soft)] text-emerald-900 border-emerald-300',
  bill: 'bg-[var(--color-amber-soft)] text-amber-900 border-amber-300',
  renewal: 'bg-[var(--color-violet-soft)] text-violet-900 border-violet-300',
  trial_end: 'bg-[var(--color-violet-soft)] text-violet-900 border-violet-300',
  warranty_end: 'bg-[var(--color-rose-soft)] text-rose-900 border-rose-300',
  return_deadline: 'bg-[var(--color-rose-soft)] text-rose-900 border-rose-300',
  document_expiry: 'bg-[var(--color-rose-soft)] text-rose-900 border-rose-300',
};

function timeOf(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}
function hourOf(iso: string, tz: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(iso)));
}

function Chip({ it, tz, draggable }: { it: Item; tz: string; draggable: boolean }) {
  return (
    <Link href={it.link} draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/lifeos-event', JSON.stringify({ id: it.id, version: it.version, start: it.startsAt })); e.dataTransfer.effectAllowed = 'move'; }}
      title={`${it.title}${it.nature === 'deadline' ? ' (deadline)' : it.nature === 'flexible' ? ' (flexible)' : ''}${draggable ? ' — drag to reschedule' : ''}`}
      className={`block truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE[it.type] ?? TONE.event} ${it.nature === 'flexible' ? 'border-dashed' : ''} ${it.status === 'completed' ? 'line-through opacity-60' : ''} ${draggable ? 'cursor-grab' : ''}`}>
      {it.startsAt && !it.allDay ? `${timeOf(it.startsAt, tz)} ` : ''}{it.title}
    </Link>
  );
}

export function CalendarGrid({ view, days, items, today, tz }: { view: 'month' | 'week' | 'day'; days: string[]; items: Item[]; today: string; tz: string }) {
  const router = useRouter();
  const toast = useToast();
  const [over, setOver] = useState<string | null>(null);
  const movable = (it: Item) => it.type === 'event' && !it.recurring;
  async function drop(e: DragEvent, date: string, hour?: number) {
    e.preventDefault();
    setOver(null);
    const raw = e.dataTransfer.getData('text/lifeos-event');
    if (!raw) return;
    const { id, version } = JSON.parse(raw) as { id: string; version?: number };
    try {
      const r = await api<{ conflicts: { title: string }[] }>(`/calendar/events/${id}/move`, { body: { date, startTime: hour !== undefined ? `${String(hour).padStart(2, '0')}:00` : null, expectedVersion: version } });
      toast(r.conflicts.length ? `Moved. Overlaps with: ${r.conflicts.map((c) => c.title).join(', ')}` : 'Moved.', r.conflicts.length ? 'error' : 'ok');
      router.refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
  const byDay = (d: string) => items.filter((i) => i.date === d);
  if (view === 'month') {
    return (
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-[var(--line)] text-center text-[11px] font-semibold uppercase muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1.5">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.map((d) => (
            <div key={d} onDragOver={(e) => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, d)}
              className={`min-h-24 border-b border-r border-[var(--line)] p-1 ${over === d ? 'bg-[var(--color-blue-soft)]/50' : ''} ${d.slice(5, 7) !== days[10]!.slice(5, 7) ? 'opacity-50' : ''}`} aria-label={d}>
              <p className={`mb-0.5 text-right text-xs ${d === today ? 'font-bold text-[var(--color-blue)]' : 'muted'}`}>{Number(d.slice(8))}</p>
              <div className="space-y-0.5">{byDay(d).slice(0, 4).map((it) => <Chip key={`${it.type}${it.id}${it.date}`} it={it} tz={tz} draggable={movable(it)} />)}{byDay(d).length > 4 && <p className="text-[10px] muted">+{byDay(d).length - 4} more</p>}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const hours = Array.from({ length: 16 }, (_, i) => i + 7);
  return (
    <div className="card overflow-x-auto">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0,1fr))` }}>
        <div />
        {days.map((d) => <div key={d} className={`border-b border-[var(--line)] px-1 py-1.5 text-center text-xs font-semibold ${d === today ? 'text-[var(--color-blue)]' : ''}`}>{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</div>)}
        <div className="border-b border-[var(--line)] py-1 text-right text-[10px] muted pr-1">all day</div>
        {days.map((d) => <div key={d} className="space-y-0.5 border-b border-l border-[var(--line)] p-1" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, d)}>{byDay(d).filter((i) => i.allDay || !i.startsAt).map((it) => <Chip key={`${it.type}${it.id}`} it={it} tz={tz} draggable={movable(it)} />)}</div>)}
        {hours.map((h) => (
          <div key={h} className="contents">
            <div className="pr-1 pt-0.5 text-right text-[10px] muted">{h}:00</div>
            {days.map((d) => (
              <div key={d} onDragOver={(e) => { e.preventDefault(); setOver(`${d}-${h}`); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, d, h)}
                className={`min-h-10 space-y-0.5 border-l border-t border-[var(--line)] p-0.5 ${over === `${d}-${h}` ? 'bg-[var(--color-blue-soft)]/50' : ''}`}>
                {byDay(d).filter((i) => !i.allDay && i.startsAt && hourOf(i.startsAt, tz) === h).map((it) => <Chip key={`${it.type}${it.id}`} it={it} tz={tz} draggable={movable(it)} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

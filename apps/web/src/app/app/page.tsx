import Link from 'next/link';
import { ArrowRight, Inbox as InboxIcon, Sparkles } from 'lucide-react';
import { requireSession } from '@/server/session';
import { todayDashboard, suggestNextActions } from '@lifeos/core/intelligence';
import { localParts } from '@lifeos/core/time';
import { t as translate } from '@/i18n/messages';
import { Empty, Section } from '@/components/ui';
import { QuickAdd, TaskList } from '@/components/tasks';
import { ApiButton } from '@/components/api';
import { fmtDate, fmtTime, humanize } from '@/lib/format';

export const metadata = { title: 'Today' };

export default async function TodayPage() {
  const s = await requireSession();
  const tr = translate(s.user.locale);
  await suggestNextActions(s.ctx).catch(() => 0);
  const d = await todayDashboard(s.ctx);
  const hour = Number(localParts(new Date(), s.user.timezone).time.slice(0, 2));
  const greet = hour < 12 ? tr('today.greeting.morning') : hour < 17 ? tr('today.greeting.afternoon') : tr('today.greeting.evening');
  const dueTasks = d.items.filter((i) => i.type === 'task' && i.status !== 'completed');
  const schedule = d.items.filter((i) => i.type !== 'task');
  type T = { id: string; title: string; due_date: string; priority: number };
  const overdue = d.overdue as T[];
  const taskRows = [...overdue.map((t) => ({ ...t, status: 'open', due_time: null })), ...dueTasks.map((i) => ({ id: i.id, title: i.title, status: i.status ?? 'open', priority: 0, due_date: i.date, due_time: i.startsAt ? fmtTime(i.startsAt, s.user.timezone) : null }))];
  const nothing = taskRows.length === 0 && schedule.length === 0 && d.unreviewed.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm muted">{fmtDate(d.today, s.user.locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="h1">{greet}, {s.user.display_name.split(' ')[0]}</h1>
      </div>

      {!s.user.onboarded_at && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-[var(--color-blue)] bg-[var(--color-blue-soft)]/40 p-4">
          <div>
            <p className="font-semibold">Start with one real thing</p>
            <p className="text-sm muted">Capture a screenshot, receipt or message, confirm what it means, and see it here. Takes about a minute.</p>
          </div>
          <Link href="/onboarding" className="btn btn-primary">Get started <ArrowRight size={16} /></Link>
        </div>
      )}

      <QuickAdd today={d.today} placeholder={tr('task.quickAdd')} workspaceId={s.active.workspaceId} locale={s.user.locale} />

      {nothing && <Empty title={tr('today.allClear')}>Press <kbd className="rounded border px-1">C</kbd> anywhere to capture.</Empty>}

      <div className="grid gap-5 lg:grid-cols-2">
        {taskRows.length > 0 && (
          <Section title={tr('today.due')} action={<Link href="/app/tasks?view=today" className="text-sm font-medium text-[var(--color-blue)]">All tasks</Link>}>
            <TaskList tasks={taskRows} today={d.today} />
          </Section>
        )}
        {schedule.length > 0 && (
          <Section title={tr('today.schedule')} action={<Link href="/app/calendar" className="text-sm font-medium text-[var(--color-blue)]">Calendar</Link>}>
            <ul className="space-y-2">
              {schedule.map((i) => (
                <li key={`${i.type}-${i.id}-${i.date}`} className="flex items-start gap-3">
                  <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold muted">{i.startsAt ? fmtTime(i.startsAt, s.user.timezone) : 'All day'}</span>
                  <div className="min-w-0">
                    <Link href={i.link} className="text-sm font-medium hover:underline">{i.title}</Link>
                    <p className="text-xs muted">{i.nature === 'deadline' ? 'Deadline' : i.nature === 'flexible' ? 'Flexible plan' : 'Appointment'}{i.location ? ` · ${i.location}` : ''}{i.workspaceName !== 'Personal' ? ` · ${i.workspaceName}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.unreviewed.length > 0 && (
          <Section title={tr('today.review')} action={<Link href="/app/inbox" className="text-sm font-medium text-[var(--color-blue)]">Inbox</Link>}>
            <ul className="space-y-2">
              {(d.unreviewed as { id: string; title: string | null; source_type: string; status: string; pending: number }[]).map((c) => (
                <li key={c.id}>
                  <Link href={`/app/inbox/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-2)]">
                    <span className="flex min-w-0 items-center gap-2 text-sm"><InboxIcon size={15} aria-hidden /> <span className="truncate">{c.title ?? humanize(c.source_type)}</span></span>
                    <span className={c.status === 'failed' ? 'chip chip-rose' : c.pending ? 'chip chip-amber' : 'chip'}>{c.status === 'failed' ? 'Could not read' : c.pending ? `${c.pending} to review` : humanize(c.status)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.waiting.length > 0 && (
          <Section title={tr('today.waiting')} action={<Link href="/app/promises" className="text-sm font-medium text-[var(--color-blue)]">Promises</Link>}>
            <ul className="space-y-2 text-sm">
              {(d.waiting as { id: string; description: string; expected_by: string | null; counterparty: string | null; direction: string }[]).map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span><span className="chip mr-1.5">{p.direction === 'i_promised' ? 'You promised' : p.direction === 'they_promised' ? 'Promised to you' : 'Waiting'}</span>{p.description}</span>
                  {p.expected_by && <span className={p.expected_by < d.today ? 'chip chip-rose' : 'chip'}>{p.expected_by}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.assigned.length > 0 && (
          <Section title={tr('today.assigned')}>
            <TaskList tasks={(d.assigned as { id: string; title: string; due_date: string | null; workspace_name: string }[]).map((t) => ({ ...t, status: 'open', priority: 0, due_time: null, workspace_kind: 'family' }))} today={d.today} />
          </Section>
        )}
        {d.proposals.length > 0 && (
          <Section title={tr('today.suggestions')} action={<Sparkles size={16} className="text-[var(--color-violet)]" aria-hidden />}>
            <ul className="space-y-3">
              {(d.proposals as { id: string; title: string; explanation: string }[]).map((p) => (
                <li key={p.id} className="rounded-xl bg-[var(--surface-2)] p-3">
                  <p className="text-sm font-semibold">{p.title}</p>
                  <p className="text-xs muted">{p.explanation}</p>
                  <div className="mt-2 flex gap-2">
                    <ApiButton path={`/proposals/${p.id}/approve`} className="btn btn-sm btn-primary" success="Done — you can undo this from Life AI for 24 hours.">Do it</ApiButton>
                    <ApiButton path={`/proposals/${p.id}/reject`} className="btn btn-sm">Not now</ApiButton>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

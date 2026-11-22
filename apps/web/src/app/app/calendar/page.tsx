import Link from 'next/link';
import { requireSession } from '@/server/session';
import { agenda } from '@lifeos/core/calendar';
import { todayIn } from '@lifeos/core/time';
import { addDays, addMonths, startOfWeek } from '@lifeos/extract';
import { PageHeader, Section, Empty } from '@/components/ui';
import { ApiForm } from '@/components/api';
import { CalendarGrid, type Item } from '@/components/calendar';
import { fmtDate, fmtTime, humanize } from '@/lib/format';
import { EventForm } from '@/components/event-form';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const today = todayIn(s.user.timezone);
  const view = (['month', 'week', 'day', 'agenda'].includes(sp.view ?? '') ? sp.view : 'week') as 'month' | 'week' | 'day' | 'agenda';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today;
  let from: string;
  let to: string;
  if (view === 'month') {
    from = startOfWeek(`${anchor.slice(0, 8)}01`);
    to = addDays(from, 41);
  } else if (view === 'week') {
    from = startOfWeek(anchor);
    to = addDays(from, 6);
  } else if (view === 'day') {
    from = anchor;
    to = anchor;
  } else {
    from = anchor;
    to = addDays(anchor, 30);
  }
  const items = (await agenda(s.ctx, from, to)) as unknown as Item[];
  const days = Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 }, (_, i) => addDays(from, i));
  const step = (n: number) => (view === 'month' ? addMonths(anchor, n) : view === 'week' ? addDays(anchor, 7 * n) : view === 'day' ? addDays(anchor, n) : addDays(anchor, 30 * n));
  const link = (over: Record<string, string>) => `/app/calendar?${new URLSearchParams({ view, date: anchor, ...over })}`;
  return (
    <>
      <PageHeader title="Calendar" description="Appointments, plus every dated commitment you have confirmed — deadlines, bills, renewals, warranty and return dates — in one place."
        actions={<a href="/api/v1/calendar/export.ics" className="btn btn-sm">Export .ics</a>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">{(['day', 'week', 'month', 'agenda'] as const).map((v) => <Link key={v} href={`/app/calendar?view=${v}&date=${anchor}`} aria-current={view === v ? 'page' : undefined} className={`btn btn-sm ${view === v ? 'btn-primary' : ''}`}>{humanize(v)}</Link>)}</div>
        <div className="flex items-center gap-1">
          <Link href={link({ date: step(-1) })} className="btn btn-sm" aria-label="Previous">←</Link>
          <Link href={link({ date: today })} className="btn btn-sm">Today</Link>
          <Link href={link({ date: step(1) })} className="btn btn-sm" aria-label="Next">→</Link>
        </div>
        <p className="text-sm font-semibold">{view === 'month' ? fmtDate(anchor, s.user.locale, { month: 'long', year: 'numeric' }) : `${fmtDate(from, s.user.locale)} – ${fmtDate(to, s.user.locale)}`}</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {view === 'agenda' ? (
            items.length === 0 ? <Empty title="Nothing in the next 30 days" /> : (
              <div className="card divide-y divide-[var(--line)]">
                {days.filter((d) => items.some((i) => i.date === d)).map((d) => (
                  <div key={d} className="flex gap-4 px-4 py-3">
                    <p className={`w-24 shrink-0 text-sm font-semibold ${d === today ? 'text-[var(--color-blue)]' : ''}`}>{fmtDate(d, s.user.locale, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                    <ul className="flex-1 space-y-1.5">{items.filter((i) => i.date === d).map((i) => (
                      <li key={`${i.type}${i.id}`} className="flex items-baseline justify-between gap-2 text-sm"><Link href={i.link} className="hover:underline">{i.startsAt && !i.allDay ? `${fmtTime(i.startsAt, s.user.timezone)} · ` : ''}{i.title}</Link><span className="chip">{i.nature === 'fixed' ? 'appointment' : i.nature}</span></li>
                    ))}</ul>
                  </div>
                ))}
              </div>
            )
          ) : (
            <CalendarGrid view={view} days={days} items={items} today={today} tz={s.user.timezone} />
          )}
          <p className="mt-2 text-xs muted">Drag an appointment to another day or hour to reschedule it. Deadlines from bills, renewals and warranties move only when you change the record itself. Dashed = flexible plan.</p>
        </div>
        <div className="space-y-5">
          <Section title="New appointment or plan"><EventForm date={anchor} /></Section>
          <Section title="Import calendar (.ics)">
            <ApiForm path="/calendar/import" multipart success="Imported." className="space-y-2" onDone={undefined}>
              <input type="file" name="file" accept=".ics,text/calendar" required className="text-sm" aria-label="Calendar file" />
              <button className="btn btn-sm">Import</button>
              <p className="text-xs muted">Events are copied in. Your Google or Outlook calendar is never changed. Re-importing the same file updates the copies instead of duplicating them.</p>
            </ApiForm>
          </Section>
        </div>
      </div>
    </>
  );
}

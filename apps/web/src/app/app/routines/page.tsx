import { requireSession } from '@/server/session';
import { routinesOverview } from '@lifeos/core/planning';
import { todayIn } from '@lifeos/core/time';
import { addDays, describeRecurrence, startOfWeek } from '@lifeos/extract';
import { PageHeader, Empty, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';

export const metadata = { title: 'Routines' };

export default async function RoutinesPage() {
  const s = await requireSession();
  const today = todayIn(s.user.timezone);
  const from = startOfWeek(today);
  const to = addDays(from, 6);
  const rows = await routinesOverview(s.ctx, from, to);
  return (
    <>
      <PageHeader title="Routines" description="Things you do regularly. Skipping is a normal choice, not a failure — there are no streaks or scores here." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {rows.length === 0 && <Empty title="No routines yet">Add one — a weekly review, watering plants, a study block.</Empty>}
          {rows.map((r) => (
            <article key={r.id} id={r.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold">{r.title}</p><p className="text-xs muted">{describeRecurrence(r.recurrence)}{r.time_of_day ? ` at ${r.time_of_day}` : ''}{r.reminder_enabled ? ' · reminders on' : ''}{r.paused_at ? ' · paused' : ''}</p></div>
                <div className="flex gap-1.5">
                  <ApiButton path={`/routines/${r.id}/state`} body={{ state: r.paused_at ? 'resume' : 'pause' }}>{r.paused_at ? 'Resume' : 'Pause'}</ApiButton>
                  <ApiButton path={`/routines/${r.id}/state`} body={{ state: 'archive' }} confirm="Archive this routine?">Archive</ApiButton>
                </div>
              </div>
              {r.occurrences.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="This week">
                  {r.occurrences.map((o) => (
                    <li key={o.date} className={`rounded-lg border px-2 py-1.5 text-center text-xs ${o.date === today ? 'border-[var(--color-blue)]' : 'border-[var(--line)]'}`}>
                      <p className="font-semibold">{new Date(`${o.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</p>
                      {o.status ? <p className={o.status === 'done' ? 'text-emerald-700' : 'muted'}>{o.status === 'done' ? 'Done' : 'Skipped'}</p> : o.date <= today ? (
                        <span className="mt-1 flex gap-1"><ApiButton path={`/routines/${r.id}/record`} body={{ on: o.date, status: 'done' }} className="btn btn-sm !px-1.5">Done</ApiButton><ApiButton path={`/routines/${r.id}/record`} body={{ on: o.date, status: 'skipped' }} className="btn btn-sm !px-1.5">Skip</ApiButton></span>
                      ) : <p className="muted">—</p>}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
        <Section title="New routine">
          <ApiForm path="/routines" className="space-y-3" transform={(b) => ({ title: b.title, timeOfDay: b.timeOfDay, reminderEnabled: Boolean(b.reminderEnabled), recurrence: b.freq === 'weekdays' ? { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] } : b.freq === 'weekly' ? { freq: 'weekly', interval: 1, byWeekday: (b.days as string[] | undefined ?? []).map(Number) } : { freq: b.freq, interval: 1 } })}>
            <div><label className="label" htmlFor="rt">What</label><input id="rt" name="title" required className="field" /></div>
            <div><label className="label" htmlFor="rf">How often</label><select id="rf" name="freq" className="field"><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Certain days</option><option value="monthly">Monthly</option></select></div>
            <fieldset><legend className="label">Days (for “certain days”)</legend><div className="flex flex-wrap gap-2 text-xs">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="days" value={String(i)} />{d}</label>)}</div></fieldset>
            <div><label className="label" htmlFor="rtm">Time (optional)</label><input id="rtm" name="timeOfDay" type="time" className="field" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reminderEnabled" data-kind="bool" /> Remind me</label>
            <button className="btn btn-primary w-full">Create</button>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

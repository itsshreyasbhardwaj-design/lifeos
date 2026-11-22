import Link from 'next/link';
import { requireSession } from '@/server/session';
import { listLifeEvents, EVENT_TEMPLATES } from '@lifeos/core/planning';
import { PageHeader, Empty, Section } from '@/components/ui';
import { ApiForm } from '@/components/api';
import { humanize } from '@/lib/format';

export const metadata = { title: 'Life Events' };

export default async function EventsPage() {
  const s = await requireSession();
  const items = (await listLifeEvents(s.ctx)) as Record<string, unknown>[];
  return (
    <>
      <PageHeader title="Life Events" description="Trips, moves, new school years and celebrations — dates, checklists, documents and who is doing what, in one place." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          {items.length === 0 && <div className="sm:col-span-2"><Empty title="No life events yet">Start one from a template.</Empty></div>}
          {items.map((e) => (
            <Link key={String(e.id)} href={`/app/events/${e.id}`} className="card block p-4 hover:border-[var(--color-blue)]">
              <p className="font-semibold">{String(e.title)}</p>
              <p className="mt-1 text-xs muted">{e.starts_on ? `${e.starts_on}${e.ends_on && e.ends_on !== e.starts_on ? ` → ${e.ends_on}` : ''}` : 'No date yet'}{e.location ? ` · ${e.location}` : ''}</p>
              <p className="mt-2 text-xs"><span className="chip">{humanize(String(e.status))}</span> <span className="muted">{Number(e.done_items)}/{Number(e.items)} done</span></p>
            </Link>
          ))}
        </div>
        <Section title="Plan something">
          <ApiForm path="/events" redirectTo={(d) => `/app/events/${(d as { id: string }).id}`} className="space-y-3">
            <div><label className="label" htmlFor="et">Template</label><select id="et" name="templateKey" className="field">{EVENT_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></div>
            <div><label className="label" htmlFor="en">Title</label><input id="en" name="title" required className="field" placeholder="Goa trip, Moving to Pune…" /></div>
            <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="es">From</label><input id="es" name="startsOn" type="date" className="field" /></div><div><label className="label" htmlFor="ee">To</label><input id="ee" name="endsOn" type="date" className="field" /></div></div>
            <div><label className="label" htmlFor="el">Where</label><input id="el" name="location" className="field" /></div>
            <button className="btn btn-primary w-full">Create</button>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

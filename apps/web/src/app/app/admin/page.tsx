import Link from 'next/link';
import { requireSession } from '@/server/session';
import { listWorkflows, ADMIN_TEMPLATES } from '@lifeos/core/planning';
import { hasFeature } from '@lifeos/core/billing';
import { PageHeader, Empty, Section, PlanGate } from '@/components/ui';
import { ApiForm } from '@/components/api';
import { humanize } from '@/lib/format';

export const metadata = { title: 'LifeAdmin' };

export default async function AdminPage() {
  const s = await requireSession();
  const [items, allowed] = await Promise.all([listWorkflows(s.ctx) as Promise<Record<string, unknown>[]>, hasFeature(s.ctx.db, s.user.id, 'lifeadmin')]);
  if (!allowed && items.length === 0) return (<><PageHeader title="LifeAdmin" /><PlanGate feature="LifeAdmin" /></>);
  return (
    <>
      <PageHeader title="LifeAdmin" description="Multi-step paperwork: what to gather, what to do, where you are. Marking something “submitted” records what you did — it is not confirmation from any office." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {items.length === 0 ? <Empty title="No workflows yet">Start one from a template.</Empty> : (
            <ul className="space-y-3">
              {items.map((w) => (
                <li key={String(w.id)}>
                  <Link href={`/app/admin/${w.id}`} className="card block p-4 hover:border-[var(--color-blue)]">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{String(w.title)}</p><span className="chip chip-blue">{humanize(String(w.status))}</span></div>
                    <p className="mt-1 text-xs muted">{Number(w.done_items)}/{Number(w.items)} steps done{w.deadline ? ` · deadline ${w.deadline}` : ''}{w.reference_number ? ` · ref ${w.reference_number}` : ''}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className="h-full bg-[var(--color-emerald)]" style={{ width: `${Number(w.items) ? (Number(w.done_items) / Number(w.items)) * 100 : 0}%` }} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {allowed && (
          <Section title="Start a workflow">
            <ApiForm path="/admin" redirectTo={(d) => `/app/admin/${(d as { id: string }).id}`} className="space-y-3">
              <div><label className="label" htmlFor="at">Template</label><select id="at" name="templateKey" className="field">{ADMIN_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></div>
              <div><label className="label" htmlFor="an">Title</label><input id="an" name="title" required className="field" placeholder="e.g. Apply to IISc summer programme" /></div>
              <div><label className="label" htmlFor="ad">Deadline</label><input id="ad" name="deadline" type="date" className="field" /></div>
              <div><label className="label" htmlFor="au">Official website</label><input id="au" name="officialUrl" type="url" className="field" placeholder="https://…" /></div>
              <button className="btn btn-primary w-full">Create</button>
              <p className="text-xs muted">Templates are generic starting checklists. Always check the official source for the real requirements.</p>
            </ApiForm>
          </Section>
        )}
      </div>
    </>
  );
}

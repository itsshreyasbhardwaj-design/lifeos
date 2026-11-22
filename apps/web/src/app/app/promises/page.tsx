import Link from 'next/link';
import { requireSession } from '@/server/session';
import { listPromises } from '@lifeos/core/promises';
import { PageHeader, Empty, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { humanize } from '@/lib/format';

export const metadata = { title: 'Promises' };

const TABS = [['', 'All open'], ['i_promised', 'I promised'], ['they_promised', 'Promised to me'], ['waiting_on', 'Waiting on'], ['resolved', 'Resolved']] as const;

export default async function PromisesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession();
  const tab = (await searchParams).tab ?? '';
  const all = await listPromises(s.ctx);
  const items = all.filter((p) => (tab === 'resolved' ? p.status !== 'open' : p.status === 'open' && (!tab || p.direction === tab)));
  return (
    <>
      <PageHeader title="Promise Tracker" description="What you promised, what others promised you, and what you are waiting on. LifeOS never marks something done on anyone’s behalf." />
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter">{TABS.map(([id, l]) => <Link key={id} href={`/app/promises${id ? `?tab=${id}` : ''}`} aria-current={tab === id ? 'page' : undefined} className={`btn btn-sm ${tab === id ? 'btn-primary' : ''}`}>{l}</Link>)}</nav>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {items.length === 0 && <Empty title="Nothing here">Record a promise, or capture a message like “we will refund within 7 days”.</Empty>}
          {items.map((p) => (
            <article key={p.id} id={p.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm"><span className="chip mr-2">{p.direction === 'i_promised' ? 'You promised' : p.direction === 'they_promised' ? 'Promised to you' : 'Waiting on'}</span><span className="font-semibold">{p.description}</span></p>
                  <p className="mt-1 text-xs muted">{p.counterparty ? `${p.counterparty} · ` : ''}recorded {p.recorded_on}{p.expected_by ? ` · expected by ${p.expected_by}` : ''}{p.next_follow_up ? ` · follow-up ${new Date(p.next_follow_up).toLocaleDateString('en-IN')}` : ''}</p>
                  {p.resolution_note && <p className="mt-1 text-xs">“{p.resolution_note}”</p>}
                </div>
                {p.overdue && <span className="chip chip-rose">Overdue</span>}
                {p.status !== 'open' && <span className="chip">{humanize(p.status)}</span>}
              </div>
              {p.status === 'open' ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <ApiButton path={`/promises/${p.id}/resolve`} body={{ outcome: 'fulfilled' }} className="btn btn-sm btn-primary">Done</ApiButton>
                  <ApiButton path={`/promises/${p.id}/resolve`} body={{ outcome: 'not_fulfilled' }}>Didn’t happen</ApiButton>
                  <ApiButton path={`/promises/${p.id}/resolve`} body={{ outcome: 'cancelled' }}>No longer needed</ApiButton>
                  <ApiForm path={`/promises/${p.id}/follow-up`} className="flex gap-1.5" success="Follow-up reminder set."><input type="date" name="on" required className="field !py-1 text-sm" aria-label="Follow up on" /><button className="btn btn-sm">Follow up</button></ApiForm>
                </div>
              ) : <div className="mt-3"><ApiButton path={`/promises/${p.id}/reopen`}>Reopen</ApiButton></div>}
            </article>
          ))}
        </div>
        <Section title="Record a promise">
          <ApiForm path="/promises" className="space-y-3">
            <div><label className="label" htmlFor="pd">Who promised</label><select id="pd" name="direction" className="field"><option value="i_promised">I promised</option><option value="they_promised">Someone promised me</option><option value="waiting_on">I’m waiting on something</option></select></div>
            <div><label className="label" htmlFor="pw">What</label><textarea id="pw" name="description" required className="field min-h-16" /></div>
            <div><label className="label" htmlFor="pc">With</label><input id="pc" name="counterparty" className="field" placeholder="Person or organisation" /></div>
            <div><label className="label" htmlFor="pe">Expected by</label><input id="pe" name="expectedBy" type="date" className="field" /></div>
            <button className="btn btn-primary w-full">Save</button>
            <p className="text-xs muted">You’ll get a follow-up reminder on the expected date.</p>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

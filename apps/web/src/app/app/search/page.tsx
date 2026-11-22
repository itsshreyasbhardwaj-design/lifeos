import Link from 'next/link';
import { requireSession } from '@/server/session';
import { search, savedSearches } from '@lifeos/core/search';
import { PageHeader, Empty } from '@/components/ui';
import { AskBox } from '@/components/ask';
import { humanize } from '@/lib/format';
import { ApiForm } from '@/components/api';

export const metadata = { title: 'Search' };

const TYPES = ['task', 'document', 'purchase', 'capture', 'calendar_event', 'subscription', 'bill', 'promise', 'admin_workflow', 'life_event'];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; from?: string; to?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const [hits, saved] = await Promise.all([q ? search(s.ctx, q, { types: sp.type ? [sp.type] : undefined, from: sp.from || undefined, to: sp.to || undefined }) : Promise.resolve([]), savedSearches(s.ctx)]);
  return (
    <>
      <PageHeader title="Search" description="Searches everything you can see — your own records and what family members explicitly shared with you. Nothing else." />
      <AskBox examples={['What do I need to do tomorrow?', 'Where is my laptop invoice?', 'Which subscriptions renew next month?', 'What am I waiting for?', 'Which warranties expire soon?', 'Show unfinished household tasks']} />
      <form action="/app/search" className="card mt-5 grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">Keywords</label>
        <input id="q" name="q" defaultValue={q} className="field" placeholder="Keywords — e.g. invoice croma, passport, rent" />
        <select name="type" defaultValue={sp.type ?? ''} className="field" aria-label="Type"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} className="field" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to} className="field" aria-label="To date" />
        <button className="btn btn-primary">Search</button>
      </form>
      {saved.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{(saved as { id: string; name: string; query: string }[]).map((x) => <Link key={x.id} className="chip" href={`/app/search?q=${encodeURIComponent(x.query)}`}>★ {x.name}</Link>)}</div>}
      {q && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm muted">{hits.length} result{hits.length === 1 ? '' : 's'} for “{q}”</p>
            <ApiForm path="/saved-searches" transform={() => ({ name: q, query: q })}><button className="btn btn-sm">Save search</button></ApiForm>
          </div>
          {hits.length === 0 ? <Empty title="No matches">Try fewer or different words. Search matches word beginnings, so “inv” finds “invoice”.</Empty> : (
            <ul className="card divide-y divide-[var(--line)]">
              {hits.map((h) => (
                <li key={`${h.type}${h.id}`}>
                  <Link href={h.link} className="block px-4 py-3 hover:bg-[var(--surface-2)]">
                    <p className="flex items-center gap-2 text-sm font-semibold"><span className="chip">{humanize(h.type)}</span>{h.title}</p>
                    {h.snippet && <p className="mt-1 text-xs muted">{h.snippet.replace(/«|»/g, '')}</p>}
                    <p className="mt-0.5 text-[11px] muted">{h.occursOn ? `${h.occursOn} · ` : ''}{h.workspaceName}{h.status ? ` · ${humanize(h.status)}` : ''}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

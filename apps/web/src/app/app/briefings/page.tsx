import Link from 'next/link';
import { requireSession } from '@/server/session';
import { brief } from '@lifeos/core/intelligence';
import { PageHeader, Section } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'Briefings' };

export default async function BriefingsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const s = await requireSession();
  const p = (await searchParams).period;
  const period = p === 'weekly' || p === 'monthly' ? p : 'daily';
  const b = await brief(s.ctx, period);
  return (
    <>
      <PageHeader title="Briefings" description="A calm summary of what is coming up. No scores, no streaks — just what needs attention." />
      <nav className="mb-4 flex gap-1.5">{(['daily', 'weekly', 'monthly'] as const).map((x) => <Link key={x} href={`/app/briefings?period=${x}`} aria-current={period === x ? 'page' : undefined} className={`btn btn-sm ${period === x ? 'btn-primary' : ''}`}>{x === 'daily' ? 'Daily brief' : x === 'weekly' ? 'Weekly brief' : 'Monthly review'}</Link>)}</nav>
      <p className="mb-4 text-sm muted">{fmtDate(b.from, s.user.locale)} – {fmtDate(b.to, s.user.locale)}</p>
      <div className="grid gap-5 md:grid-cols-2">
        {b.sections.map((sec) => (
          <Section key={sec.heading} title={sec.heading}>
            {sec.items.length === 0 ? <p className="text-sm muted">{sec.empty}</p> : <ul className="space-y-1.5 text-sm">{sec.items.map((i) => <li key={`${i.type}${i.id}${i.date}`} className="flex justify-between gap-2"><Link href={i.link} className="hover:underline">{i.title}</Link>{i.date && <span className="shrink-0 text-xs muted">{fmtDate(i.date, s.user.locale, { day: 'numeric', month: 'short' })}</span>}</li>)}</ul>}
          </Section>
        ))}
      </div>
    </>
  );
}

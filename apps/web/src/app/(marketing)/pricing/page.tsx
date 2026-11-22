import Link from 'next/link';
import { plans } from '@lifeos/core/billing';

export const metadata = { title: 'Pricing', description: 'Free forever for tasks, reminders, calendar, capture and search. Plus ₹149/month. Family ₹299/month.', alternates: { canonical: '/pricing' } };

export default function Pricing() {
  const p = plans();
  const rows: [string, boolean, boolean, boolean][] = [
    ['Tasks, reminders, calendar, capture, search, export', true, true, true],
    ['Promise Tracker, subscriptions & bills, routines, life events', true, true, true],
    ['Purchase Protection (warranties, returns, refunds)', false, true, true],
    ['LifeAdmin workflows', false, true, true],
    ['LifeGraph explorer', false, true, true],
    ['FollowThrough suggestions & automations', false, true, true],
    ['Family spaces, shared calendar & shopping', false, false, true],
  ];
  return (
    <main className="mx-auto max-w-5xl px-4 pt-16">
      <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Simple pricing</h1>
      <p className="mt-4 max-w-2xl text-lg muted">Get real value before you pay. Basic reminders and tasks are never behind a paywall.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {(['free', 'plus', 'family'] as const).map((id) => (
          <div key={id} className={`card p-6 ${id === 'plus' ? 'border-[var(--color-blue)]' : ''}`}>
            <h2 className="text-lg font-bold">{p[id].name}</h2>
            <p className="mt-2 text-3xl font-bold">₹{p[id].priceMonthlyInr}<span className="text-sm font-normal muted">/month</span></p>
            <p className="text-xs muted">{p[id].priceYearlyInr ? `or ₹${p[id].priceYearlyInr}/year` : 'free forever'}</p>
            <ul className="mt-4 space-y-1.5 text-sm"><li>{p[id].limits.extractions} files read automatically / month</li><li>{p[id].limits.storage_bytes >= 1024 ** 3 ? `${p[id].limits.storage_bytes / 1024 ** 3} GB` : `${p[id].limits.storage_bytes / 1024 ** 2} MB`} document storage</li>{id === 'family' && <li>Up to {p[id].limits.family_members} people per family space</li>}</ul>
            <Link href="/signup" className={`btn mt-6 w-full ${id === 'plus' ? 'btn-primary' : ''}`}>{id === 'free' ? 'Start free' : 'Try free for 14 days'}</Link>
          </div>
        ))}
      </div>
      <table className="card mt-8 w-full overflow-hidden text-sm">
        <thead><tr className="border-b border-[var(--line)] text-left"><th className="p-3">Feature</th><th className="p-3">Free</th><th className="p-3">Plus</th><th className="p-3">Family</th></tr></thead>
        <tbody>{rows.map(([f, a, b, c]) => <tr key={f} className="border-b border-[var(--line)] last:border-0"><td className="p-3">{f}</td>{[a, b, c].map((v, i) => <td key={i} className="p-3">{v ? '✓' : '—'}</td>)}</tr>)}</tbody>
      </table>
      <p className="mt-4 text-xs muted">Prices in Indian rupees. Trials need no card and end on their own. If you cancel, your records stay; premium sections become read-only. Annual plans renew yearly; you will be told the renewal date in advance.</p>
    </main>
  );
}

import Link from 'next/link';
import { FEATURE_PAGES } from '@/content/marketing';

export const metadata = { title: 'Features', description: 'Capture, LifeGraph, FollowThrough, LifeAdmin, Purchase Protection, FamilyOS, Promise Tracker, calendar, reminders, vault and search.', alternates: { canonical: '/features' } };

const MORE = [
  ['TaskOS', 'Quick add in plain words (“pay rent on the 5th of every month”), smart views, subtasks, checklists, dependencies, repeats without duplicates, bulk actions.'],
  ['Reminder Intelligence', 'Reminders stored durably, delivered once, snoozable, respectful of quiet hours, correct across timezone and daylight-saving changes.'],
  ['Life Calendar', 'Day, week, month and agenda views with every dated commitment overlaid; drag to reschedule; conflict warnings; .ics import and export.'],
  ['Life Vault', 'Encrypted private documents with versions, expiry reminders, full-text search, and per-document sharing that expires and can be revoked.'],
  ['SubscriptionOS & Bills', 'Renewal and trial reminders, monthly totals per currency, cancellation checklists, “paid” recorded as you report it.'],
  ['Promise Tracker', 'I promised / they promised / waiting on — with follow-up dates and an honest resolution.'],
  ['Life Events & Routines', 'Trips, moves and celebrations as checklists with people and documents; routines without streaks or guilt.'],
  ['Life AI & Briefings', 'Ask about your own records and get answers with sources; daily, weekly and monthly briefs; approval-gated automations.'],
];

export default function Features() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-16">
      <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Everything connects</h1>
      <p className="mt-4 max-w-2xl text-lg muted">LifeOS isn’t a pile of separate apps. A capture becomes a task, the task links to the receipt, the receipt holds the warranty, the warranty reminds you — and search finds all of it.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{FEATURE_PAGES.map((f) => <Link key={f.slug} href={`/${f.slug}`} className="card p-5 hover:border-[var(--color-blue)]"><p className="chip chip-blue">{f.kicker}</p><h2 className="mt-3 font-semibold">{f.nav}</h2><p className="mt-1 text-sm muted">{f.description}</p></Link>)}</div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">{MORE.map(([t, b]) => <div key={t} className="card p-5"><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm muted">{b}</p></div>)}</div>
    </main>
  );
}

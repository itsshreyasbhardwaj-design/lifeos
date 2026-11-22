import { requireSession } from '@/server/session';
import { listProposals, listRules } from '@lifeos/core/intelligence';
import { hasFeature } from '@lifeos/core/billing';
import { PageHeader, Section, Empty } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { AskBox } from '@/components/ask';
import { fmtDateTime, humanize } from '@/lib/format';

export const metadata = { title: 'Life AI' };

type P = { id: string; title: string; explanation: string; kind: string; status: string; origin: string; created_at: Date; undo_until: Date | null; evidence: { title: string; link: string }[] };

export default async function AiPage() {
  const s = await requireSession();
  const [proposals, rules, auto] = await Promise.all([listProposals(s.ctx, 'all') as Promise<P[]>, listRules(s.ctx) as Promise<{ id: string; name: string; trigger: string; action: string; enabled: boolean; run_count: number; max_runs: number | null; conditions: { daysBefore?: number } }[]>, hasFeature(s.ctx.db, s.user.id, 'automations')]);
  return (
    <>
      <PageHeader title="Life AI" description="Answers built only from your own records, with sources. Suggestions never run until you approve them, and nothing ever leaves LifeOS — no emails sent, no forms submitted, no payments." />
      <AskBox examples={['What do I need to do this week?', 'What did I promise?', 'Which bills are due?', 'Which purchases have open refunds?', 'Which documents expire soon?']} />
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Suggestions" action={<ApiButton path="/proposals/suggest" className="btn btn-sm" success="Checked for new suggestions.">Check now</ApiButton>}>
          {proposals.length === 0 ? <Empty title="No suggestions">LifeOS suggests follow-ups when something you were promised is overdue, a return window is about to close, or you’ve waited a week.</Empty> : (
            <ul className="space-y-3">{proposals.slice(0, 20).map((p) => (
              <li key={p.id} className="rounded-xl border border-[var(--line)] p-3">
                <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">{p.title}</p><span className="chip">{humanize(p.status)}</span></div>
                <p className="text-xs muted">{p.explanation}</p>
                {p.evidence?.length > 0 && <p className="mt-1 text-xs">Based on: {p.evidence.map((e) => <a key={e.link} href={e.link} className="text-[var(--color-blue)] underline">{e.title}</a>)}</p>}
                <div className="mt-2 flex gap-2">
                  {p.status === 'pending' && <><ApiButton path={`/proposals/${p.id}/approve`} className="btn btn-sm btn-primary">Approve</ApiButton><ApiButton path={`/proposals/${p.id}/reject`}>Dismiss</ApiButton></>}
                  {p.status === 'executed' && p.undo_until && new Date(p.undo_until) > new Date() && <ApiButton path={`/proposals/${p.id}/undo`}>Undo</ApiButton>}
                </div>
                <p className="mt-1 text-[11px] muted">{p.origin === 'automation' ? 'From one of your automations' : 'FollowThrough'} · {fmtDateTime(p.created_at, s.user.timezone)}</p>
              </li>
            ))}</ul>
          )}
        </Section>
        <Section title="Automations">
          {!auto ? <p className="text-sm muted">Automations are part of LifeOS Plus.</p> : (
            <>
              <ul className="mb-4 space-y-2 text-sm">{rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2"><span><span className="font-medium">{r.name}</span><span className="block text-xs muted">When {humanize(r.trigger).toLowerCase()} ({r.conditions.daysBefore ?? 7} days) → {humanize(r.action).toLowerCase()} · ran {r.run_count}{r.max_runs ? `/${r.max_runs}` : ''} times</span></span>
                  <ApiButton path={`/automations/${r.id}`} method="PATCH" body={{ enabled: !r.enabled }}>{r.enabled ? 'Turn off' : 'Turn on'}</ApiButton></li>
              ))}</ul>
              <ApiForm path="/automations" className="space-y-2" transform={(b) => ({ name: b.name, trigger: b.trigger, action: b.action, conditions: { daysBefore: Number(b.daysBefore ?? 7) }, maxRuns: b.maxRuns ?? null })}>
                <p className="text-sm font-semibold">New automation</p>
                <input name="name" required className="field" placeholder="Name" aria-label="Name" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <select name="trigger" className="field" aria-label="When"><option value="warranty_expiring">A warranty is ending</option><option value="return_window_closing">A return window is closing</option><option value="subscription_renewing">A subscription renews</option><option value="trial_ending">A free trial ends</option><option value="document_expiring">A document expires</option><option value="bill_due">A bill is due</option><option value="promise_overdue">A promise is overdue</option></select>
                  <input name="daysBefore" type="number" min={0} max={365} defaultValue={7} className="field" aria-label="Days before / after" />
                  <select name="action" className="field" aria-label="Then"><option value="propose_task">Suggest a task</option><option value="propose_reminder">Suggest a reminder</option><option value="propose_checklist">Suggest a checklist</option></select>
                  <input name="maxRuns" type="number" min={1} data-kind="int" className="field" placeholder="Stop after N runs (optional)" aria-label="Maximum runs" />
                </div>
                <button className="btn btn-primary btn-sm">Create</button>
                <p className="text-xs muted">Every match becomes a suggestion you approve. Turn an automation off at any time.</p>
              </ApiForm>
            </>
          )}
        </Section>
      </div>
    </>
  );
}

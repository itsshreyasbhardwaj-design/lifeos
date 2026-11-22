import { requireSession } from '@/server/session';
import { billingState, plans, usage, type Feature } from '@lifeos/core/billing';
import { PageHeader, Section, Stat } from '@/components/ui';
import { ApiButton } from '@/components/api';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Subscription' };

const FEATURES: [Feature, string][] = [['purchase_protection', 'Purchase Protection'], ['lifeadmin', 'LifeAdmin workflows'], ['lifegraph', 'LifeGraph explorer'], ['followthrough_ai', 'FollowThrough suggestions'], ['automations', 'Automations'], ['family', 'Family spaces']];

export default async function BillingPage() {
  const s = await requireSession();
  const [state, u] = await Promise.all([billingState(s.ctx.db, s.user.id), usage(s.ctx.db, s.user.id)]);
  const all = plans();
  const dev = process.env.NODE_ENV !== 'production' || process.env.LIFEOS_ENABLE_DEV_BILLING === '1';
  const fmt = (m: string, v: number) => (m === 'storage_bytes' ? `${(v / 1024 / 1024).toFixed(v < 1024 * 1024 * 10 ? 1 : 0)} MB` : String(v));
  return (
    <>
      <PageHeader title="Your plan" description="Tasks, reminders, calendar, capture, search and export are free, always. Prices are in INR and include no hidden charges; online payment is not switched on in this build." />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Plan" value={all[state.plan].name} hint={state.status === 'trialing' && state.trialEndsAt ? `Trial ends ${fmtDateTime(state.trialEndsAt, s.user.timezone)}` : state.cancelAtPeriodEnd ? 'Ends at period end' : undefined} />
        {u.map((x) => <Stat key={x.metric} label={x.metric === 'extractions' ? 'Files read this month' : x.metric === 'storage_bytes' ? 'Storage' : 'Questions this month'} value={`${fmt(x.metric, x.used)} / ${fmt(x.metric, x.limit)}`} />)}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(['free', 'plus', 'family'] as const).map((id) => {
          const p = all[id];
          const current = state.plan === id;
          return (
            <Section key={id} title={p.name} className={current ? 'border-[var(--color-blue)]' : ''}>
              <p className="text-2xl font-bold">₹{p.priceMonthlyInr}<span className="text-sm font-normal muted">/month</span></p>
              {p.priceYearlyInr > 0 && <p className="text-xs muted">or ₹{p.priceYearlyInr}/year</p>}
              <ul className="my-3 space-y-1 text-sm">
                <li>✓ Tasks, reminders, calendar, capture, search, export</li>
                {FEATURES.map(([f, l]) => <li key={f} className={p.features.includes(f) ? '' : 'muted line-through'}>{p.features.includes(f) ? '✓' : '–'} {l}</li>)}
                <li>✓ {p.limits.extractions} files read per month · {(p.limits.storage_bytes / 1024 ** 3).toFixed(p.limits.storage_bytes < 1024 ** 3 ? 1 : 0)} GB</li>
              </ul>
              {current ? <span className="chip chip-blue">Current plan</span> : id !== 'free' && !state.trialUsed && state.plan === 'free' ? <ApiButton path="/billing/trial" body={{ plan: id }} className="btn btn-primary btn-sm" success="Your 14-day trial has started.">Start 14-day free trial</ApiButton> : id !== 'free' ? <span className="text-xs muted">Paid checkout is not enabled on this server.</span> : null}
              {dev && !current && <div className="mt-2"><ApiButton path="/billing/dev-plan" body={{ plan: id }} className="btn btn-ghost btn-sm">Developer: switch to {p.name}</ApiButton></div>}
            </Section>
          );
        })}
      </div>
      {state.plan !== 'free' && <div className="mt-5"><ApiButton path="/billing/cancel" className="btn btn-sm btn-danger" confirm="Cancel? Your records stay; premium features become read-only.">{state.status === 'trialing' ? 'End trial now' : 'Cancel plan'}</ApiButton></div>}
      <p className="mt-6 text-xs muted">Downgrading never deletes your records. Premium sections stay readable; creating new premium records needs an active plan.</p>
    </>
  );
}

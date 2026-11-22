import { requireSession } from '@/server/session';
import { listSubscriptions } from '@lifeos/core/commitments';
import { checklist } from '@lifeos/core/tasks';
import { PageHeader, Empty, Section, Stat } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { Checklist } from '@/components/checklist';
import { fmtMoney, humanize } from '@/lib/format';

export const metadata = { title: 'Subscriptions' };

export default async function SubscriptionsPage() {
  const s = await requireSession();
  const { subscriptions, totals } = await listSubscriptions(s.ctx);
  const pending = subscriptions.filter((x) => x.status === 'cancellation_pending');
  const lists = await Promise.all(pending.map((x) => checklist(s.ctx.db, s.user.id, 'subscription', x.id)));
  return (
    <>
      <PageHeader title="Subscriptions" description="Renewals and free trials, with a reminder before you are charged. LifeOS cannot cancel anything for you — it keeps your checklist and your proof." />
      {totals.length > 0 && <div className="mb-5 grid gap-3 sm:grid-cols-3">{totals.map((t) => <Stat key={t.currency} label={`Committed (${t.currency})`} value={`${fmtMoney(t.monthly, t.currency)}/mo`} hint={`${fmtMoney(t.yearly, t.currency)} a year · ${t.count} active${t.unknownAmount ? ` · ${t.unknownAmount} with no price recorded` : ''}`} />)}</div>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {subscriptions.length === 0 && <Empty title="No subscriptions yet">Capture a renewal email or add one here.</Empty>}
          {subscriptions.map((x, i) => (
            <article id={x.id} key={x.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{x.name} <span className={x.status === 'cancelled' ? 'chip' : x.status === 'trial' ? 'chip chip-violet' : x.status === 'cancellation_pending' ? 'chip chip-amber' : 'chip chip-green'}>{humanize(x.status)}</span></p>
                  <p className="text-sm muted">{fmtMoney(x.amount_minor, x.currency)} · {x.cycle}{x.next_renewal_date && x.status !== 'cancelled' ? ` · renews ${x.next_renewal_date}` : ''}{x.trial_ends_on ? ` · trial ends ${x.trial_ends_on}` : ''}{x.cancelled_on ? ` · cancelled ${x.cancelled_on} (you reported)` : ''}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['active', 'trial'].includes(x.status) && <ApiButton path={`/subscriptions/${x.id}/cancel-request`}>Plan to cancel</ApiButton>}
                </div>
              </div>
              {x.renewal_unconfirmed && (
                <div className="warn mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span>The renewal date ({x.next_renewal_date}) has passed. Did it renew?</span>
                  <span className="flex gap-2">
                    <ApiButton path={`/subscriptions/${x.id}/renewed`} className="btn btn-sm btn-primary">Yes, it renewed</ApiButton>
                    <ApiButton path={`/subscriptions/${x.id}/cancel-request`}>No — I’m cancelling</ApiButton>
                  </span>
                </div>
              )}
              {x.status === 'cancellation_pending' && (
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div><p className="mb-2 text-sm font-semibold">Cancellation checklist</p><Checklist ownerType="subscription" ownerId={x.id} items={lists[pending.indexOf(x)] ?? []} /></div>
                  <ApiForm path={`/subscriptions/${x.id}/cancelled`} className="space-y-2">
                    <p className="text-sm font-semibold">Record the cancellation</p>
                    <div><label className="label" htmlFor={`co-${x.id}`}>Cancelled on</label><input id={`co-${x.id}`} name="cancelledOn" type="date" required className="field" /></div>
                    <div><label className="label" htmlFor={`cn-${x.id}`}>Confirmation details</label><input id={`cn-${x.id}`} name="notes" className="field" placeholder="Confirmation email / reference" /></div>
                    <button className="btn btn-primary btn-sm">It’s cancelled</button>
                    <p className="text-xs muted">Future renewal reminders stop once you confirm.</p>
                  </ApiForm>
                </div>
              )}
              {void i}
            </article>
          ))}
        </div>
        <Section title="Add a subscription">
          <ApiForm path="/subscriptions" className="space-y-3">
            <div><label className="label" htmlFor="sn">Service</label><input id="sn" name="name" required className="field" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="sa">Price (₹)</label><input id="sa" name="amountMinor" data-kind="money" inputMode="decimal" className="field" /></div>
              <div><label className="label" htmlFor="sc">Renews</label><select id="sc" name="cycle" className="field"><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="quarterly">Quarterly</option><option value="weekly">Weekly</option></select></div>
            </div>
            <div><label className="label" htmlFor="sr">Next renewal</label><input id="sr" name="nextRenewalDate" type="date" className="field" /></div>
            <div><label className="label" htmlFor="st">Free trial ends (optional)</label><input id="st" name="trialEndsOn" type="date" className="field" /></div>
            <div><label className="label" htmlFor="sl">Account / card label (optional)</label><input id="sl" name="accountLabel" className="field" placeholder="e.g. family email, HDFC card" /></div>
            <button className="btn btn-primary w-full">Save</button>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

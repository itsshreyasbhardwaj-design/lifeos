import { requireSession } from '@/server/session';
import { listBills } from '@lifeos/core/commitments';
import { todayIn } from '@lifeos/core/time';
import { PageHeader, Empty, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { fmtMoney, humanize } from '@/lib/format';

export const metadata = { title: 'Bills' };

type Row = { bill_id: string; name: string; category: string; cycle: string; currency: string; occurrence_id: string; due_date: string; amount_minor: number | null; status: string; display_status: string; paid_reported_on: string | null };

export default async function BillsPage() {
  const s = await requireSession();
  const rows = (await listBills(s.ctx)) as Row[];
  const today = todayIn(s.user.timezone);
  const tone: Record<string, string> = { overdue: 'chip chip-rose', due: 'chip chip-amber', upcoming: 'chip chip-blue', user_reported_paid: 'chip chip-green', cancelled: 'chip' };
  return (
    <>
      <PageHeader title="Bills" description="Due dates and reminders for rent, utilities, fees and premiums. “Paid” is what you tell LifeOS — it does not connect to your bank." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {rows.length === 0 ? <Empty title="No bills yet">Capture a bill or add one here.</Empty> : (
            <ul className="card divide-y divide-[var(--line)]">
              {rows.map((r) => (
                <li key={r.occurrence_id} id={r.occurrence_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">{r.name} <span className="text-xs font-normal muted">· {humanize(r.category)} · {r.cycle === 'once' ? 'one-off' : r.cycle}</span></p>
                    <p className="text-xs muted">Due {r.due_date} · {r.amount_minor === null ? 'amount varies' : fmtMoney(r.amount_minor, r.currency)}{r.paid_reported_on ? ` · you reported paying on ${r.paid_reported_on}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={tone[r.display_status] ?? 'chip'}>{r.display_status === 'user_reported_paid' ? 'Paid (you reported)' : humanize(r.display_status)}</span>
                    {r.status === 'upcoming' && <ApiButton path={`/bill-occurrences/${r.occurrence_id}/paid`} body={{ paidOn: today }} className="btn btn-sm btn-primary" success="Recorded. The next one is scheduled.">I paid this</ApiButton>}
                    {r.status === 'upcoming' && <ApiButton path={`/bills/${r.bill_id}/cancel`} confirm="Stop tracking this bill?">Stop</ApiButton>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Section title="Add a bill">
          <ApiForm path="/bills" className="space-y-3">
            <div><label className="label" htmlFor="bn">Name</label><input id="bn" name="name" required className="field" placeholder="Electricity, rent, school fees…" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="bc">Type</label><select id="bc" name="category" className="field">{['rent', 'electricity', 'water', 'gas', 'internet', 'mobile', 'education', 'insurance', 'membership', 'maintenance', 'other'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></div>
              <div><label className="label" htmlFor="by">Repeats</label><select id="by" name="cycle" className="field"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option><option value="once">Once</option></select></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="bd">Next due</label><input id="bd" name="nextDueDate" type="date" required className="field" /></div>
              <div><label className="label" htmlFor="ba">Amount (₹)</label><input id="ba" name="amountMinor" data-kind="money" inputMode="decimal" className="field" placeholder="varies" /></div>
            </div>
            <button className="btn btn-primary w-full">Save</button>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

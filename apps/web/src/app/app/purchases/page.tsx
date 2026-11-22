import Link from 'next/link';
import { requireSession } from '@/server/session';
import { listPurchases } from '@lifeos/core/purchases';
import { hasFeature } from '@lifeos/core/billing';
import { PageHeader, Empty, PlanGate, Section } from '@/components/ui';
import { ApiForm } from '@/components/api';
import { fmtMoney } from '@/lib/format';

export const metadata = { title: 'Purchases' };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const q = (await searchParams).q;
  const [items, allowed] = await Promise.all([listPurchases(s.ctx, { search: q }) as Promise<Record<string, unknown>[]>, hasFeature(s.ctx.db, s.user.id, 'purchase_protection')]);
  return (
    <>
      <PageHeader title="Purchase Protection" description="Receipts, warranties, return windows and refunds. Terms come only from what you entered or confirmed from your own documents — never assumed." />
      {!allowed && items.length === 0 ? <PlanGate feature="Purchase Protection" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <form action="/app/purchases" className="mb-3"><input name="q" defaultValue={q} className="field" placeholder="Search purchases…" aria-label="Search purchases" /></form>
            {items.length === 0 ? <Empty title="No purchases yet">Capture a receipt or invoice — LifeOS suggests the purchase, warranty and return window for you to confirm.</Empty> : (
              <ul className="card divide-y divide-[var(--line)]">
                {items.map((p) => (
                  <li key={String(p.id)}>
                    <Link href={`/app/purchases/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--surface-2)]">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{String(p.product_name)}</span>
                        <span className="block text-xs muted">{[p.merchant, p.purchase_date, fmtMoney(p.amount_minor as number | null, String(p.currency))].filter((x) => x && x !== '—').join(' · ')}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.warranty_ends_on ? <span className={p.warranty_expired ? 'chip' : 'chip chip-green'}>{p.warranty_expired ? 'Warranty ended' : `Warranty to ${p.warranty_ends_on}`}</span> : null}
                        {p.return_id && p.return_status === 'open' ? <span className={p.return_lapsed ? 'chip' : 'chip chip-amber'}>{p.return_lapsed ? 'Return window passed' : `Return by ${p.return_deadline}`}</span> : null}
                        {p.return_status && p.return_status !== 'open' ? <span className="chip chip-violet">{String(p.return_status).replace(/_/g, ' ')}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {allowed && (
            <Section title="Add a purchase">
              <ApiForm path="/purchases" redirectTo={(d) => `/app/purchases/${(d as { id: string }).id}`} className="space-y-3">
                <div><label className="label" htmlFor="pn">Product</label><input id="pn" name="productName" required className="field" /></div>
                <div><label className="label" htmlFor="pm">Seller</label><input id="pm" name="merchant" className="field" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label" htmlFor="pd">Bought on</label><input id="pd" name="purchaseDate" type="date" className="field" /></div>
                  <div><label className="label" htmlFor="pa">Amount (₹)</label><input id="pa" name="amountMinor" data-kind="money" inputMode="decimal" className="field" /></div>
                </div>
                <div><label className="label" htmlFor="po">Order / invoice no.</label><input id="po" name="orderRef" className="field" /></div>
                <button className="btn btn-primary w-full">Save purchase</button>
              </ApiForm>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

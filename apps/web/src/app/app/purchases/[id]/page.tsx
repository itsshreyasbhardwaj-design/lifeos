import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { purchaseDetail } from '@lifeos/core/purchases';
import { checklist } from '@lifeos/core/tasks';
import { neighbours } from '@lifeos/core/links';
import { AppError } from '@lifeos/core/errors';
import { todayIn } from '@lifeos/core/time';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { Checklist } from '@/components/checklist';
import { RefundDraft } from '@/components/refund-draft';
import { fmtMoney, humanize } from '@/lib/format';

export const metadata = { title: 'Purchase' };

type W = { id: string; starts_on: string; ends_on: string; basis: string; terms: string | null; claim_status: string; provider: string | null };
type R = { id: string; deadline: string; status: string; basis: string; eligibility_notes: string | null };

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let d;
  try {
    d = await purchaseDetail(s.ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const p = d.purchase;
  const today = todayIn(s.user.timezone);
  const links = await neighbours(s.ctx.db, s.user.id, 'purchase', id);
  const warranties = d.warranties as W[];
  const returns = d.returns as R[];
  const claims = await Promise.all(warranties.map((w) => checklist(s.ctx.db, s.user.id, 'warranty', w.id)));
  return (
    <>
      <PageHeader back={{ href: '/app/purchases', label: 'Purchases' }} title={p.product_name}
        description={[p.merchant, p.purchase_date && `bought ${p.purchase_date}`, fmtMoney(p.amount_minor, p.currency), p.order_ref && `order ${p.order_ref}`].filter(Boolean).join(' · ')}
        actions={<>
          {p.receipt_document_id && <Link href={`/app/vault/${p.receipt_document_id}`} className="btn btn-sm btn-primary">Open receipt</Link>}
          <ApiButton path={`/purchases/${id}`} method="DELETE" className="btn btn-sm btn-danger" redirectTo="/app/purchases" confirm="Delete this purchase, its warranty and return records?">Delete</ApiButton>
        </>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Warranty">
          {warranties.length === 0 ? (
            <ApiForm path={`/purchases/${id}/warranty`} className="space-y-3" extra={{ remindDaysBefore: [30, 7] }}>
              <p className="text-sm muted">Enter the warranty from the card or invoice. LifeOS does not assume manufacturer terms.</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label" htmlFor="ws">Starts</label><input id="ws" name="startsOn" type="date" required defaultValue={p.purchase_date ?? ''} className="field" /></div>
                <div><label className="label" htmlFor="wm">Length (months)</label><input id="wm" name="months" type="number" min={1} data-kind="int" className="field" /></div>
              </div>
              <div><label className="label" htmlFor="we">…or end date</label><input id="we" name="endsOn" type="date" className="field" /></div>
              <div><label className="label" htmlFor="wt">Terms (optional)</label><textarea id="wt" name="terms" className="field min-h-16" /></div>
              <button className="btn btn-primary">Save warranty</button>
            </ApiForm>
          ) : warranties.map((w, i) => (
            <div key={w.id} className="space-y-3">
              <p className="text-sm"><span className={w.ends_on < today ? 'chip' : 'chip chip-green'}>{w.ends_on < today ? 'Ended' : 'Active'}</span> {w.starts_on} → <strong>{w.ends_on}</strong></p>
              <p className="text-xs muted">Basis: {w.basis === 'document_confirmed' ? 'read from your receipt and confirmed by you' : 'entered by you'}{w.terms ? ` · “${w.terms}”` : ''}</p>
              {w.claim_status === 'none' ? <ApiButton path={`/warranties/${w.id}/claim`} className="btn btn-sm">Prepare a warranty claim</ApiButton> : (
                <div>
                  <p className="mb-2 text-sm font-semibold">Claim: {humanize(w.claim_status)}</p>
                  <Checklist ownerType="warranty" ownerId={w.id} items={claims[i]!} />
                  <div className="mt-2 flex gap-2">{(['preparing', 'submitted', 'resolved'] as const).filter((x) => x !== w.claim_status).map((x) => <ApiButton key={x} path={`/warranties/${w.id}/claim-status`} body={{ status: x }}>Mark {x}</ApiButton>)}</div>
                  <p className="mt-2 text-xs muted">LifeOS keeps your checklist; you raise the claim with the brand or service centre yourself.</p>
                </div>
              )}
            </div>
          ))}
        </Section>
        <Section title="Return & refund">
          {returns.length === 0 ? (
            <ApiForm path={`/purchases/${id}/return`} className="space-y-3" extra={{ remindDaysBefore: [2, 0] }}>
              <p className="text-sm muted">Add the last day you can return it, as stated by the seller.</p>
              <div><label className="label" htmlFor="rd">Return by</label><input id="rd" name="deadline" type="date" required className="field" /></div>
              <div><label className="label" htmlFor="rn">Conditions (optional)</label><input id="rn" name="eligibilityNotes" className="field" placeholder="Unused, original packaging…" /></div>
              <button className="btn btn-primary">Save return window</button>
            </ApiForm>
          ) : returns.map((r) => (
            <div key={r.id} className="space-y-3">
              <p className="text-sm">Return by <strong>{r.deadline}</strong> <span className={r.status === 'open' && r.deadline < today ? 'chip' : 'chip chip-amber'}>{r.status === 'open' && r.deadline < today ? 'window passed' : humanize(r.status)}</span></p>
              {r.eligibility_notes && <p className="text-xs muted">{r.eligibility_notes}</p>}
              <div className="flex flex-wrap gap-2">
                {r.status === 'open' && <ApiButton path={`/returns/${r.id}/status`} body={{ status: 'return_requested' }}>I requested a return</ApiButton>}
                {['open', 'return_requested'].includes(r.status) && <ApiButton path={`/returns/${r.id}/status`} body={{ status: 'returned' }}>Item returned</ApiButton>}
                {r.status === 'refund_pending' && <ApiButton path={`/returns/${r.id}/status`} body={{ status: 'refunded' }} className="btn btn-sm btn-primary">Refund received</ApiButton>}
                {r.status !== 'closed' && <ApiButton path={`/returns/${r.id}/status`} body={{ status: 'closed' }}>Keep it / close</ApiButton>}
              </div>
              {['returned', 'return_requested'].includes(r.status) && (
                <ApiForm path={`/returns/${r.id}/status`} extra={{ status: 'refund_pending' }} className="flex flex-wrap items-end gap-2">
                  <div><label className="label" htmlFor="rf">Check refund on</label><input id="rf" name="refundFollowUpOn" type="date" required className="field" /></div>
                  <button className="btn btn-sm">Waiting for refund</button>
                </ApiForm>
              )}
              {r.status === 'refund_pending' && <RefundDraft purchaseId={id} />}
            </div>
          ))}
        </Section>
        <Section title="Service history">
          <ul className="mb-3 space-y-1.5 text-sm">{(d.services as { id: string; service_date: string; description: string; provider: string | null; cost_minor: number | null; currency: string }[]).map((x) => <li key={x.id}>{x.service_date} · {x.description}{x.provider ? ` · ${x.provider}` : ''}{x.cost_minor !== null ? ` · ${fmtMoney(x.cost_minor, x.currency)}` : ''}</li>)}</ul>
          <ApiForm path={`/purchases/${id}/service`} className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
            <input name="serviceDate" type="date" required className="field" aria-label="Service date" />
            <input name="description" required className="field" placeholder="What was done" aria-label="Service description" />
            <button className="btn">Add</button>
          </ApiForm>
        </Section>
        <Section title="Connected">
          <ul className="space-y-1.5 text-sm">{links.map((l) => <li key={l.linkId}><span className="chip mr-1.5">{humanize(l.relation)}</span>{l.type === 'document' ? <Link className="hover:underline" href={`/app/vault/${l.id}`}>{l.title}</Link> : l.type === 'capture' ? <Link className="hover:underline" href={`/app/inbox/${l.id}`}>{l.title ?? 'Original capture'}</Link> : l.type === 'task' ? <Link className="hover:underline" href={`/app/tasks/${l.id}`}>{l.title}</Link> : (l.title ?? humanize(l.type))}</li>)}</ul>
        </Section>
      </div>
    </>
  );
}

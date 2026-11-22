import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { loadScoped } from '@lifeos/core/access';
import { checklist } from '@lifeos/core/tasks';
import { neighbours } from '@lifeos/core/links';
import { historyFor } from '@lifeos/core/audit';
import { ADMIN_STATUSES } from '@lifeos/core/planning';
import { listDocuments } from '@lifeos/core/documents';
import { AppError } from '@lifeos/core/errors';
import { PageHeader, Section } from '@/components/ui';
import { ApiForm } from '@/components/api';
import { Checklist } from '@/components/checklist';
import { fmtDateTime, humanize } from '@/lib/format';

export const metadata = { title: 'Workflow' };

type W = { id: string; workspace_id: string; title: string; status: string; official_url: string | null; reference_number: string | null; deadline: string | null; notes: string | null; submitted_on: string | null; confirmed_on: string | null };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let w: W;
  try {
    w = await loadScoped<W>(s.ctx.db, s.user.id, 'admin_workflows', id, 'read', 'Workflow');
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const [items, links, history, docs] = await Promise.all([checklist(s.ctx.db, s.user.id, 'admin_workflow', id), neighbours(s.ctx.db, s.user.id, 'admin_workflow', id), historyFor(s.ctx.db, 'admin_workflow', id), listDocuments(s.ctx)]);
  const idx = ADMIN_STATUSES.indexOf(w.status as never);
  return (
    <>
      <PageHeader back={{ href: '/app/admin', label: 'LifeAdmin' }} title={w.title}
        description={<>{humanize(w.status)}{w.deadline ? ` · deadline ${w.deadline}` : ''}{w.reference_number ? ` · reference ${w.reference_number}` : ''}{w.submitted_on ? ` · you reported submitting on ${w.submitted_on}` : ''}</>}
        actions={w.official_url ? <a href={w.official_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-sm">Official website ↗</a> : undefined} />
      <ol className="mb-5 flex gap-1 overflow-x-auto pb-1 text-[11px]" aria-label="Progress">
        {ADMIN_STATUSES.filter((x) => !['rejected', 'cancelled'].includes(x)).map((st, i) => <li key={st} className={`whitespace-nowrap rounded-full px-2.5 py-1 font-semibold ${i <= idx ? 'bg-[var(--color-emerald-soft)] text-emerald-900' : 'bg-[var(--surface-2)] muted'}`} aria-current={st === w.status ? 'step' : undefined}>{humanize(st)}</li>)}
      </ol>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Documents and steps"><Checklist ownerType="admin_workflow" ownerId={id} items={items} groupHint="Steps" /></Section>
        <div className="space-y-5">
          <Section title="Update status">
            <ApiForm path={`/admin/${id}/status`} success="Updated." className="space-y-2">
              <select name="status" defaultValue={w.status} className="field" aria-label="Status">{ADMIN_STATUSES.map((st) => <option key={st} value={st}>{humanize(st)}</option>)}</select>
              <input name="referenceNumber" className="field" placeholder="Reference / application number" aria-label="Reference number" />
              <input name="on" type="date" className="field" aria-label="Date" />
              <input name="note" className="field" placeholder="Note (e.g. “acceptance email received”)" aria-label="Note" />
              <button className="btn btn-primary btn-sm">Save</button>
            </ApiForm>
          </Section>
          <Section title="Evidence & documents">
            <ul className="mb-3 space-y-1.5 text-sm">{links.map((l) => <li key={l.linkId}><span className="chip mr-1.5">{humanize(l.relation)}</span>{l.title ?? humanize(l.type)}</li>)}</ul>
            <ApiForm path="/links" success="Attached." className="flex gap-2" transform={(b) => ({ fromType: 'document', fromId: b.documentId, toType: 'admin_workflow', toId: id, relation: 'evidence_for', workspaceId: w.workspace_id })}>
              <select name="documentId" required className="field" aria-label="Document" defaultValue=""><option value="" disabled>Attach a document…</option>{docs.filter((d) => d.workspace_id === w.workspace_id).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
              <button className="btn">Attach</button>
            </ApiForm>
          </Section>
          <Section title="History"><ol className="space-y-1 text-xs">{history.map((h, i) => <li key={i}>{fmtDateTime(h.at, s.user.timezone)} · {h.actor_name ?? 'System'} · {humanize(h.action.replace('status:', 'status → '))}{'note' in h.changes && h.changes.note ? ` — “${h.changes.note}”` : ''}</li>)}</ol></Section>
        </div>
      </div>
    </>
  );
}

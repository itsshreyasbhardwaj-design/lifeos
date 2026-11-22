import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { lifeEventDetail } from '@lifeos/core/planning';
import { checklist } from '@lifeos/core/tasks';
import { neighbours } from '@lifeos/core/links';
import { listDocuments } from '@lifeos/core/documents';
import { AppError } from '@lifeos/core/errors';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { Checklist } from '@/components/checklist';
import { humanize } from '@/lib/format';

export const metadata = { title: 'Life event' };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let d;
  try {
    d = await lifeEventDetail(s.ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const e = d.event as Record<string, string | null> & { workspace_id: string };
  const [items, links, docs] = await Promise.all([checklist(s.ctx.db, s.user.id, 'life_event', id), neighbours(s.ctx.db, s.user.id, 'life_event', id), listDocuments(s.ctx)]);
  return (
    <>
      <PageHeader back={{ href: '/app/events', label: 'Life Events' }} title={String(e.title)}
        description={<>{e.starts_on ? `${e.starts_on}${e.ends_on && e.ends_on !== e.starts_on ? ` → ${e.ends_on}` : ''}` : 'No date'}{e.location ? ` · ${e.location}` : ''} · {humanize(String(e.status))}</>}
        actions={<>{(['in_progress', 'done', 'cancelled'] as const).filter((x) => x !== e.status).map((x) => <ApiButton key={x} path={`/events/${id}/status`} body={{ status: x }}>Mark {humanize(x).toLowerCase()}</ApiButton>)}</>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Checklist & packing"><Checklist ownerType="life_event" ownerId={id} items={items} /></Section>
        <div className="space-y-5">
          <Section title="People & responsibilities">
            <ul className="mb-3 space-y-1.5 text-sm">{(d.participants as { id: string; name: string; responsibility: string | null }[]).map((p) => <li key={p.id}><span className="font-medium">{p.name}</span>{p.responsibility ? <span className="muted"> — {p.responsibility}</span> : null}</li>)}</ul>
            <ApiForm path={`/events/${id}/participants`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input name="name" required className="field" placeholder="Name" aria-label="Name" /><input name="responsibility" className="field" placeholder="Doing what" aria-label="Responsibility" /><button className="btn">Add</button></ApiForm>
          </Section>
          <Section title="Bookings & documents">
            <ul className="mb-3 space-y-1.5 text-sm">{links.map((l) => <li key={l.linkId}><span className="chip mr-1.5">{humanize(l.relation)}</span>{l.title ?? humanize(l.type)}</li>)}</ul>
            <ApiForm path="/links" className="flex gap-2" transform={(b) => ({ fromType: 'document', fromId: b.documentId, toType: 'life_event', toId: id, relation: 'part_of', workspaceId: e.workspace_id })}>
              <select name="documentId" required className="field" aria-label="Document" defaultValue=""><option value="" disabled>Attach a document…</option>{docs.filter((x) => x.workspace_id === e.workspace_id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
              <button className="btn">Attach</button>
            </ApiForm>
          </Section>
        </div>
      </div>
    </>
  );
}

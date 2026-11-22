import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { documentAccess, versions, grantsFor, accessLog, DOCUMENT_CATEGORIES } from '@lifeos/core/documents';
import { neighbours } from '@lifeos/core/links';
import { members } from '@lifeos/core/family';
import { AppError } from '@lifeos/core/errors';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { fmtDateTime, humanize } from '@/lib/format';

export const metadata = { title: 'Document' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let a;
  try {
    a = await documentAccess(s.ctx.db, s.user.id, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const d = a.doc;
  const owner = a.canEdit && !a.viaGrant;
  const [vs, links, grants, log] = await Promise.all([
    versions(s.ctx, id), neighbours(s.ctx.db, s.user.id, 'document', id),
    owner ? grantsFor(s.ctx, id).catch(() => []) : Promise.resolve([]), owner ? accessLog(s.ctx, id).catch(() => []) : Promise.resolve([]),
  ]);
  const families = s.spaces.filter((x) => x.kind === 'family');
  const people = owner ? (await Promise.all(families.map((f) => members(s.ctx, f.workspaceId).catch(() => null)))).flatMap((m) => m?.people ?? []).filter((p, i, arr) => p.user_id !== s.user.id && arr.findIndex((q) => q.user_id === p.user_id) === i) : [];
  const current = vs[0];
  const src = `/api/v1/files/document/${id}`;
  return (
    <>
      <PageHeader back={{ href: '/app/vault', label: 'Documents' }} title={d.title}
        description={<>{humanize(d.category)}{d.issuer ? ` · ${d.issuer}` : ''}{d.expires_on ? ` · expires ${d.expires_on}` : ''}{a.viaGrant ? ` · shared with you${a.canDownload ? '' : ' (view only)'}` : ''}</>}
        actions={<>
          {current && a.canDownload && <a href={`${src}?download=1`} className="btn btn-sm">Download</a>}
          {owner && <ApiButton path={`/documents/${id}`} method="DELETE" className="btn btn-sm btn-danger" redirectTo="/app/vault" confirm="Delete this document and every version? This cannot be undone.">Delete</ApiButton>}
        </>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Preview">
            {!current ? <p className="text-sm muted">No file — details only.</p> : d.is_sensitive ? <p className="text-sm muted">Marked sensitive: preview hidden. <a className="underline" href={src} target="_blank" rel="noopener">Open in a new tab</a>.</p>
              : current.mime_type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={d.title} className="max-h-[36rem] w-full rounded-lg border border-[var(--line)] object-contain" />
              ) : current.mime_type === 'application/pdf' ? <object data={src} type="application/pdf" className="h-[32rem] w-full rounded-lg border border-[var(--line)]" aria-label={d.title}><a href={src}>Open PDF</a></object>
              : current.mime_type === 'text/plain' ? <iframe src={src} title={d.title} sandbox="" className="h-80 w-full rounded-lg border border-[var(--line)] bg-white" /> : <a className="underline" href={src}>Open file</a>}
          </Section>
          {a.canEdit && (
            <Section title="Details">
              <ApiForm path={`/documents/${id}`} method="PATCH" resetOnSuccess={false} success="Saved." className="grid gap-3 sm:grid-cols-2" transform={(b) => ({ ...b, isSensitive: Boolean(b.isSensitive) })}>
                <div className="sm:col-span-2"><label className="label" htmlFor="t">Title</label><input id="t" name="title" defaultValue={d.title} className="field" required /></div>
                <div><label className="label" htmlFor="c">Category</label><select id="c" name="category" defaultValue={d.category} className="field">{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></div>
                <div><label className="label" htmlFor="i">Issued by</label><input id="i" name="issuer" defaultValue={d.issuer ?? ''} className="field" /></div>
                <div><label className="label" htmlFor="io">Issued on</label><input id="io" name="issuedOn" type="date" defaultValue={d.issued_on ?? ''} className="field" /></div>
                <div><label className="label" htmlFor="e">Expires</label><input id="e" name="expiresOn" type="date" defaultValue={d.expires_on ?? ''} className="field" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="g">Tags</label><input id="g" name="tags" data-kind="list" defaultValue={d.tags.join(', ')} className="field" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="n">Notes</label><textarea id="n" name="notes" defaultValue={d.notes ?? ''} className="field min-h-16" /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isSensitive" data-kind="bool" defaultChecked={d.is_sensitive} /> Sensitive</label>
                <div className="sm:col-span-2"><button className="btn btn-primary">Save</button></div>
              </ApiForm>
            </Section>
          )}
        </div>
        <div className="space-y-5">
          <Section title={`Versions (${vs.length})`}>
            <ul className="mb-3 space-y-1.5 text-sm">{vs.map((v) => <li key={v.id} className="flex justify-between gap-2"><span>v{v.version} · {v.original_name}</span><span className="text-xs muted">{fmtDateTime(v.created_at, s.user.timezone)}</span></li>)}</ul>
            {a.canEdit && <ApiForm path={`/documents/${id}/versions`} multipart success="New version saved." className="flex flex-wrap gap-2"><input type="file" name="file" required className="text-sm" aria-label="New version" /><button className="btn btn-sm">Upload new version</button></ApiForm>}
          </Section>
          {owner && (
            <Section title="Sharing">
              {families.length === 0 ? <p className="text-sm muted">Private. Create a family space to share selected documents.</p> : (
                <ApiForm path={`/documents/${id}/share`} success="Shared." className="space-y-2" transform={(b) => {
                  const [kind, target] = String(b.target).split(':');
                  return { granteeUserId: kind === 'u' ? target : null, granteeWorkspaceId: kind === 'w' ? target : null, canDownload: Boolean(b.canDownload), expiresAt: b.expiresAt ? new Date(String(b.expiresAt)).toISOString() : null };
                }}>
                  <label className="label" htmlFor="share-target">Share with</label>
                  <select id="share-target" name="target" className="field" required>
                    {families.map((f) => <option key={f.workspaceId} value={`w:${f.workspaceId}`}>Everyone in {f.name}</option>)}
                    {people.map((p) => <option key={p.user_id} value={`u:${p.user_id}`}>{p.display_name}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canDownload" data-kind="bool" /> Allow download</label>
                  <div><label className="label" htmlFor="exp">Access ends (optional)</label><input id="exp" name="expiresAt" type="datetime-local" className="field" /></div>
                  <button className="btn btn-sm btn-primary">Share</button>
                  <p className="text-xs muted">View-only still lets someone see the document; it hides the download button and serves it inline.</p>
                </ApiForm>
              )}
              {grants.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm">{(grants as { id: string; grantee_name: string | null; grantee_workspace: string | null; can_download: boolean; expires_at: Date | null; revoked_at: Date | null }[]).map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span>{g.grantee_name ?? `Everyone in ${g.grantee_workspace}`} <span className="text-xs muted">· {g.can_download ? 'can download' : 'view only'}{g.expires_at ? ` · until ${fmtDateTime(g.expires_at, s.user.timezone)}` : ''}</span></span>
                    {g.revoked_at ? <span className="chip">Revoked</span> : <ApiButton path={`/grants/${g.id}`} method="DELETE" className="btn btn-sm btn-danger">Revoke</ApiButton>}
                  </li>
                ))}</ul>
              )}
            </Section>
          )}
          <Section title="Connected">
            {links.length === 0 ? <p className="text-sm muted">Not linked to anything yet.</p> : <ul className="space-y-1.5 text-sm">{links.map((l) => <li key={l.linkId}><span className="chip mr-1.5">{humanize(l.relation)}</span>{l.type === 'purchase' ? <Link className="hover:underline" href={`/app/purchases/${l.id}`}>{l.title}</Link> : l.type === 'capture' ? <Link className="hover:underline" href={`/app/inbox/${l.id}`}>{l.title ?? 'Original capture'}</Link> : (l.title ?? humanize(l.type))}</li>)}</ul>}
          </Section>
          {owner && (
            <Section title="Access history">
              <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">{(log as { action: string; at: Date; actor: string | null }[]).map((l, i) => <li key={i}>{fmtDateTime(l.at, s.user.timezone)} · {l.actor ?? 'deleted account'} · {humanize(l.action.replace('document.', ''))}</li>)}</ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

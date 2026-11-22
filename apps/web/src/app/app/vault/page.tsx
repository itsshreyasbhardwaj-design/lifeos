import Link from 'next/link';
import { requireSession } from '@/server/session';
import { listDocuments, DOCUMENT_CATEGORIES } from '@lifeos/core/documents';
import { usage } from '@lifeos/core/billing';
import { PageHeader, Empty, Section } from '@/components/ui';
import { ApiForm } from '@/components/api';
import { humanize } from '@/lib/format';

export const metadata = { title: 'Documents' };

export default async function VaultPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string; expiring?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const [docs, u] = await Promise.all([listDocuments(s.ctx, { category: sp.category, search: sp.q, expiringWithinDays: sp.expiring ? Number(sp.expiring) : undefined }), usage(s.ctx.db, s.user.id)]);
  const storage = u.find((x) => x.metric === 'storage_bytes')!;
  return (
    <>
      <PageHeader title="Life Vault" description={<>Private by default and encrypted at rest. Family members see a document only if you share that document. Storing a copy here does not make it an official or verified record. Using {(storage.used / 1024 / 1024).toFixed(1)} MB of {(storage.limit / 1024 / 1024 / 1024).toFixed(1)} GB.</>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <form action="/app/vault" className="mb-3 flex flex-wrap gap-2">
            <input name="q" defaultValue={sp.q} className="field !w-56" placeholder="Title or tag…" aria-label="Search documents" />
            <select name="category" defaultValue={sp.category ?? ''} className="field !w-auto" aria-label="Category"><option value="">All categories</option>{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
            <select name="expiring" defaultValue={sp.expiring ?? ''} className="field !w-auto" aria-label="Expiry"><option value="">Any expiry</option><option value="30">Expiring in 30 days</option><option value="90">Expiring in 90 days</option></select>
            <button className="btn btn-sm">Filter</button>
          </form>
          {docs.length === 0 ? <Empty title="No documents yet">Upload a document here, or save a receipt when you confirm a purchase.</Empty> : (
            <ul className="card divide-y divide-[var(--line)]">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/vault/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--surface-2)]">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{d.title}</span>
                      <span className="block text-xs muted">{humanize(d.category)}{d.mime_type ? ` · ${d.mime_type.split('/')[1]}` : ' · details only'}{d.size_bytes ? ` · ${(d.size_bytes / 1024).toFixed(0)} KB` : ''}{d.tags.length ? ` · ${d.tags.map((t) => `#${t}`).join(' ')}` : ''}</span></span>
                    <span className="flex gap-1.5">
                      {d.shared_with_me && <span className="chip chip-violet">Shared with you{d.can_download ? '' : ' · view only'}</span>}
                      {d.workspace_name !== 'Personal' && !d.shared_with_me && <span className="chip">{d.workspace_name}</span>}
                      {d.is_sensitive && <span className="chip chip-rose">Sensitive</span>}
                      {d.expires_on && <span className="chip chip-amber">Expires {d.expires_on}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Section title="Upload">
          <ApiForm path="/documents" multipart redirectTo="/app/vault/:id" className="space-y-3">
            <input type="file" name="file" required className="text-sm" aria-label="File" accept="image/*,application/pdf,text/plain" />
            <div><label className="label" htmlFor="dt">Title</label><input id="dt" name="title" className="field" placeholder="Defaults to the file name" /></div>
            <div><label className="label" htmlFor="dc">Category</label><select id="dc" name="category" className="field">{DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></div>
            <div><label className="label" htmlFor="de">Expires (optional)</label><input id="de" name="expiresOn" type="date" className="field" /></div>
            <div><label className="label" htmlFor="dg">Tags</label><input id="dg" name="tags" className="field" placeholder="car, insurance" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isSensitive" /> Mark as sensitive (hidden from previews)</label>
            <button className="btn btn-primary w-full">Upload</button>
            <p className="text-xs muted">Don’t store full ID numbers you don’t need. Text in PDFs and images is read on this server so you can search it.</p>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

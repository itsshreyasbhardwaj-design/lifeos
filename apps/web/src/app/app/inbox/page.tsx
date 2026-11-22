import Link from 'next/link';
import { FileText, Image as ImageIcon, Link2, Mic, Type } from 'lucide-react';
import { requireSession } from '@/server/session';
import { listCaptures } from '@lifeos/core/captures';
import { Empty, PageHeader } from '@/components/ui';
import { fmtDateTime, humanize } from '@/lib/format';

export const metadata = { title: 'Inbox' };

const FILTERS = [['unreviewed', 'Needs review'], ['all', 'All'], ['failed', 'Could not read'], ['archived', 'Archived']] as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await requireSession();
  const status = ((await searchParams).status ?? 'unreviewed') as 'unreviewed';
  const items = await listCaptures(s.ctx, { status });
  const icon = (t: string, mime: string | null) => (mime?.startsWith('image/') ? ImageIcon : mime?.startsWith('audio/') || t === 'voice' ? Mic : mime === 'application/pdf' || t === 'pdf' ? FileText : t === 'url' ? Link2 : Type);
  return (
    <>
      <PageHeader title="Life Inbox" description="Everything you capture lands here first. Nothing becomes a task, reminder or record until you confirm it." />
      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([id, label]) => <Link key={id} href={`/app/inbox?status=${id}`} aria-current={status === id ? 'page' : undefined} className={`btn btn-sm ${status === id ? 'btn-primary' : ''}`}>{label}</Link>)}
      </nav>
      {items.length === 0 ? (
        <Empty title={status === 'unreviewed' ? 'All caught up' : 'Nothing here'}>Capture a screenshot, receipt, PDF, link or a quick note — press C.</Empty>
      ) : (
        <ul className="card divide-y divide-[var(--line)]">
          {items.map((c) => {
            const Icon = icon(c.source_type, c.first_mime);
            const label = c.status === 'failed' ? ['chip chip-rose', 'Could not read'] : c.pending ? ['chip chip-amber', `${c.pending} to review`] : ['queued', 'processing'].includes(c.status) ? ['chip chip-blue', 'Reading…'] : c.accepted ? ['chip chip-green', `${c.accepted} saved`] : ['chip', humanize(c.status)];
            return (
              <li key={c.id}>
                <Link href={`/app/inbox/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)]"><Icon size={17} aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.title ?? c.url_title ?? c.text_content?.slice(0, 90) ?? c.url ?? humanize(c.source_type)}</span>
                    <span className="block text-xs muted">{fmtDateTime(c.created_at, s.user.timezone, s.user.locale)} · {humanize(c.source_type)}{c.file_count ? ` · ${c.file_count} file${c.file_count > 1 ? 's' : ''}` : ''}{c.workspace_name !== 'Personal' ? ` · ${c.workspace_name}` : ''}</span>
                  </span>
                  <span className={label[0]}>{label[1]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

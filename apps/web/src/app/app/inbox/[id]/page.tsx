import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getCapture } from '@lifeos/core/captures';
import { neighbours } from '@lifeos/core/links';
import { historyFor } from '@lifeos/core/audit';
import { AppError } from '@lifeos/core/errors';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton } from '@/components/api';
import { ManualSuggestion, ProcessingWatcher, ReviewBoard, type Candidate } from '@/components/review';
import { fmtDateTime, humanize } from '@/lib/format';

export const metadata = { title: 'Review' };

function Highlighted({ text, spans }: { text: string; spans: { start: number; end: number }[] }) {
  const sorted = [...spans].filter((s) => s.end > s.start && s.end <= text.length).sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const s of sorted) {
    if (s.start < pos) continue;
    out.push(text.slice(pos, s.start));
    out.push(<mark key={s.start} className="rounded bg-[var(--color-violet-soft)] px-0.5 text-inherit">{text.slice(s.start, s.end)}</mark>);
    pos = s.end;
  }
  out.push(text.slice(pos));
  return <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-2)] p-3 font-sans text-sm leading-relaxed">{out}</pre>;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let data;
  try {
    data = await getCapture(s.ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const { capture: c, files, candidates } = data;
  const [linked, history] = await Promise.all([neighbours(s.ctx.db, s.user.id, 'capture', id), historyFor(s.ctx.db, 'capture', id)]);
  const spans = candidates.flatMap((x) => x.evidence);
  const anchor = (candidates[0]?.provenance as { anchor?: string } | undefined)?.anchor;
  return (
    <>
      <PageHeader
        back={{ href: '/app/inbox', label: 'Inbox' }}
        title={c.title ?? c.url_title ?? 'Review suggestions'}
        description={<>Captured {fmtDateTime(c.created_at, s.user.timezone, s.user.locale)} · {humanize(c.source_type)}{c.source_date ? ` · dated ${c.source_date}` : ''}{c.extraction_engine ? ` · read with ${c.extraction_engine}` : ''}</>}
        actions={<>
          <ApiButton path={`/captures/${id}/reprocess`} className="btn btn-sm" success="Reading again…">Read again</ApiButton>
          <ApiButton path={`/captures/${id}/archive`} body={{ archived: c.status !== 'archived' }} className="btn btn-sm">{c.status === 'archived' ? 'Unarchive' : 'Archive'}</ApiButton>
          <ApiButton path={`/captures/${id}`} method="DELETE" className="btn btn-sm btn-danger" redirectTo="/app/inbox" confirm="Delete this capture and its files? Records you already confirmed from it are kept.">Delete</ApiButton>
        </>}
      />
      <ProcessingWatcher id={id} status={c.status} />
      {c.status === 'failed' && <p role="alert" className="warn mb-4">This capture could not be read automatically ({c.error}). The original is safe below. Try “Read again”, or add what you need yourself.</p>}
      {c.extraction_note && <p className="warn mb-4 whitespace-pre-wrap">{c.extraction_note}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Section title="Original">
            {files.map((f) => (
              <div key={f.id} className="mb-3">
                {f.mime_type.startsWith('image/') && f.mime_type !== 'image/heic' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/files/capture/${f.id}`} alt={`Captured image ${f.original_name}`} className="max-h-[32rem] w-full rounded-lg border border-[var(--line)] object-contain" />
                ) : f.mime_type === 'application/pdf' ? (
                  <object data={`/api/v1/files/capture/${f.id}`} type="application/pdf" className="h-96 w-full rounded-lg border border-[var(--line)]" aria-label={f.original_name}><a href={`/api/v1/files/capture/${f.id}`}>Open {f.original_name}</a></object>
                ) : f.mime_type.startsWith('audio/') ? (
                  <audio controls src={`/api/v1/files/capture/${f.id}`} className="w-full" />
                ) : null}
                <p className="mt-1 flex items-center justify-between text-xs muted"><span>{f.original_name} · {(f.size_bytes / 1024).toFixed(0)} KB</span><a className="underline" href={`/api/v1/files/capture/${f.id}?download=1`}>Download</a></p>
              </div>
            ))}
            {c.url && <p className="mb-3 text-sm"><a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-[var(--color-blue)] underline">{c.url}</a></p>}
            {c.extracted_text ? <Highlighted text={c.extracted_text} spans={spans} /> : !files.length && c.text_content && <Highlighted text={c.text_content} spans={[]} />}
            {spans.length > 0 && <p className="mt-2 text-xs muted"><mark className="rounded bg-[var(--color-violet-soft)] px-1">Highlighted</mark> text is where each suggestion came from.</p>}
          </Section>
          {linked.length > 0 && (
            <Section title="Connected records">
              <ul className="space-y-1.5 text-sm">
                {linked.map((l) => <li key={l.linkId}><span className="chip mr-2">{humanize(l.relation)}</span>{l.title ?? humanize(l.type)}</li>)}
              </ul>
            </Section>
          )}
        </div>
        <div className="space-y-4">
          <h2 className="h2">Suggestions <span className="text-sm font-normal muted">— check, edit, then confirm</span></h2>
          {candidates.length === 0 && !['queued', 'processing'].includes(c.status) && <p className="text-sm muted">Nothing was suggested from this capture. You can add your own below.</p>}
          <ReviewBoard candidates={candidates as unknown as Candidate[]} anchor={anchor} />
          <Section title="Add your own">
            <ManualSuggestion captureId={id} />
          </Section>
          {history.length > 0 && (
            <details className="card p-4 text-sm">
              <summary className="cursor-pointer font-semibold">Review history</summary>
              <ul className="mt-2 space-y-1">
                {history.map((h, i) => <li key={i} className="muted">{fmtDateTime(h.at, s.user.timezone)} · {h.actor_name ?? 'System'} · {humanize(h.action)}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    </>
  );
}

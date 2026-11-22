import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getTask, subtasks, checklist, dependencies, listTasks } from '@lifeos/core/tasks';
import { remindersFor } from '@lifeos/core/reminders';
import { neighbours } from '@lifeos/core/links';
import { historyFor } from '@lifeos/core/audit';
import { comments, members } from '@lifeos/core/family';
import { describeRecurrence } from '@lifeos/extract';
import { AppError } from '@lifeos/core/errors';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { TaskList } from '@/components/tasks';
import { Checklist } from '@/components/checklist';
import { fmtDateTime, humanize } from '@/lib/format';
import { todayIn } from '@lifeos/core/time';

export const metadata = { title: 'Task' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let t;
  try {
    t = await getTask(s.ctx.db, s.user.id, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const limited = t._role === 'limited';
  const [subs, items, deps, rems, links, history, notes, others] = await Promise.all([
    subtasks(s.ctx.db, id), checklist(s.ctx.db, s.user.id, 'task', id), dependencies(s.ctx.db, id), remindersFor(s.ctx.db, s.user.id, 'task', id),
    neighbours(s.ctx.db, s.user.id, 'task', id), historyFor(s.ctx.db, 'task', id), comments(s.ctx, 'task', id).catch(() => []),
    limited ? Promise.resolve([]) : listTasks(s.ctx, { view: 'all', workspaceIds: [t.workspace_id], limit: 100 }),
  ]);
  const team = await members(s.ctx, t.workspace_id).catch(() => null);
  const today = todayIn(s.user.timezone);
  const open = ['open', 'in_progress', 'waiting'].includes(t.status);
  return (
    <>
      <PageHeader back={{ href: '/app/tasks', label: 'Tasks' }} title={t.title}
        description={<>{humanize(t.status)}{t.due_date ? ` · due ${t.due_date}${t.due_time ? ` ${t.due_time}` : ''}` : ''}{t.recurrence ? ` · ${describeRecurrence(t.recurrence)}` : ''}{t.completed_at ? ` · completed ${fmtDateTime(t.completed_at, s.user.timezone)}` : ''}</>}
        actions={<>
          {t.status === 'open' && !limited && <ApiButton path={`/tasks/${id}/status`} body={{ status: 'in_progress' }}>Start</ApiButton>}
          {t.series_id && open && !limited && <ApiButton path={`/tasks/${id}/status`} body={{ status: 'skipped', note: 'Skipped this occurrence' }}>Skip this one</ApiButton>}
          {!open && <ApiButton path={`/tasks/${id}/status`} body={{ status: 'open' }}>Reopen</ApiButton>}
          {open && !limited && <ApiButton path={`/tasks/${id}/status`} body={{ status: 'cancelled' }} confirm="Cancel this task? Its reminders stop.">Cancel</ApiButton>}
          {!limited && <ApiButton path={`/tasks/${id}`} method="DELETE" className="btn btn-sm btn-danger" redirectTo="/app/tasks" confirm="Delete this task permanently?">Delete</ApiButton>}
        </>}
      />
      {t.assignee_id === s.user.id && t.assignment_status === 'pending' && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 p-3">
          <p className="text-sm">This was assigned to you.</p>
          <div className="flex gap-2"><ApiButton path={`/tasks/${id}/assignment`} body={{ accept: true }} className="btn btn-sm btn-primary">Accept</ApiButton><ApiButton path={`/tasks/${id}/assignment`} body={{ accept: false }}>Decline</ApiButton></div>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {open && (
            <Section title="Complete">
              <ApiForm path={`/tasks/${id}/status`} extra={{ status: 'completed' }} success="Marked complete." className="space-y-3">
                <textarea name="note" className="field min-h-16" placeholder="Completion note (optional) — e.g. “Submitted online, ref APP-2291”" aria-label="Completion note" />
                <button className="btn btn-primary">Mark complete</button>
              </ApiForm>
            </Section>
          )}
          {!limited && (
            <Section title="Details">
              <ApiForm path={`/tasks/${id}`} method="PATCH" resetOnSuccess={false} success="Saved." className="grid gap-3 sm:grid-cols-2" transform="taskDetails" extra={{ expectedVersion: t.version }}>
                <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label><input id="title" name="title" defaultValue={t.title} className="field" required /></div>
                <div><label className="label" htmlFor="due">Due date</label><input id="due" name="dueDate" type="date" defaultValue={t.due_date ?? ''} className="field" /></div>
                <div><label className="label" htmlFor="time">Time (optional)</label><input id="time" name="dueTime" type="time" defaultValue={t.due_time ?? ''} className="field" /></div>
                <div><label className="label" htmlFor="prio">Priority</label><select id="prio" name="priority" data-kind="int" defaultValue={String(t.priority)} className="field"><option value="0">None</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></div>
                <div><label className="label" htmlFor="est">Estimate (minutes)</label><input id="est" name="estimateMinutes" data-kind="int" type="number" min={1} defaultValue={t.estimate_minutes ?? ''} className="field" /></div>
                <div><label className="label" htmlFor="wait">Waiting on</label><input id="wait" name="waitingOn" defaultValue={t.waiting_on ?? ''} className="field" placeholder="e.g. Service centre" /></div>
                <div><label className="label" htmlFor="tags">Tags</label><input id="tags" name="tags" data-kind="list" defaultValue={t.tags.join(', ')} className="field" placeholder="home, admin" /></div>
                {team && team.people.length > 1 && (
                  <div><label className="label" htmlFor="assignee">Assigned to</label><select id="assignee" name="assigneeId" defaultValue={t.assignee_id ?? ''} className="field"><option value="">Nobody</option>{team.people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></div>
                )}
                <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" defaultValue={t.notes ?? ''} className="field min-h-20" /></div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="remind" data-kind="bool" defaultChecked={t.reminder_offsets.length > 0} /> Remind me when it is due {t.due_time ? '' : `(at ${s.user.default_reminder_time}, your default time)`}</label>
                <div className="sm:col-span-2"><button className="btn btn-primary">Save changes</button></div>
              </ApiForm>
            </Section>
          )}
          <Section title="Checklist"><Checklist ownerType="task" ownerId={id} items={items} canEdit={!limited} /></Section>
          {!limited && (
            <Section title={`Subtasks${subs.length ? ` (${subs.filter((x) => x.status === 'completed').length}/${subs.length})` : ''}`}>
              {subs.length > 0 && <TaskList tasks={subs} today={today} />}
              <ApiForm path="/tasks" className="mt-2 flex gap-2" extra={{ parentId: id, workspaceId: t.workspace_id }}><input name="title" required className="field" placeholder="Add a subtask" aria-label="Subtask" /><button className="btn">Add</button></ApiForm>
            </Section>
          )}
          {!limited && (
            <Section title="Depends on">
              {deps.length > 0 && <ul className="mb-2 space-y-1 text-sm">{deps.map((d) => <li key={d.id} className="flex items-center justify-between gap-2"><Link href={`/app/tasks/${d.id}`} className="hover:underline">{d.title}</Link><span className="flex items-center gap-2"><span className={d.status === 'completed' ? 'chip chip-green' : 'chip'}>{humanize(d.status)}</span><ApiButton path={`/tasks/${id}/dependencies/${d.id}`} method="DELETE" className="btn btn-ghost btn-sm">Remove</ApiButton></span></li>)}</ul>}
              <ApiForm path={`/tasks/${id}/dependencies`} className="flex gap-2"><select name="dependsOnId" required className="field" aria-label="Task this depends on" defaultValue=""><option value="" disabled>Choose a task…</option>{others.filter((o) => o.id !== id && !deps.some((d) => d.id === o.id)).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select><button className="btn">Add</button></ApiForm>
              <p className="mt-2 text-xs muted">A task cannot be completed while something it depends on is still open.</p>
            </Section>
          )}
          {notes.length > 0 || t.workspace_id !== s.spaces.find((x) => x.kind === 'personal')?.workspaceId ? (
            <Section title="Comments">
              <ul className="mb-3 space-y-2">{notes.map((c) => <li key={c.id} className="text-sm"><span className="font-semibold">{c.author ?? 'Someone'}</span> <span className="text-xs muted">{fmtDateTime(c.created_at, s.user.timezone)}</span><p>{c.body}</p></li>)}</ul>
              <ApiForm path="/comments" className="flex gap-2" extra={{ entityType: 'task', entityId: id }}><input name="body" required className="field" placeholder="Write a comment" aria-label="Comment" /><button className="btn">Post</button></ApiForm>
            </Section>
          ) : null}
        </div>
        <div className="space-y-5">
          <Section title="Reminders">
            {rems.length === 0 ? <p className="text-sm muted">No reminders. {t.due_date ? 'Turn on “Remind me” in Details.' : 'Add a due date to get one.'}</p> : (
              <ul className="space-y-2 text-sm">{(rems as { id: string; kind: string; fire_at: Date; status: string; snooze_count: number; cancel_reason: string | null; quiet_deferred: boolean }[]).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>{fmtDateTime(r.fire_at, s.user.timezone, s.user.locale)} <span className="text-xs muted">· {humanize(r.kind)}{r.snooze_count ? ` · snoozed ${r.snooze_count}×` : ''}{r.quiet_deferred ? ' · moved out of quiet hours' : ''}</span></span>
                  <span className={r.status === 'scheduled' ? 'chip chip-blue' : r.status === 'delivered' ? 'chip chip-green' : 'chip'} title={r.cancel_reason ?? undefined}>{humanize(r.status)}</span>
                </li>
              ))}</ul>
            )}
          </Section>
          <Section title="Source & connections">
            {links.length === 0 ? <p className="text-sm muted">Created directly, not from a capture.</p> : (
              <ul className="space-y-2 text-sm">{links.map((l) => (
                <li key={l.linkId}><span className="chip mr-1.5">{humanize(l.relation)}</span><Link className="hover:underline" href={l.type === 'capture' ? `/app/inbox/${l.id}` : l.type === 'document' ? `/app/vault/${l.id}` : l.type === 'purchase' ? `/app/purchases/${l.id}` : l.type === 'task' ? `/app/tasks/${l.id}` : '#'}>{l.title ?? humanize(l.type)}</Link>
                  <span className="block text-xs muted">{l.provenance.source === 'confirmed_extraction' ? 'from a suggestion you confirmed' : l.provenance.source === 'user' ? 'linked by you' : 'linked automatically'}</span></li>
              ))}</ul>
            )}
          </Section>
          <Section title="History">
            <ol className="space-y-1.5 text-xs">{history.map((h, i) => <li key={i}><span className="font-semibold">{humanize(h.action.replace('status:', 'marked '))}</span> · {h.actor_name ?? 'System'} · {fmtDateTime(h.at, s.user.timezone)}{'note' in h.changes && h.changes.note ? <span className="block muted">“{String(h.changes.note)}”</span> : null}</li>)}</ol>
          </Section>
        </div>
      </div>
    </>
  );
}

import Link from 'next/link';
import { requireSession } from '@/server/session';
import { members, shoppingLists, familyActivity } from '@lifeos/core/family';
import { listTasks } from '@lifeos/core/tasks';
import { hasFeature } from '@lifeos/core/billing';
import { todayIn } from '@lifeos/core/time';
import { PageHeader, Empty, Section, PlanGate } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';
import { TaskList } from '@/components/tasks';
import { InviteForm, ShoppingList } from '@/components/family';
import { fmtDateTime, humanize } from '@/lib/format';

export const metadata = { title: 'Family' };

export default async function FamilyPage({ searchParams }: { searchParams: Promise<{ space?: string }> }) {
  const s = await requireSession();
  const families = s.spaces.filter((x) => x.kind === 'family');
  const wanted = (await searchParams).space;
  const fam = families.find((f) => f.workspaceId === wanted) ?? (s.active.kind === 'family' ? s.active : families[0]);
  const canCreate = await hasFeature(s.ctx.db, s.user.id, 'family');
  if (!fam) {
    return (
      <>
        <PageHeader title="FamilyOS" description="A shared space for household tasks, the family calendar, shopping lists and the documents you choose to share. Joining never exposes anyone’s personal records." />
        {canCreate ? (
          <Section title="Create a family space">
            <ApiForm path="/family" className="flex max-w-md gap-2" success="Family space created."><input name="name" required className="field" placeholder="e.g. Sharma home" aria-label="Family space name" /><button className="btn btn-primary">Create</button></ApiForm>
          </Section>
        ) : <PlanGate feature="Family spaces" plan="Family" />}
        <p className="mt-4 text-sm muted">Invited by someone? Open the invitation link they sent you.</p>
      </>
    );
  }
  const today = todayIn(s.user.timezone);
  const [team, lists, tasks, activity] = await Promise.all([members(s.ctx, fam.workspaceId), shoppingLists(s.ctx, fam.workspaceId), listTasks(s.ctx, { view: 'all', workspaceIds: [fam.workspaceId] }), familyActivity(s.ctx, fam.workspaceId, 30)]);
  const manager = team.role === 'owner' || team.role === 'adult';
  return (
    <>
      <PageHeader title={fam.name} description={`You are ${team.role === 'limited' ? 'a limited member — you see shopping lists and tasks assigned to you' : `the ${team.role}`} of this shared space.`}
        actions={<>{families.length > 1 && families.map((f) => <Link key={f.workspaceId} href={`/app/family?space=${f.workspaceId}`} className={`btn btn-sm ${f.workspaceId === fam.workspaceId ? 'btn-primary' : ''}`}>{f.name}</Link>)}{canCreate && <details className="relative"><summary className="btn btn-sm list-none">+ New space</summary><ApiForm path="/family" className="card absolute right-0 z-10 mt-1 flex gap-2 p-2"><input name="name" required className="field" placeholder="Name" aria-label="Name" /><button className="btn btn-sm btn-primary">Create</button></ApiForm></details>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        {team.role !== 'limited' && (
          <Section title="Shared tasks" action={<Link href={`/app/tasks?view=all`} className="text-sm text-[var(--color-blue)]">All tasks</Link>}>
            <ApiForm path="/tasks" className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" transform="remindIfDue" extra={{ workspaceId: fam.workspaceId, kind: 'family_task' }}>
              <input name="title" required className="field" placeholder="Add a household task" aria-label="Task" />
              <select name="assigneeId" className="field" aria-label="Assign to"><option value="">Unassigned</option>{team.people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select>
              <input name="dueDate" type="date" className="field" aria-label="Due" />
              <button className="btn">Add</button>
            </ApiForm>
            {tasks.length === 0 ? <Empty title="No shared tasks" /> : <TaskList tasks={tasks} today={today} />}
          </Section>
        )}
        <Section title="Shopping">
          {lists.length === 0 && <p className="mb-2 text-sm muted">No lists yet.</p>}
          {lists.map((l) => <ShoppingList key={l.id} list={l} />)}
          {team.role !== 'limited' && <ApiForm path="/shopping" className="mt-3 flex gap-2" extra={{ workspaceId: fam.workspaceId }}><input name="name" required className="field" placeholder="New list (e.g. Groceries)" aria-label="List name" /><button className="btn">Create</button></ApiForm>}
        </Section>
        <Section title="People">
          <ul className="space-y-2 text-sm">{team.people.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{p.display_name}</span>{p.email ? <span className="text-xs muted"> · {p.email}</span> : null}</span>
              <span className="flex items-center gap-1.5"><span className="chip">{humanize(p.role)}</span>
                {team.role === 'owner' && p.role !== 'owner' && <>
                  {(['adult', 'member', 'limited'] as const).filter((r) => r !== p.role).map((r) => <ApiButton key={r} path={`/family/${fam.workspaceId}/members/${p.user_id}`} method="PATCH" body={{ role: r }} className="btn btn-ghost btn-sm">→ {r}</ApiButton>)}
                  <ApiButton path={`/family/${fam.workspaceId}/members/${p.user_id}`} method="DELETE" className="btn btn-ghost btn-sm btn-danger" confirm={`Remove ${p.display_name}? They lose access to this space immediately.`}>Remove</ApiButton>
                </>}
                {p.user_id === s.user.id && p.role !== 'owner' && <ApiButton path={`/family/${fam.workspaceId}/members/${p.user_id}`} method="DELETE" className="btn btn-ghost btn-sm" confirm="Leave this family space?" redirectTo="/app">Leave</ApiButton>}
              </span>
            </li>
          ))}</ul>
          {manager && (
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <InviteForm workspaceId={fam.workspaceId} />
              {(team.invites as { id: string; email: string; role: string; expires_at: Date }[]).length > 0 && <ul className="mt-3 space-y-1 text-xs">{(team.invites as { id: string; email: string; role: string; expires_at: Date }[]).map((i) => <li key={i.id} className="flex items-center justify-between gap-2"><span>{i.email} · {i.role} · until {fmtDateTime(i.expires_at, s.user.timezone)}</span><ApiButton path={`/invites/${i.id}`} method="DELETE" className="btn btn-ghost btn-sm">Revoke</ApiButton></li>)}</ul>}
            </div>
          )}
          <div className="mt-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs muted">
            <p className="font-semibold text-[var(--ink-2)]">What members can see</p>
            <p className="mt-1">Owner and adults: everything in this space, and can invite and share. Members: everything in this space. Limited: shopping lists and tasks assigned to them. Nobody here can see anyone’s personal space, purchases, documents or searches unless that person shares a specific document.</p>
          </div>
          {team.role === 'owner' && <div className="mt-3"><ApiButton path={`/family/${fam.workspaceId}`} method="DELETE" className="btn btn-sm btn-danger" redirectTo="/app" confirm="Delete this family space and everything in it for everyone? Personal spaces are not affected.">Delete family space</ApiButton></div>}
        </Section>
        {activity.length > 0 && (
          <Section title="Recent activity">
            <ul className="space-y-1.5 text-xs">{activity.map((a, i) => <li key={i}>{fmtDateTime(a.at, s.user.timezone)} · <span className="font-medium">{a.actor ?? 'Someone'}</span> {humanize(a.action.replace('status:', 'marked ')).toLowerCase()} {a.title ? `“${a.title}”` : humanize(a.entity_type).toLowerCase()}</li>)}</ul>
          </Section>
        )}
      </div>
    </>
  );
}

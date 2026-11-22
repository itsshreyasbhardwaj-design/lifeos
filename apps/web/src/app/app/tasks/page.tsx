import Link from 'next/link';
import { requireSession } from '@/server/session';
import { listTasks, lists, type TaskView } from '@lifeos/core/tasks';
import { todayIn } from '@lifeos/core/time';
import { t as translate } from '@/i18n/messages';
import { Empty, PageHeader } from '@/components/ui';
import { QuickAdd, TaskList } from '@/components/tasks';
import { ApiForm } from '@/components/api';

export const metadata = { title: 'Tasks' };

const VIEWS: [TaskView, string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['waiting', 'Waiting'], ['no_date', 'No date'], ['assigned_to_me', 'Assigned to me'], ['completed', 'Completed'], ['all', 'All']];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; list?: string; tag?: string; q?: string; sort?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const view = (VIEWS.find(([v]) => v === sp.view)?.[0] ?? 'all') as TaskView;
  const [items, myLists] = await Promise.all([
    listTasks(s.ctx, { view, listId: sp.list, tag: sp.tag, search: sp.q, sort: sp.sort as never }),
    lists(s.ctx),
  ]);
  const today = todayIn(s.user.timezone);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ view, list: sp.list, tag: sp.tag, q: sp.q, sort: sp.sort, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/app/tasks?${p}`;
  };
  return (
    <>
      <PageHeader title="Tasks" description="Smart views are worked out from dates every time you look, so “overdue” is never stale." />
      <div className="mb-4"><QuickAdd today={today} placeholder={translate(s.user.locale)('task.quickAdd')} workspaceId={s.active.workspaceId} locale={s.user.locale} /></div>
      <nav aria-label="Views" className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {VIEWS.map(([v, l]) => <Link key={v} href={qs({ view: v })} aria-current={view === v ? 'page' : undefined} className={`btn btn-sm ${view === v ? 'btn-primary' : ''}`}>{l}</Link>)}
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action="/app/tasks" className="flex gap-2">
          <input type="hidden" name="view" value={view} />
          <label className="sr-only" htmlFor="tq">Filter tasks</label>
          <input id="tq" name="q" defaultValue={sp.q} placeholder="Filter…" className="field !w-48 !py-1.5" />
          <select name="sort" defaultValue={sp.sort ?? ''} className="field !w-auto !py-1.5" aria-label="Sort">
            <option value="">Sort: due date</option><option value="priority">Priority</option><option value="created">Newest</option><option value="title">Title</option>
          </select>
          <button className="btn btn-sm">Apply</button>
        </form>
        {myLists.map((l) => <Link key={l.id} href={qs({ list: sp.list === l.id ? undefined : l.id })} className={`chip ${sp.list === l.id ? 'chip-blue' : ''}`}>{l.name} · {l.open_count}</Link>)}
        {sp.tag && <Link href={qs({ tag: undefined })} className="chip chip-blue">#{sp.tag} ✕</Link>}
        <details className="relative">
          <summary className="btn btn-sm list-none">+ List</summary>
          <ApiForm path="/lists" className="card absolute z-10 mt-1 flex gap-2 p-2"><input name="name" required placeholder="List name" className="field !py-1.5" aria-label="List name" /><button className="btn btn-sm btn-primary">Create</button></ApiForm>
        </details>
      </div>
      <div className="card px-4 py-1">
        {items.length === 0 ? <div className="py-6"><Empty title="No tasks in this view">Add one above, or capture something and confirm it as a task.</Empty></div> : <TaskList tasks={items} today={today} bulk />}
      </div>
    </>
  );
}

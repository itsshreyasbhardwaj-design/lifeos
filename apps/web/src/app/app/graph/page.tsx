import Link from 'next/link';
import { requireSession } from '@/server/session';
import { graph } from '@lifeos/core/links';
import { hasFeature } from '@lifeos/core/billing';
import { PageHeader, PlanGate, Empty } from '@/components/ui';
import { humanize } from '@/lib/format';

export const metadata = { title: 'LifeGraph' };

const HREF: Record<string, (id: string) => string> = { task: (id) => `/app/tasks/${id}`, capture: (id) => `/app/inbox/${id}`, document: (id) => `/app/vault/${id}`, purchase: (id) => `/app/purchases/${id}`, admin_workflow: (id) => `/app/admin/${id}`, life_event: (id) => `/app/events/${id}` };

export default async function GraphPage() {
  const s = await requireSession();
  if (!(await hasFeature(s.ctx.db, s.user.id, 'lifegraph'))) return (<><PageHeader title="LifeGraph" /><PlanGate feature="The LifeGraph explorer" /><p className="mt-3 text-sm muted">Each record still shows its own source and connections on its page.</p></>);
  const edges = await graph(s.ctx.db, s.user.id, s.active.workspaceId);
  const nodes = new Map<string, { type: string; id: string; title: string }>();
  for (const e of edges) {
    nodes.set(`${e.from_type}:${e.from_id}`, { type: e.from_type, id: e.from_id, title: e.from_title ?? humanize(e.from_type) });
    nodes.set(`${e.to_type}:${e.to_id}`, { type: e.to_type, id: e.to_id, title: e.to_title ?? humanize(e.to_type) });
  }
  const list = [...nodes.values()].slice(0, 60);
  const pos = new Map(list.map((n, i) => {
    const a = (i / list.length) * Math.PI * 2;
    const r = 40 + (i % 3) * 6;
    return [`${n.type}:${n.id}`, { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) * 0.8 }];
  }));
  const color: Record<string, string> = { capture: '#8b5cf6', task: '#10b981', document: '#3b82f6', purchase: '#f59e0b', warranty: '#e11d48', return_window: '#e11d48' };
  return (
    <>
      <PageHeader title="LifeGraph" description={`How your records connect in ${s.active.name}: where each one came from and what it relates to. Every link records whether you made it, confirmed it from a capture, or the system added it.`} />
      {edges.length === 0 ? <Empty title="No connections yet">Confirming a suggestion links the new record to its source capture.</Empty> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="card p-2">
            <svg viewBox="0 0 100 100" role="img" aria-label="Graph of connected records" className="h-[28rem] w-full">
              {edges.filter((e) => pos.has(`${e.from_type}:${e.from_id}`) && pos.has(`${e.to_type}:${e.to_id}`)).map((e) => { const a = pos.get(`${e.from_type}:${e.from_id}`)!; const b = pos.get(`${e.to_type}:${e.to_id}`)!; return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line)" strokeWidth="0.3" />; })}
              {list.map((n) => { const p = pos.get(`${n.type}:${n.id}`)!; return (
                <a key={`${n.type}:${n.id}`} href={HREF[n.type]?.(n.id) ?? '#'}>
                  <circle cx={p.x} cy={p.y} r="1.6" fill={color[n.type] ?? '#64748b'}><title>{`${humanize(n.type)}: ${n.title}`}</title></circle>
                  <text x={p.x + 2} y={p.y + 0.8} fontSize="1.8" fill="currentColor">{n.title.slice(0, 22)}</text>
                </a>
              ); })}
            </svg>
          </div>
          <ul className="card max-h-[30rem] divide-y divide-[var(--line)] overflow-y-auto">
            {edges.map((e) => (
              <li key={e.id} className="px-4 py-2 text-sm">
                <Link href={HREF[e.from_type]?.(e.from_id) ?? '#'} className="font-medium hover:underline">{e.from_title ?? humanize(e.from_type)}</Link>
                <span className="mx-1.5 chip">{humanize(e.relation)}</span>
                <Link href={HREF[e.to_type]?.(e.to_id) ?? '#'} className="hover:underline">{e.to_title ?? humanize(e.to_type)}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

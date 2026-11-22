'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell, BookOpen, Bot, CalendarDays, CalendarHeart, CreditCard, FileText, Handshake, Home, Inbox, LogOut, Menu, Network, Plus, Receipt, Repeat, Search,
  Settings, Shield, ShoppingBag, Sparkles, SquareCheckBig, Users, WifiOff, X, Landmark, Newspaper,
} from 'lucide-react';
import { CaptureDialog } from './capture';
import { api, ToastProvider, useToast } from './api';
import { flush } from '@/lib/offline';
import type { MessageKey } from '@/i18n/messages';

export interface ShellProps {
  children: ReactNode;
  userName: string;
  plan: string;
  spaces: { workspaceId: string; name: string; kind: string; role: string }[];
  activeId: string;
  tr: Record<MessageKey, string>;
}

const NAV: { group: MessageKey; items: { href: string; key: MessageKey; icon: typeof Home }[] }[] = [
  { group: 'nav.group.primary', items: [
    { href: '/app', key: 'nav.today', icon: Home }, { href: '/app/inbox', key: 'nav.inbox', icon: Inbox }, { href: '/app/calendar', key: 'nav.calendar', icon: CalendarDays }, { href: '/app/search', key: 'nav.search', icon: Search },
  ] },
  { group: 'nav.group.organize', items: [
    { href: '/app/tasks', key: 'nav.tasks', icon: SquareCheckBig }, { href: '/app/promises', key: 'nav.promises', icon: Handshake }, { href: '/app/events', key: 'nav.events', icon: CalendarHeart },
    { href: '/app/admin', key: 'nav.admin', icon: Landmark }, { href: '/app/vault', key: 'nav.vault', icon: FileText }, { href: '/app/purchases', key: 'nav.purchases', icon: ShoppingBag },
    { href: '/app/subscriptions', key: 'nav.subscriptions', icon: Repeat }, { href: '/app/bills', key: 'nav.bills', icon: Receipt }, { href: '/app/routines', key: 'nav.routines', icon: BookOpen },
  ] },
  { group: 'nav.group.shared', items: [{ href: '/app/family', key: 'nav.family', icon: Users }] },
  { group: 'nav.group.intelligence', items: [
    { href: '/app/ai', key: 'nav.ai', icon: Bot }, { href: '/app/graph', key: 'nav.graph', icon: Network }, { href: '/app/briefings', key: 'nav.briefings', icon: Newspaper },
  ] },
  { group: 'nav.group.account', items: [
    { href: '/app/settings', key: 'nav.settings', icon: Settings }, { href: '/app/privacy', key: 'nav.privacy', icon: Shield }, { href: '/app/billing', key: 'nav.billing', icon: CreditCard },
  ] },
];

function isActive(path: string, href: string) {
  return href === '/app' ? path === '/app' : path === href || path.startsWith(`${href}/`);
}

export function Shell(props: ShellProps) {
  return (
    <ToastProvider>
      <ShellInner {...props} />
    </ToastProvider>
  );
}

function ShellInner({ children, userName, plan, spaces, activeId, tr }: ShellProps) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [capture, setCapture] = useState(false);
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [online, setOnline] = useState(true);
  const [unread, setUnread] = useState(0);
  const [notes, setNotes] = useState<{ id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; reminder_id: string | null }[]>([]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      flush().then((r) => r.sent && toast(`Synced ${r.sent} item${r.sent === 1 ? '' : 's'} saved offline.`));
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    flush().catch(() => undefined);
    const sync = () => router.refresh();
    window.addEventListener('lifeos:synced', sync);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('lifeos:synced', sync);
    };
  }, [router, toast]);

  useEffect(() => {
    let stop = false;
    const load = () => api<{ items: typeof notes; unread: number }>('/notifications').then((r) => !stop && (setNotes(r.items), setUnread(r.unread))).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setCapture(true);
      }
      if (e.key === '/' && !e.metaKey) {
        e.preventDefault();
        router.push('/app/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('capture') === '1') setCapture(true);
  }, []);

  const active = spaces.find((s) => s.workspaceId === activeId);

  const nav = (
    <nav aria-label="Main" className="space-y-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="mb-1.5 px-3 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400">{tr[g.group]}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} aria-current={isActive(path, it.href) ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive(path, it.href) ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
                  <it.icon size={17} aria-hidden /> {tr[it.key]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh md:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[80] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto bg-[var(--color-navy)] px-3 py-5 md:flex">
        <Link href="/app" className="mb-5 flex items-center gap-2 px-3 text-white">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-blue)] font-black">L</span>
          <span className="text-lg font-bold tracking-tight">LifeOS</span>
        </Link>
        <button className="btn btn-blue mx-1 mb-5 justify-center py-2.5 text-base" onClick={() => setCapture(true)}>
          <Plus size={18} aria-hidden /> {tr['capture.button']}
          <kbd className="ml-auto rounded bg-white/20 px-1.5 text-xs font-semibold">C</kbd>
        </button>
        {nav}
        <div className="mt-auto px-3 pt-6 text-xs text-slate-400">
          <p className="truncate">{userName}</p>
          <p className="mt-0.5">LifeOS {plan}</p>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)]/85 px-4 py-2.5 backdrop-blur md:px-8">
        <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
        <Link href="/app" className="font-bold md:hidden">LifeOS</Link>
        {spaces.length > 1 && (
          <label className="ml-1 flex items-center gap-2 text-sm">
            <span className="sr-only">{tr['common.space']}</span>
            <select className="field !w-auto !py-1.5 text-sm" value={activeId} onChange={async (e) => {
              await api('/me/workspace', { body: { workspaceId: e.target.value } });
              router.refresh();
            }}>
              {spaces.map((s) => <option key={s.workspaceId} value={s.workspaceId}>{s.kind === 'family' ? '👪 ' : ''}{s.name}</option>)}
            </select>
          </label>
        )}
        {active?.kind === 'family' && <span className="chip chip-violet hidden sm:inline-flex">Shared space</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {!online && <span className="chip chip-amber" role="status"><WifiOff size={13} aria-hidden /> {tr['common.offline']}</span>}
          <Link href="/app/search" className="btn btn-ghost btn-sm" aria-label={tr['nav.search']}><Search size={18} /></Link>
          <div className="relative">
            <button className="btn btn-ghost btn-sm relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={bell} onClick={() => setBell((b) => !b)}>
              <Bell size={18} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{unread}</span>}
            </button>
            {bell && (
              <div className="card absolute right-0 top-10 z-50 w-[min(380px,calc(100vw-2rem))] p-2 shadow-xl">
                <div className="flex items-center justify-between px-2 py-1">
                  <p className="text-sm font-semibold">Notifications</p>
                  {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={async () => { await api('/notifications/read', { body: { ids: 'all' } }); setUnread(0); setNotes((n) => n.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() }))); }}>Mark all read</button>}
                </div>
                <ul className="max-h-96 overflow-y-auto">
                  {notes.length === 0 && <li className="px-2 py-4 text-center text-sm muted">No notifications yet. Reminders you set appear here.</li>}
                  {notes.map((n) => (
                    <li key={n.id} className={`rounded-lg px-2 py-2 ${n.read_at ? '' : 'bg-[var(--color-blue-soft)]/50'}`}>
                      <button className="block w-full text-left" onClick={async () => { await api('/notifications/read', { body: { ids: [n.id] } }).catch(() => undefined); setBell(false); if (n.link) router.push(n.link); }}>
                        <p className="text-sm font-semibold">{n.title}</p>
                        {n.body && <p className="text-xs muted">{n.body}</p>}
                        <p className="text-[11px] muted">{new Date(n.created_at).toLocaleString()}</p>
                      </button>
                      {n.reminder_id && (
                        <div className="mt-1 flex gap-1">
                          {[{ l: '1 hour', m: 60 }, { l: 'Tomorrow', m: 24 * 60 }].map((s) => (
                            <button key={s.l} className="btn btn-sm" onClick={async () => { try { await api(`/reminders/${n.reminder_id}/snooze`, { body: { minutes: s.m } }); toast(`Snoozed for ${s.l.toLowerCase()}`); } catch (e) { toast((e as Error).message, 'error'); } }}>Snooze {s.l.toLowerCase()}</button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" aria-label={tr['common.signOut']} title={tr['common.signOut']} onClick={async () => { await api('/auth/logout', { body: {} }); router.push('/login'); }}><LogOut size={18} /></button>
        </div>
      </header>

      {menu && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-[var(--color-navy)] px-3 py-4">
            <button className="btn btn-ghost btn-sm mb-3 text-white" onClick={() => setMenu(false)} aria-label="Close menu"><X size={20} /></button>
            {nav}
          </div>
        </div>
      )}

      <main id="main" className="mx-auto min-w-0 max-w-6xl overflow-x-clip px-4 pb-28 pt-6 md:px-8 md:pb-12">{children}</main>

      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {[{ href: '/app', icon: Home, key: 'nav.today' as const }, { href: '/app/inbox', icon: Inbox, key: 'nav.inbox' as const }].map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(path, i.href) ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive(path, i.href) ? 'text-[var(--color-blue)]' : 'muted'}`}><i.icon size={20} aria-hidden />{tr[i.key]}</Link>
        ))}
        <button onClick={() => setCapture(true)} className="flex flex-col items-center py-1" aria-label={tr['capture.button']}>
          <span className="-mt-5 grid size-12 place-items-center rounded-2xl bg-[var(--color-blue)] text-white shadow-lg"><Plus size={24} /></span>
          <span className="text-[11px] font-semibold">{tr['capture.button']}</span>
        </button>
        {[{ href: '/app/calendar', icon: CalendarDays, key: 'nav.calendar' as const }, { href: '/app/tasks', icon: Sparkles, key: 'nav.tasks' as const }].map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(path, i.href) ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive(path, i.href) ? 'text-[var(--color-blue)]' : 'muted'}`}><i.icon size={20} aria-hidden />{tr[i.key]}</Link>
        ))}
      </nav>

      <CaptureDialog open={capture} onClose={() => setCapture(false)} spaces={spaces} activeId={activeId} tr={tr} />
    </div>
  );
}

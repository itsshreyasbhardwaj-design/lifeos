import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm font-medium text-[var(--muted)] hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="h1">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 md:p-5 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="h2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs muted">{hint}</p>}
    </div>
  );
}

export function PlanGate({ feature, plan = 'Plus' }: { feature: string; plan?: string }) {
  return (
    <div className="card p-6 text-center">
      <p className="chip chip-violet mx-auto">LifeOS {plan}</p>
      <h2 className="h2 mt-3">{feature} is part of LifeOS {plan}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm muted">Everything you already saved stays readable. Start a free 14-day trial — no card needed — or compare plans.</p>
      <Link href="/app/billing" className="btn btn-primary mt-4">
        See plans
      </Link>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide muted">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs muted">{hint}</p>}
    </div>
  );
}

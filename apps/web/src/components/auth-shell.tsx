import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-bold"><span className="grid size-8 place-items-center rounded-lg bg-[var(--color-navy)] text-white">L</span> LifeOS</Link>
        <div className="card p-6">
          <h1 className="h1 text-center !text-xl">{title}</h1>
          <p className="mb-6 mt-1 text-center text-sm muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  );
}

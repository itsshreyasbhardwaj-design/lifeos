import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Demo } from '@/components/demo';
import { DIFFERENTIATORS, FAQ } from '@/content/marketing';

export const metadata = { alternates: { canonical: '/' } };

const FLOW = ['Capture', 'Understand', 'Confirm', 'Connect', 'Remind', 'Follow through', 'Complete', 'Preserve'];

export default function Home() {
  const ld = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'LifeOS', applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Android, iOS (browser)', offers: [{ '@type': 'Offer', price: '0', priceCurrency: 'INR', name: 'Free' }, { '@type': 'Offer', price: '149', priceCurrency: 'INR', name: 'Plus (monthly)' }, { '@type': 'Offer', price: '299', priceCurrency: 'INR', name: 'Family (monthly)' }] };
  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 md:pt-24">
        <p className="chip chip-violet">Made in India · private by design</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">Never forget what matters.</h1>
        <p className="mt-5 max-w-2xl text-lg muted">Turn screenshots, documents, notes, and everyday commitments into organized actions, useful reminders, and information you can find whenever you need it.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="btn btn-primary px-5 py-3 text-base">Start Free <ArrowRight size={18} /></Link>
          <Link href="#demo" className="btn px-5 py-3 text-base">See How LifeOS Works</Link>
        </div>
        <p className="mt-4 text-sm muted">Tasks, reminders, calendar, capture and search are free. No card needed.</p>
        <ol className="mt-12 flex flex-wrap gap-2 text-sm" aria-label="How information becomes action">
          {FLOW.map((f, i) => <li key={f} className="flex items-center gap-2"><span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 font-medium">{f}</span>{i < FLOW.length - 1 && <span className="muted" aria-hidden>→</span>}</li>)}
        </ol>
      </section>

      <section id="demo" className="mx-auto max-w-6xl scroll-mt-20 px-4">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Try it: a message becomes actions you control</h2>
        <p className="mb-5 mt-2 max-w-2xl muted">This is the real LifeOS reading engine running in your browser. Notice what it does when the source is unclear — it asks instead of guessing.</p>
        <Demo />
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Built for the gap between information and action</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DIFFERENTIATORS.map((d) => <div key={d.title} className="card p-5"><p className="font-semibold">{d.title}</p><p className="mt-1 text-sm muted">{d.body}</p></div>)}
          <Link href="/features" className="card flex items-center justify-center p-5 font-semibold text-[var(--color-blue)] hover:border-[var(--color-blue)]">All features <ArrowRight size={16} className="ml-1" /></Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20">
        <div className="card grid gap-6 p-8 md:grid-cols-[auto_1fr]">
          <ShieldCheck size={40} className="text-[var(--color-emerald)]" aria-hidden />
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Trust is the feature</h2>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <li>✓ Nothing becomes a task until you confirm it</li><li>✓ Every suggestion shows the text it came from</li>
              <li>✓ Documents read on our server — no external AI</li><li>✓ Files encrypted at rest</li>
              <li>✓ Family members see only what you share</li><li>✓ Export everything, delete everything</li>
            </ul>
            <Link href="/privacy-security" className="mt-4 inline-block text-sm font-semibold text-[var(--color-blue)]">How we protect your data →</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-20">
        <h2 className="text-2xl font-bold tracking-tight">Questions</h2>
        <div className="mt-4 divide-y divide-[var(--line)]">{FAQ.slice(0, 5).map((f) => <details key={f.q} className="py-3"><summary className="cursor-pointer font-medium">{f.q}</summary><p className="mt-2 text-sm muted">{f.a}</p></details>)}</div>
        <Link href="/faq" className="mt-3 inline-block text-sm font-semibold text-[var(--color-blue)]">All questions →</Link>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Start with one thing you don’t want to forget.</h2>
        <Link href="/signup" className="btn btn-primary mt-6 px-6 py-3 text-base">Start Free</Link>
      </section>
    </main>
  );
}

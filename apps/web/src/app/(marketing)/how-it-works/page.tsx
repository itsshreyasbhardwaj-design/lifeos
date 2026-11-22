import Link from 'next/link';

export const metadata = { title: 'How it works', description: 'Capture → understand → confirm → connect → remind → follow through → complete → preserve.', alternates: { canonical: '/how-it-works' } };

const STEPS = [
  ['Capture', 'Share a screenshot, upload a receipt or PDF, paste a message, save a link or a voice note. The original is stored first.'],
  ['Understand', 'LifeOS reads text from documents and images on its own server and finds dates, times, amounts, references, people and organisations.'],
  ['Confirm', 'You see suggestions next to the text they came from. Unclear dates, missing years and guessed names are flagged for you to settle.'],
  ['Connect', 'Each confirmed record is linked to its source and to related records — a warranty to its purchase, a follow-up to its promise.'],
  ['Remind', 'Reminders are scheduled at your time in your timezone, delivered once, and quiet during quiet hours.'],
  ['Follow through', 'Waiting on someone? Refund pending? LifeOS suggests the next step and waits for your approval.'],
  ['Complete', 'Mark it done, add a note or attach the proof. Repeating tasks roll forward exactly once.'],
  ['Preserve', 'Months later, ask “where is my laptop invoice?” and open the original.'],
];

export default function HowItWorks() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-16">
      <h1 className="text-4xl font-bold tracking-tight md:text-5xl">From information to done</h1>
      <ol className="mt-10 space-y-4">{STEPS.map(([t, b], i) => <li key={t} className="card flex gap-4 p-5"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-navy)] font-bold text-white">{i + 1}</span><div><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm muted">{b}</p></div></li>)}</ol>
      <div className="mt-10 flex gap-3"><Link href="/#demo" className="btn btn-primary">Try the demo</Link><Link href="/signup" className="btn">Start Free</Link></div>
    </main>
  );
}

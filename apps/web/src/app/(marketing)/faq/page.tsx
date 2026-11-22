import { FAQ } from '@/content/marketing';

export const metadata = { title: 'FAQ', description: 'Answers about how LifeOS reads your captures, reminders, privacy, family sharing and pricing.', alternates: { canonical: '/faq' } };

export default function Faq() {
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  return (
    <main className="mx-auto max-w-3xl px-4 pt-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <h1 className="text-4xl font-bold tracking-tight">Frequently asked questions</h1>
      <div className="mt-8 divide-y divide-[var(--line)]">{FAQ.map((f) => <details key={f.q} className="py-4"><summary className="cursor-pointer text-lg font-medium">{f.q}</summary><p className="mt-2 muted">{f.a}</p></details>)}</div>
    </main>
  );
}

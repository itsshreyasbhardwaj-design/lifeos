import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FEATURE_PAGES } from '@/content/marketing';

export function generateStaticParams() {
  return FEATURE_PAGES.map((f) => ({ slug: f.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = FEATURE_PAGES.find((x) => x.slug === slug);
  return f ? { title: f.nav, description: f.description, alternates: { canonical: `/${f.slug}` }, openGraph: { title: `${f.nav} · LifeOS`, description: f.description } } : {};
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = FEATURE_PAGES.find((x) => x.slug === slug);
  if (!f) notFound();
  return (
    <main className="mx-auto max-w-5xl px-4 pt-16">
      <p className="chip chip-blue">{f.kicker}</p>
      <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">{f.title}</h1>
      <p className="mt-4 max-w-2xl text-lg muted">{f.description}</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">{f.points.map((p) => <div key={p.title} className="card p-5"><h2 className="font-semibold">{p.title}</h2><p className="mt-1 text-sm muted">{p.body}</p></div>)}</div>
      <p className="mt-6 rounded-xl bg-[var(--surface-2)] p-4 text-sm"><span className="font-semibold">Good to know: </span>{f.honest}</p>
      <div className="mt-10 flex gap-3"><Link href="/signup" className="btn btn-primary">Start Free</Link><Link href="/#demo" className="btn">Try the demo</Link></div>
      <nav className="mt-14 flex flex-wrap gap-2 text-sm" aria-label="Other features">{FEATURE_PAGES.filter((x) => x.slug !== f.slug).map((x) => <Link key={x.slug} href={`/${x.slug}`} className="chip">{x.nav}</Link>)}</nav>
    </main>
  );
}

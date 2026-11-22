import Link from 'next/link';
import { FEATURE_PAGES } from '@/content/marketing';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold"><span className="grid size-8 place-items-center rounded-lg bg-[var(--color-navy)] text-white">L</span> LifeOS</Link>
          <nav aria-label="Site" className="hidden items-center gap-5 text-sm font-medium md:flex">
            <Link href="/features" className="hover:text-[var(--color-blue)]">Features</Link>
            <Link href="/how-it-works" className="hover:text-[var(--color-blue)]">How it works</Link>
            <Link href="/privacy-security" className="hover:text-[var(--color-blue)]">Privacy</Link>
            <Link href="/pricing" className="hover:text-[var(--color-blue)]">Pricing</Link>
            <Link href="/faq" className="hover:text-[var(--color-blue)]">FAQ</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
            <Link href="/signup" className="btn btn-primary btn-sm">Start free</Link>
          </div>
        </div>
      </header>
      <div id="content">{children}</div>
      <footer className="mt-24 border-t border-[var(--line)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-4">
          <div><p className="font-bold">LifeOS</p><p className="mt-1 muted">Never forget what matters.</p></div>
          <div><p className="mb-2 font-semibold">Product</p><ul className="space-y-1.5 muted">{FEATURE_PAGES.map((f) => <li key={f.slug}><Link href={`/${f.slug}`} className="hover:underline">{f.nav}</Link></li>)}</ul></div>
          <div><p className="mb-2 font-semibold">Company</p><ul className="space-y-1.5 muted"><li><Link href="/about" className="hover:underline">About</Link></li><li><Link href="/contact" className="hover:underline">Contact</Link></li><li><Link href="/pricing" className="hover:underline">Pricing</Link></li><li><Link href="/faq" className="hover:underline">FAQ</Link></li></ul></div>
          <div><p className="mb-2 font-semibold">Trust</p><ul className="space-y-1.5 muted"><li><Link href="/privacy-security" className="hover:underline">Privacy &amp; security</Link></li><li><Link href="/privacy-policy" className="hover:underline">Privacy policy</Link></li><li><Link href="/terms" className="hover:underline">Terms</Link></li></ul></div>
        </div>
      </footer>
    </div>
  );
}

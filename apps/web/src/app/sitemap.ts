import type { MetadataRoute } from 'next';
import { FEATURE_PAGES } from '@/content/marketing';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.LIFEOS_PUBLIC_URL ?? 'http://localhost:3200';
  const paths = ['', '/features', '/how-it-works', '/privacy-security', '/pricing', '/faq', '/about', '/contact', '/privacy-policy', '/terms', '/signup', '/login', ...FEATURE_PAGES.map((f) => `/${f.slug}`)];
  return paths.map((p) => ({ url: `${base}${p}`, changeFrequency: 'monthly', priority: p === '' ? 1 : 0.6 }));
}

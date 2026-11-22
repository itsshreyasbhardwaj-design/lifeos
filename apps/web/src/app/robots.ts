import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.LIFEOS_PUBLIC_URL ?? 'http://localhost:3200';
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/app', '/api', '/onboarding', '/invite', '/share', '/offline'] }], sitemap: `${base}/sitemap.xml` };
}

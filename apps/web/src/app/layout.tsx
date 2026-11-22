import type { Metadata, Viewport } from 'next';
import './globals.css';

const site = process.env.LIFEOS_PUBLIC_URL ?? 'http://localhost:3200';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: 'LifeOS — Never Forget What Matters', template: '%s · LifeOS' },
  description: 'Turn screenshots, documents, notes and everyday commitments into organised actions, useful reminders, and information you can find whenever you need it.',
  applicationName: 'LifeOS',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  openGraph: { type: 'website', siteName: 'LifeOS', title: 'LifeOS — Never Forget What Matters', description: 'Capture anything important. Confirm what it means. Get reminded. Get it done.' },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, title: 'LifeOS', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#0b1220', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

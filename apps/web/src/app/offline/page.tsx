import { OfflineDrafts } from '@/components/offline-drafts';

export const metadata = { title: 'Offline', robots: { index: false } };

export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="h1">You’re offline</h1>
      <p className="mt-2 text-sm muted">Your records aren’t stored on this device, so they can’t be shown right now. You can still jot something down — it’s kept on this device and sent to your Inbox when you reconnect.</p>
      <OfflineDrafts />
    </main>
  );
}

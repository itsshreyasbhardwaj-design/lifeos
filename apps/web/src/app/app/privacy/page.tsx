import { requireSession } from '@/server/session';
import { consents } from '@lifeos/core/privacy';
import { PageHeader, Section } from '@/components/ui';
import { ApiButton, ApiForm } from '@/components/api';

export const metadata = { title: 'Privacy' };

const LABELS: Record<string, [string, string]> = {
  product_analytics: ['Product analytics', 'Counts like “a capture was confirmed”. Never content, titles, file names or text. Stored under a one-way pseudonym.'],
  external_ai_processing: ['External AI processing', 'Not used in this version — everything is read on this server. If an external AI option is added, it stays off until you turn it on here.'],
  email_notifications: ['Email notifications', 'Not available in this version.'],
  push_notifications: ['Push notifications', 'Turned on when you enable push on a device in Settings.'],
};

export default async function PrivacyPage() {
  const s = await requireSession();
  const c = await consents(s.ctx.db, s.user.id);
  return (
    <>
      <PageHeader title="Privacy & your data" description="Your records are yours. Optional processing is off until you turn it on, and you can take everything with you or delete it." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="What is processed, and where">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Text, PDFs and images are read on the LifeOS server (local OCR). Nothing is sent to an external AI service.</li>
            <li>Files are encrypted at rest with a per-file key.</li>
            <li>Family members only see what is in a family space or what you share with them.</li>
            <li>Links you capture are fetched once from the server to read the page title and text.</li>
            <li>LifeOS does not sell data, show ads or profile children.</li>
          </ul>
        </Section>
        <Section title="Permissions you control">
          <ul className="space-y-3">{Object.entries(LABELS).map(([k, [label, help]]) => (
            <li key={k} className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-medium">{label}</p><p className="text-xs muted">{help}</p></div>
              {k === 'product_analytics' ? <ApiButton path="/privacy/consents" method="PUT" body={{ purpose: k, granted: !c[k as keyof typeof c] }} className={`btn btn-sm ${c[k as keyof typeof c] ? 'btn-primary' : ''}`}>{c[k as keyof typeof c] ? 'On' : 'Off'}</ApiButton> : <span className="chip">{c[k as keyof typeof c] ? 'On' : 'Off'}</span>}
            </li>
          ))}</ul>
        </Section>
        <Section title="Export everything">
          <p className="mb-3 text-sm muted">A .zip with every record you created (JSON) and your original files, decrypted.</p>
          <a href="/api/v1/privacy/export" className="btn btn-primary">Download my data</a>
        </Section>
        <Section title="Delete my account">
          <p className="mb-3 text-sm muted">Deletes your personal space, every record and file in it, and removes you from family spaces. Family records you created stay for the family with your name removed. This cannot be undone.</p>
          <ApiForm path="/privacy/delete" redirectTo="/" className="space-y-2">
            <input name="email" type="email" required className="field" placeholder={`Type ${s.user.email} to confirm`} aria-label="Confirm email" />
            <input name="password" type="password" required className="field" placeholder="Password" aria-label="Password" autoComplete="current-password" />
            <button className="btn btn-sm btn-danger">Delete account permanently</button>
          </ApiForm>
        </Section>
      </div>
    </>
  );
}

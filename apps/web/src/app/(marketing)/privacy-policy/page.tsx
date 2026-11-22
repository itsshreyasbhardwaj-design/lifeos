export const metadata = { title: 'Privacy policy', alternates: { canonical: '/privacy-policy' } };

export default function PrivacyPolicy() {
  return (
    <main className="prose mx-auto max-w-3xl px-4 pt-16">
      <p className="warn">Draft for review — this policy describes how the software behaves. It has not been reviewed by a lawyer and must be before any public launch (including review against India’s Digital Personal Data Protection Act, 2023).</p>
      <h1 className="mt-6 text-3xl font-bold">Privacy policy</h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">What we store</h2>
        <p>Your account (name, email, hashed password, language, timezone), what you capture (text, links, files), the records you confirm, reminders and their delivery status, and a security log of sign-ins and sensitive actions.</p>
        <h2 className="text-lg font-semibold">How it is processed</h2>
        <p>Files are read on the LifeOS server to find text (PDF text extraction and local OCR). No content is sent to external AI services. Links you capture are fetched once to read the page. Push notifications go through your browser vendor’s push service, encrypted so the service cannot read them.</p>
        <h2 className="text-lg font-semibold">Sharing</h2>
        <p>Nothing is shared unless you put it in a family space or share a specific document. We do not sell personal data or show advertising.</p>
        <h2 className="text-lg font-semibold">Optional analytics</h2>
        <p>Off by default. If you turn it on, we record event counts (for example, “a capture was confirmed”) under a pseudonym, never content.</p>
        <h2 className="text-lg font-semibold">Your rights</h2>
        <p>Export all your data from Privacy settings. Delete your account there; deletion is immediate and removes your files. Security log entries are kept with your identity removed.</p>
        <h2 className="text-lg font-semibold">Children</h2>
        <p>Accounts for minors must be set up with a parent or guardian. LifeOS does not profile, track or advertise to children.</p>
      </div>
    </main>
  );
}

export const metadata = { title: 'Privacy & security', description: 'How LifeOS protects personal information.', alternates: { canonical: '/privacy-security' } };

const ITEMS = [
  ['You confirm everything', 'Suggestions never become records on their own. The database itself refuses an accepted suggestion without a recorded review.'],
  ['Local reading, no external AI', 'PDF text and image OCR run on the LifeOS server. Answers come from rules over your records. Nothing is sent to an AI provider.'],
  ['Encrypted files', 'Every uploaded file is encrypted at rest with its own key, wrapped by a server key. Files are only served after an access check, and every view or download of a vault document is logged.'],
  ['Private by default, shared on purpose', 'Family spaces contain only what is put in them. Documents are shared one at a time, with optional expiry and download control, and can be revoked instantly.'],
  ['Strong sign-in', 'Argon2id password hashing, sessions you can see and revoke, optional two-step verification (TOTP), rate-limited sign-in.'],
  ['Safe link capture', 'Captured links are fetched with protection against reaching private networks.'],
  ['Analytics without content', 'Off unless you turn it on. When on, only event counts are recorded under a pseudonym — never text, titles or file names.'],
  ['Your data, your choice', 'Export everything as a .zip. Delete your account and its files permanently.'],
  ['Children', 'No behavioural profiling, advertising or covert monitoring. A limited role exists for children and helpers.'],
];

export default function PrivacySecurity() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-16">
      <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Privacy and security</h1>
      <p className="mt-4 max-w-2xl text-lg muted">LifeOS holds the things people don’t want to lose — and don’t want exposed. These are the rules the product is built on.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ITEMS.map(([t, b]) => <div key={t} className="card p-5"><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm muted">{b}</p></div>)}</div>
      <p className="mt-8 text-sm muted">Found a security issue? Please report it privately — see SECURITY.md in the source repository.</p>
    </main>
  );
}

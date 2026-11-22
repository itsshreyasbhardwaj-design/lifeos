export const metadata = { title: 'Terms', alternates: { canonical: '/terms' } };

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-16">
      <p className="warn">Draft for review — not legal advice and not yet reviewed by a lawyer.</p>
      <h1 className="mt-6 text-3xl font-bold">Terms of use</h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed">
        <p>LifeOS helps you organise information you provide. Suggestions are produced automatically and can be wrong; you are responsible for checking them before confirming. Reminders are delivered on a best-effort basis and depend on your device and browser.</p>
        <p>LifeOS does not submit forms, make payments, cancel services or contact anyone on your behalf. Storing a document in LifeOS does not make it an official or verified record.</p>
        <p>Paid plans renew at the stated interval until cancelled. Cancelling keeps your data; premium features become read-only. Free trials end automatically.</p>
        <p>Don’t use LifeOS to store data you don’t have the right to store, or to monitor another person without their knowledge.</p>
      </div>
    </main>
  );
}

export const metadata = { title: 'Contact', alternates: { canonical: '/contact' } };

export default function Contact() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-16">
      <h1 className="text-4xl font-bold tracking-tight">Contact</h1>
      <p className="mt-4 text-lg muted">Signed-in users can send feedback from Settings → Feedback; it reaches the team with no document contents attached.</p>
      <p className="mt-3 muted">For security reports, follow the process in SECURITY.md in the source repository. A public support address will be listed here before launch.</p>
    </main>
  );
}

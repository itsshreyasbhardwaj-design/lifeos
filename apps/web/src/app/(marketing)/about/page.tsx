export const metadata = { title: 'About', alternates: { canonical: '/about' } };

export default function About() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-16">
      <h1 className="text-4xl font-bold tracking-tight">Why LifeOS exists</h1>
      <div className="mt-6 space-y-4 text-lg muted">
        <p>Important things arrive everywhere — a school message, a delivery email, a screenshot of a deadline, an invoice in a drawer. Most productivity apps start once you’ve already typed a task. The hard part is the step before: noticing what something means and making sure it doesn’t slip.</p>
        <p>LifeOS is built around that step. It reads what you capture, suggests what it means, and asks you to confirm — because a wrong date in a reminder is worse than no reminder. Then it keeps the action connected to where it came from, so months later you can still find the receipt.</p>
        <p>It is being built in India first: Indian date formats, rupees and lakh grouping, Hindi and Bengali interfaces, and phones that aren’t flagships. We are early. We don’t publish user numbers or testimonials we don’t have.</p>
      </div>
    </main>
  );
}

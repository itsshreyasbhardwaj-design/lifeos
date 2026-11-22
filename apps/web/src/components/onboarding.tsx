'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from './api';

const GOALS = [
  ['tasks', 'Remember tasks'], ['documents', 'Organise documents'], ['purchases', 'Track purchases & warranties'], ['subscriptions', 'Manage subscriptions & bills'],
  ['commitments', 'Remember commitments'], ['family', 'Coordinate family responsibilities'], ['events', 'Plan personal events'], ['everything', 'Manage everyday life'],
] as const;

const EXAMPLES = [
  'Reminder: submit the scholarship form by 28 Nov. Interview on 3 Dec at 11am.',
  'Your Netflix membership will renew on 5 December. You will be charged ₹649/month.',
  "I'll send you the signed rental agreement by Friday.",
];

export function OnboardingFlow({ name }: { name: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [goals, setGoals] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--color-blue)]">Step {step} of 2</p>
      {step === 1 && (
        <>
          <h1 className="h1 mt-1">Hi {name}. What do you want LifeOS to help with?</h1>
          <p className="mt-1 text-sm muted">Pick any. This only changes what we show you first — every feature stays available.</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {GOALS.map(([id, label]) => (
              <label key={id} className={`card flex cursor-pointer items-center gap-3 p-3 ${goals.includes(id) ? 'border-[var(--color-blue)] bg-[var(--color-blue-soft)]/40' : ''}`}>
                <input type="checkbox" checked={goals.includes(id)} onChange={(e) => setGoals((g) => (e.target.checked ? [...g, id] : g.filter((x) => x !== id)))} />
                <span className="text-sm font-medium">{label}</span>
              </label>
            ))}
          </div>
          <div className="mt-6 flex justify-between">
            <button className="btn btn-ghost" onClick={async () => { await api('/me', { method: 'PATCH', body: { onboarded: true } }); router.push('/app'); }}>Skip</button>
            <button className="btn btn-primary" onClick={async () => { await api('/me', { method: 'PATCH', body: { onboardingGoals: goals } }); setStep(2); }}>Continue</button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <h1 className="h1 mt-1">Capture one real thing</h1>
          <p className="mt-1 text-sm muted">Paste a message, a reminder, a bill or a renewal email. LifeOS will suggest what it means; you confirm before anything is saved. You can also upload a screenshot or receipt from the Capture button later.</p>
          <textarea className="field mt-5 min-h-32" aria-label="Something to capture" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or type here…" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="text-xs muted">Or try an example:</span>
            {EXAMPLES.map((ex) => <button key={ex} className="btn btn-sm" onClick={() => setText(ex)}>{ex.slice(0, 38)}…</button>)}
          </div>
          {error && <p role="alert" className="mt-2 text-sm font-medium text-rose-700">{error}</p>}
          <div className="mt-6 flex justify-between">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-blue" disabled={busy || !text.trim()} onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api<{ id: string }>('/captures', { body: { text, sourceType: 'paste' } });
                await api('/me', { method: 'PATCH', body: { onboarded: true } });
                router.push(`/app/inbox/${r.id}`);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}>{busy ? 'Saving…' : 'Save and review'}</button>
          </div>
        </>
      )}
    </div>
  );
}

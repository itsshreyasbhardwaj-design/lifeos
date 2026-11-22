'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from './api';

interface Answer {
  answer: string;
  intent: string;
  sources: { type: string; id: string; title: string; date: string | null; link: string; detail?: string | null }[];
  uncertainty: string | null;
  range: { from: string; to: string } | null;
}

export function AskBox({ examples }: { examples: string[] }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function ask(question: string) {
    setQ(question);
    setBusy(true);
    setErr(null);
    try {
      setA(await api<Answer>('/ai/ask', { body: { question } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-4" aria-label="Ask LifeOS">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }} className="flex gap-2">
        <label htmlFor="ask" className="sr-only">Ask a question about your records</label>
        <input id="ask" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask: “When does my phone warranty expire?”" />
        <button className="btn btn-blue" disabled={busy}><Sparkles size={15} aria-hidden /> {busy ? 'Looking…' : 'Ask'}</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">{examples.map((ex) => <button key={ex} className="chip hover:bg-[var(--surface-2)]" onClick={() => ask(ex)}>{ex}</button>)}</div>
      {err && <p role="alert" className="mt-3 text-sm text-rose-700">{err}</p>}
      {a && (
        <div className="mt-4 rounded-xl bg-[var(--surface-2)] p-4" aria-live="polite">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.answer}</p>
          {a.uncertainty && <p className="mt-2 text-xs text-amber-700">{a.uncertainty}</p>}
          {a.sources.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide muted">Sources</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">{a.sources.map((s) => <li key={`${s.type}${s.id}${s.date}`}><Link href={s.link} className="chip chip-blue">{s.title}{s.date ? ` · ${s.date}` : ''}</Link></li>)}</ul>
            </div>
          )}
          <p className="mt-3 text-[11px] muted">Answered on this server from your own records by LifeOS’s local rules — no external AI service was used.</p>
        </div>
      )}
    </section>
  );
}

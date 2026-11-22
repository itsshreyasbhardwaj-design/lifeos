'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from './api';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next')?.startsWith('/') && !params.get('next')!.startsWith('//') ? params.get('next')! : '/app';
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mfa) {
        await api('/auth/mfa', { body: { code: f.get('code') } });
        router.push(next);
      } else {
        const r = await api<{ mfa: boolean }>('/auth/login', { body: { email: f.get('email'), password: f.get('password') } });
        if (r.mfa) setMfa(true);
        else router.push(next);
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {!mfa ? (
        <>
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required className="field" /></div>
          <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required className="field" /></div>
        </>
      ) : (
        <div><label className="label" htmlFor="code">6-digit code from your authenticator app</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required className="field" autoFocus /></div>
      )}
      {error && <p role="alert" className="text-sm font-medium text-rose-700">{error}</p>}
      <button className="btn btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Signing in…' : mfa ? 'Verify' : 'Sign in'}</button>
      <p className="text-center text-sm muted">New here? <Link href={`/signup${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-[var(--color-blue)]">Create a free account</Link></p>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next')?.startsWith('/') && !params.get('next')!.startsWith('//') ? params.get('next')! : '/onboarding';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tz, setTz] = useState('Asia/Kolkata');
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'), []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register', { body: { displayName: f.get('displayName'), email: f.get('email'), password: f.get('password'), locale: f.get('locale'), timezone: tz } });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div><label className="label" htmlFor="displayName">Your name</label><input id="displayName" name="displayName" autoComplete="name" required className="field" /></div>
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required className="field" /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="field" aria-describedby="pw-hint" /><p id="pw-hint" className="mt-1 text-xs muted">At least 10 characters. A short sentence works well.</p></div>
      <div><label className="label" htmlFor="locale">Language</label>
        <select id="locale" name="locale" className="field" defaultValue="en-IN"><option value="en-IN">English (India)</option><option value="hi-IN">हिन्दी</option><option value="bn-IN">বাংলা</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select>
      </div>
      <p className="text-xs muted">Timezone: {tz} (change it any time in Settings).</p>
      {error && <p role="alert" className="text-sm font-medium text-rose-700">{error}</p>}
      <button className="btn btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Creating…' : 'Create free account'}</button>
      <p className="text-center text-xs muted">By continuing you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy-policy" className="underline">Privacy Policy</Link>. No card required.</p>
      <p className="text-center text-sm muted">Already have an account? <Link href="/login" className="font-semibold text-[var(--color-blue)]">Sign in</Link></p>
    </form>
  );
}

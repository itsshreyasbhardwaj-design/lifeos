'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useToast } from './api';

export function MfaSetup() {
  const router = useRouter();
  const toast = useToast();
  const [secret, setSecret] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  if (!secret) return <button className="btn btn-sm" onClick={async () => setSecret(await api('/me/mfa/setup', { body: {} }))}>Set up an authenticator app</button>;
  return (
    <div className="space-y-2 text-sm">
      <p>Add this key to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code.</p>
      <p className="rounded-lg bg-[var(--surface-2)] p-2 font-mono text-sm tracking-wider break-all">{secret.secret.replace(/(.{4})/g, '$1 ')}</p>
      <div className="flex gap-2"><input className="field" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" aria-label="Code" />
        <button className="btn btn-primary" onClick={async () => { try { await api('/me/mfa/enable', { body: { code } }); toast('Two-step verification is on.'); router.refresh(); } catch (e) { toast((e as Error).message, 'error'); } }}>Turn on</button></div>
    </div>
  );
}

export function TokenCreator() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const r = await api<{ token: string }>('/me/tokens', { body: { name: f.get('name'), scopes: ['capture:write', 'tasks:write'] } }); setToken(r.token); router.refresh(); }}>
        <input name="name" required defaultValue="Browser extension" className="field" aria-label="Token name" /><button className="btn">Create token</button>
      </form>
      {token && <div className="rounded-lg bg-[var(--color-amber-soft)] p-2 text-xs text-amber-900"><p className="mb-1 font-semibold">Copy it now — it won’t be shown again.</p><input readOnly value={token} className="field !py-1 font-mono text-xs" aria-label="New token" onFocus={(e) => e.target.select()} /></div>}
    </div>
  );
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function PushSetup() {
  const toast = useToast();
  const [state, setState] = useState<'unsupported' | 'default' | 'granted' | 'denied' | 'subscribed'>('default');
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState('unsupported');
    navigator.serviceWorker.ready.then(async (reg) => setState((await reg.pushManager.getSubscription()) ? 'subscribed' : (Notification.permission as 'default')));
  }, []);
  if (state === 'unsupported') return <p className="text-sm">This browser does not support push notifications here. In-app notifications still work.</p>;
  if (state === 'denied') return <p className="text-sm">Notifications are blocked for this site in your browser settings.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={state === 'subscribed' ? 'chip chip-green' : 'chip'}>{state === 'subscribed' ? 'Push is on for this device' : 'Push is off for this device'}</span>
      {state !== 'subscribed' ? (
        <button className="btn btn-sm btn-primary" onClick={async () => {
          try {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') return setState(perm as 'denied');
            const reg = await navigator.serviceWorker.ready;
            const { publicKey } = await api<{ publicKey: string }>('/push/key');
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) as BufferSource });
            await api('/push/subscribe', { body: sub.toJSON() });
            setState('subscribed');
            toast('Push notifications turned on for this device.');
          } catch (e) {
            toast(`Could not turn on push: ${(e as Error).message}`, 'error');
          }
        }}>Turn on</button>
      ) : (
        <button className="btn btn-sm" onClick={async () => { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); } setState('default'); }}>Turn off</button>
      )}
    </div>
  );
}

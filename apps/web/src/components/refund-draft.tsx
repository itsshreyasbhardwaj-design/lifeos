'use client';

import { useState } from 'react';
import { api, useToast } from './api';

export function RefundDraft({ purchaseId }: { purchaseId: string }) {
  const toast = useToast();
  const [d, setD] = useState<{ to: string; subject: string; body: string } | null>(null);
  if (!d) return <button className="btn btn-sm" onClick={async () => setD(await api(`/purchases/${purchaseId}/refund-draft`))}>Draft a follow-up message</button>;
  const text = `Subject: ${d.subject}\n\n${d.body}`;
  return (
    <div className="space-y-2">
      <p className="text-xs muted">A draft for you to copy and send from your own email or the seller’s support page. LifeOS does not send it.</p>
      <textarea readOnly className="field min-h-40 font-mono text-xs" value={text} aria-label="Draft message" />
      <button className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(text); toast('Copied.'); }}>Copy</button>
    </div>
  );
}

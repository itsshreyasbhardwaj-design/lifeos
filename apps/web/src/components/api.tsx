'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from 'react';

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;
  constructor(code: string, status: number, message: string, details: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Calls the LifeOS JSON API. Same-origin, cookie-authenticated. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
    headers: init.form ? undefined : { 'content-type': 'application/json' },
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: 'same-origin',
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError('http', res.status, `Request failed (${res.status})`, null);
    return (await res.blob()) as T;
  }
  const json = (await res.json()) as { data?: T; error?: { code: string; message: string; details: unknown } };
  if (!res.ok || json.error) throw new ApiError(json.error?.code ?? 'http', res.status, json.error?.message ?? `Request failed (${res.status})`, json.error?.details);
  return json.data as T;
}

// ------------------------------------------------------------------ toasts

const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tone: 'ok' | 'error' }[]>([]);
  const push = useCallback((msg: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((i) => (
          <div key={i.id} role={i.tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${i.tone === 'error' ? 'bg-rose-700 text-white' : 'bg-[var(--color-navy)] text-white'}`}>
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ forms

/**
 * Converts a form into the JSON body the API expects. Input conventions:
 *   data-kind="money"  "1,499.50" → 149950 (minor units)
 *   data-kind="int"    "30" → 30
 *   data-kind="bool"   checkbox → true/false
 *   data-kind="list"   "a, b" → ["a","b"]
 *   data-kind="json"   parsed JSON
 *   empty strings become null; "a.b" names build nested objects.
 */
export function formToJson(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (path: string, v: unknown) => {
    const keys = path.split('.');
    let cur = out;
    keys.slice(0, -1).forEach((k) => {
      cur[k] ??= {};
      cur = cur[k] as Record<string, unknown>;
    });
    cur[keys[keys.length - 1]!] = v;
  };
  for (const el of Array.from(form.elements) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]) {
    if (!el.name || el.disabled) continue;
    const kind = el.dataset.kind;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      if (kind === 'bool' || !el.value || el.value === 'on') set(el.name, el.checked);
      else if (el.checked) {
        const prev = (el.name.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], out) as unknown[]) ?? [];
        set(el.name, [...(Array.isArray(prev) ? prev : []), el.value]);
      }
      continue;
    }
    if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) continue;
    if (el instanceof HTMLInputElement && el.type === 'file') continue;
    const raw = el.value.trim();
    if (raw === '') {
      if (el.dataset.omitEmpty !== undefined) continue;
      set(el.name, null);
      continue;
    }
    if (kind === 'money') set(el.name, Math.round(Number(raw.replace(/[,₹\s]/g, '')) * 100));
    else if (kind === 'int') set(el.name, Number.parseInt(raw, 10));
    else if (kind === 'list') set(el.name, raw.split(',').map((s) => s.trim()).filter(Boolean));
    else if (kind === 'json') set(el.name, JSON.parse(raw));
    else set(el.name, raw);
  }
  return out;
}

export function ApiForm({
  path, method = 'POST', children, className, onDone, redirectTo, success, multipart, transform, resetOnSuccess = true,
}: {
  path: string;
  method?: string;
  children: ReactNode;
  className?: string;
  onDone?: (data: unknown) => void;
  redirectTo?: string | ((data: unknown) => string);
  success?: string;
  multipart?: boolean;
  transform?: (body: Record<string, unknown>) => Record<string, unknown>;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const data = multipart ? await api(path, { method, form: new FormData(form) }) : await api(path, { method, body: transform ? transform(formToJson(form)) : formToJson(form) });
      if (success) toast(success);
      if (resetOnSuccess) form.reset();
      onDone?.(data);
      if (redirectTo) router.push(typeof redirectTo === 'function' ? redirectTo(data) : redirectTo);
      else router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className={className} aria-busy={busy} noValidate={false}>
      <fieldset disabled={busy} className="contents">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}
    </form>
  );
}

export function ApiButton({
  path, method = 'POST', body, children, className = 'btn btn-sm', confirm, success, redirectTo, onDone, title, ariaLabel,
}: {
  path: string;
  method?: string;
  body?: unknown;
  children: ReactNode;
  className?: string;
  confirm?: string;
  success?: string;
  redirectTo?: string;
  onDone?: (data: unknown) => void;
  title?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      title={title}
      aria-label={ariaLabel}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          const data = await api(path, { method, body: body ?? {} });
          if (success) toast(success);
          onDone?.(data);
          if (redirectTo) router.push(redirectTo);
          else router.refresh();
        } catch (err) {
          toast((err as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

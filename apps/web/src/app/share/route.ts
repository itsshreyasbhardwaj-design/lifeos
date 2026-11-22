import { NextResponse } from 'next/server';
import { authenticate } from '@lifeos/core/auth';
import { personalWorkspaceId } from '@lifeos/core/access';
import { createCapture } from '@lifeos/core/captures';
import { ctxFor } from '@lifeos/core/context';
import { validateUpload } from '@lifeos/core/files';
import { getDb, ensureWorker } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/**
 * PWA share target: the phone's share sheet posts here. Works only where the
 * installed PWA supports share targets (Chromium on Android, desktop Chrome/Edge).
 * Session cookies are SameSite=Lax, so a cross-site form cannot post as the user.
 */
export async function POST(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return new Response('Cross-site request refused', { status: 403 });
  const db = await getDb();
  const token = req.headers.get('cookie')?.match(/(?:^|;\s*)lifeos_session=([^;]+)/)?.[1];
  const s = await authenticate(db, token ? decodeURIComponent(token) : null);
  if (!s || s.mfaPending) return NextResponse.redirect(new URL('/login?next=/app/inbox', req.url), 303);
  const form = await req.formData();
  const files = [];
  for (const v of form.getAll('files')) if (v instanceof File && v.size > 0) files.push(validateUpload(v.name, v.type, Buffer.from(await v.arrayBuffer())));
  const text = [form.get('title'), form.get('text')].filter((x) => typeof x === 'string' && x.trim()).join('\n');
  const url = typeof form.get('url') === 'string' && /^https?:\/\//.test(String(form.get('url'))) ? String(form.get('url')) : null;
  const ctx = ctxFor(db, s.user.id);
  const r = await createCapture(ctx, await personalWorkspaceId(db, s.user.id), { sourceType: 'share', sourceApp: 'pwa-share-target', text: text || null, url }, files);
  ensureWorker();
  return NextResponse.redirect(new URL(`/app/inbox/${r.capture.id}`, req.url), 303);
}

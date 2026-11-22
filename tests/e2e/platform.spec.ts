import { expect, test } from '@playwright/test';
import { api, register, skipOnboarding } from './helpers';

test('security: auth, CSRF, cross-user isolation, headers', async ({ browser, page }) => {
  expect((await page.request.get('/api/v1/tasks')).status()).toBe(401);
  const res = await page.goto('/');
  expect(res!.headers()['x-frame-options']).toBe('DENY');
  expect(res!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

  await register(page, 'Alice Secure');
  await skipOnboarding(page);
  const cap = await api<{ id: string }>(page, '/captures', { text: 'Alice private note: locker code' });
  expect(cap.status).toBe(200);
  const csrf = await page.request.post('/api/v1/tasks', { data: { title: 'forged' }, headers: { origin: 'https://evil.example' } });
  expect(csrf.status()).toBe(403);

  const other = await browser.newContext();
  const bob = await other.newPage();
  await register(bob, 'Bob Other');
  await skipOnboarding(bob);
  expect((await bob.goto(`/app/inbox/${cap.data.id}`))!.status()).toBe(404);
  expect((await bob.request.get(`/api/v1/captures/${cap.data.id}`)).status()).toBe(404);
  expect(((await api<unknown[]>(bob, '/search?q=locker')).data)).toHaveLength(0);
  await other.close();
});

test('PWA: manifest with share target, service worker registers', async ({ page }) => {
  const m = await (await page.request.get('/manifest.webmanifest')).json();
  expect(m.share_target.action).toBe('/share');
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  await register(page, 'Pia Pwa');
  await skipOnboarding(page);
  const active = await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active));
  expect(active).toBe(true);
  // The share target accepts a shared link and lands in the Inbox.
  await page.goto('/app');
  const result = await page.evaluate(async () => {
    const fd = new FormData();
    fd.set('title', 'Shared from phone');
    fd.set('text', 'Renew the gym membership by 30/12/2026');
    const r = await fetch('/share', { method: 'POST', body: fd, redirect: 'follow' });
    return r.url;
  });
  expect(result).toMatch(/\/app\/inbox\/cap_/);
});

test('i18n: Hindi interface for navigation and capture', async ({ page }) => {
  await register(page, 'Rohan Hindi', { locale: 'hi-IN' });
  await skipOnboarding(page);
  await expect(page.getByRole('link', { name: 'आज' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'इनबॉक्स' }).first()).toBeVisible();
});

test('marketing pages and interactive demo @cross-browser', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Never forget what matters.' })).toBeVisible();
  await page.getByRole('button', { name: 'Electronics receipt' }).click();
  await expect(page.getByText('warranty', { exact: true }).first()).toBeVisible();
  for (const p of ['/pricing', '/faq', '/life-inbox', '/privacy-security']) expect((await page.goto(p))!.status()).toBe(200);
});

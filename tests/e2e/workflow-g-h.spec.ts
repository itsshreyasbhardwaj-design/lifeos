import { expect, test } from '@playwright/test';
import { api, openCapture, register, skipOnboarding } from './helpers';

test('Workflow G — offline capture draft syncs once with no duplicates', async ({ page, context }) => {
  await register(page, 'Nikhil Offline');
  await skipOnboarding(page);
  await context.setOffline(true);
  await openCapture(page);
  await page.getByLabel('Text to capture').fill('Buy printer ink before the exam week');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(page.getByText(/Saved offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/Synced 1 item/)).toBeVisible({ timeout: 20_000 });
  // Reloading and re-flushing must not create a second copy.
  await page.reload();
  await page.waitForTimeout(1500);
  const list = await api<{ text_content: string }[]>(page, '/captures?status=all');
  expect(list.data.filter((c) => c.text_content?.includes('printer ink'))).toHaveLength(1);
});

test('Workflow H — trial, premium feature, server-side entitlement, downgrade keeps data', async ({ page }) => {
  await register(page, 'Ishaan Plan');
  await skipOnboarding(page);
  await page.goto('/app/purchases');
  await expect(page.getByText(/Purchase Protection is part of LifeOS Plus/)).toBeVisible();
  const blocked = await api(page, '/purchases', { productName: 'Air fryer' });
  expect(blocked.status).toBe(402);
  await page.goto('/app/billing');
  await page.getByRole('button', { name: 'Start 14-day free trial' }).first().click();
  await expect(page.getByText('Trial ends').first()).toBeVisible();
  await page.goto('/app/purchases');
  await page.getByLabel('Product').fill('Air fryer');
  await page.getByRole('button', { name: 'Save purchase' }).click();
  await page.waitForURL(/\/app\/purchases\/pur_/);
  // Downgrade: data stays readable, new premium records are refused by the server.
  await page.goto('/app/billing');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'End trial now' }).click();
  await expect(page.getByText('Current plan').first()).toBeVisible();
  await page.goto('/app/purchases');
  await expect(page.getByRole('link', { name: /Air fryer/ })).toBeVisible();
  expect((await api(page, '/purchases', { productName: 'Kettle' })).status).toBe(402);
  expect((await api(page, '/billing/trial', { plan: 'plus' })).status).toBe(422);
});

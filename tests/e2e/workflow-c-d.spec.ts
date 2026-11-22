import { expect, test } from '@playwright/test';
import { api, istToday, register, skipOnboarding } from './helpers';

test('Workflow C — promise → expected date → follow-up → waiting list → resolve', async ({ page }) => {
  await register(page, 'Kavya Iyer');
  await skipOnboarding(page);
  await page.goto('/app/promises');
  await page.getByLabel('Who promised').selectOption('they_promised');
  await page.getByLabel('What', { exact: true }).fill('Service centre will call back about the repair');
  await page.getByLabel('With').fill('Sony Service Centre');
  await page.getByLabel('Expected by').fill(istToday(2));
  await page.getByRole('button', { name: 'Save' }).click();
  const card = page.locator('article', { hasText: 'Service centre will call back' });
  await expect(card).toBeVisible();
  await card.getByLabel('Follow up on').fill(istToday(3));
  await card.getByRole('button', { name: 'Follow up' }).click();
  await expect(card).toContainText('follow-up');

  await page.goto('/app/promises?tab=they_promised');
  await expect(page.locator('article', { hasText: 'Service centre will call back' })).toBeVisible();
  const ask = await api<{ sources: { title: string }[] }>(page, '/ai/ask', { question: 'What am I waiting for?' });
  expect(ask.data.sources.map((s) => s.title)).toContain('Service centre will call back about the repair');

  await page.locator('article', { hasText: 'Service centre will call back' }).getByRole('button', { name: 'Done' }).click();
  await page.goto('/app/promises?tab=resolved');
  await expect(page.locator('article', { hasText: 'Service centre will call back' })).toContainText('Fulfilled');
  // Follow-up reminders stopped.
  await page.goto('/app/promises?tab=resolved');
  await expect(page.locator('article', { hasText: 'Service centre' })).not.toContainText('follow-up');
});

test('Workflow D — LifeAdmin: workflow → documents → steps → evidence → submitted → confirmed → history', async ({ page }) => {
  await register(page, 'Dev Mehta');
  await skipOnboarding(page);
  await api(page, '/billing/dev-plan', { plan: 'plus' });
  await page.goto('/app/admin');
  await page.getByLabel('Template').selectOption('university_application');
  await page.getByLabel('Title').fill('Apply to summer research programme');
  await page.getByLabel('Deadline').fill(istToday(20));
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/app\/admin\/adm_/);
  const boxes = page.locator('input[type=checkbox]');
  await expect(boxes.first()).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await boxes.nth(i).check();
    await expect(page.getByText(`${i + 1} of`)).toBeVisible();
  }
  const workflowUrl = page.url();
  // Evidence: upload a confirmation document, then attach it.
  await page.goto('/app/vault');
  await page.getByLabel('File').setInputFiles({ name: 'submission.txt', mimeType: 'text/plain', buffer: Buffer.from('Application APP-2291 received. Thank you.') });
  await page.getByLabel('Title').fill('Submission confirmation');
  await page.getByRole('button', { name: 'Upload' }).click();
  await page.waitForURL(/\/app\/vault\/doc_/);
  await page.goto(workflowUrl);
  await page.getByRole('combobox', { name: 'Document' }).selectOption({ label: 'Submission confirmation' });
  await page.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByText('Evidence for')).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('user_reported_submitted');
  await page.getByLabel('Reference number', { exact: true }).fill('APP-2291');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/reference APP-2291/)).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('confirmed_completed');
  await page.getByLabel('Note', { exact: true }).fill('Acceptance email received');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/status → confirmed completed — “Acceptance email received”/i)).toBeVisible();
  await expect(page.getByText(/status → user reported submitted/i)).toBeVisible();
});

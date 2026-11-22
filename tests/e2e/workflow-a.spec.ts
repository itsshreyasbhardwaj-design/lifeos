import { expect, test } from '@playwright/test';
import { istToday, openCapture, register, skipOnboarding, textImage } from './helpers';

test('Workflow A — screenshot → extract → review → confirm → reminder → Today → source → complete @cross-browser', async ({ page, browser }) => {
  await register(page, 'Asha Rao');
  await skipOnboarding(page);
  const png = await textImage(browser, ['Reminder from Green Valley School', 'Pay the term fees today at 5pm']);

  await openCapture(page);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.locator('dialog input[type=file]').setInputFiles({ name: 'school-message.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await page.waitForURL(/\/app\/inbox\/cap_/);

  // Local OCR reads the image; the suggestion appears with the source excerpt.
  const card = page.getByRole('article', { name: /Suggested (Task|Deadline)/ }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('blockquote')).toContainText(/term fees/i);
  await expect(card.getByLabel(/Due date|Deadline/)).toHaveValue(istToday());
  await expect(card.getByLabel('Time')).toHaveValue('17:00');
  await expect(card.getByLabel(/Remind me/)).toBeChecked();
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('link', { name: /Saved — open/ }).first()).toBeVisible();

  // It is on Today.
  await page.goto('/app');
  await expect(page.getByRole('link', { name: /Pay the term fees/i })).toBeVisible();

  // Task page: reminder scheduled, source linked.
  await page.getByRole('link', { name: /Pay the term fees/i }).first().click();
  await expect(page.getByText(/Scheduled|Delivered/).first()).toBeVisible();
  await page.getByRole('link', { name: /school|reminder|fees|capture/i }).filter({ hasNot: page.getByRole('heading') }).last().click();
  await page.waitForURL(/\/app\/inbox\/cap_/);
  const img = page.getByRole('img', { name: /Captured image/ });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);

  // Complete it.
  await page.goBack();
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText(/^Completed/).first()).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { api, istToday, register, skipOnboarding, uniqueEmail } from './helpers';

test('Workflow E — family: invite, assign, complete, share one document, privacy, revoke', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const member = await memberCtx.newPage();
  await register(owner, 'Meera Sharma');
  await skipOnboarding(owner);
  await api(owner, '/billing/dev-plan', { plan: 'family' });

  await owner.goto('/app/family');
  await owner.getByLabel('Family space name').fill('Sharma home');
  await owner.getByRole('button', { name: 'Create' }).click();
  await expect(owner.getByRole('heading', { name: 'Sharma home' })).toBeVisible();
  const memberEmail = uniqueEmail('arjun');
  await owner.getByLabel('Email').fill(memberEmail);
  await owner.getByRole('button', { name: 'Create link' }).click();
  const link = await owner.getByLabel('Invitation link').inputValue();

  await member.goto(link);
  await member.getByRole('link', { name: 'Create account' }).click();
  await register(member, 'Arjun Sharma', { email: memberEmail, next: new URL(link).pathname });
  await member.waitForURL(/\/invite\//);
  await member.getByRole('button', { name: 'Join' }).click();
  await member.waitForURL(/\/app\/family/);

  // Owner assigns a shared task.
  await owner.reload();
  await owner.getByRole('textbox', { name: 'Task' }).fill('Take out the recycling');
  await owner.getByLabel('Assign to').selectOption({ label: 'Arjun Sharma' });
  await owner.getByLabel('Due', { exact: true }).fill(istToday());
  await owner.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(owner.getByRole('link', { name: 'Take out the recycling' })).toBeVisible();

  // Member completes it.
  await member.goto('/app/tasks?view=assigned_to_me');
  await member.getByRole('checkbox', { name: /Complete Take out the recycling/ }).click();
  await expect(member.getByRole('checkbox', { name: /Reopen Take out the recycling/ })).toBeVisible();

  // Owner: one private document, one shared.
  for (const [title, body] of [['Salary slip November', 'Net pay 1,20,000'], ['House rental agreement', 'Lease terms for flat 4B']] as const) {
    await owner.goto('/app/vault');
    await owner.getByLabel('File').setInputFiles({ name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(body) });
    await owner.getByLabel('Title').fill(title);
    await owner.getByRole('button', { name: 'Upload' }).click();
    await owner.waitForURL(/\/app\/vault\/doc_/);
  }
  const leaseUrl = owner.url();
  await owner.getByLabel('Share with').selectOption({ label: 'Everyone in Sharma home' });
  await owner.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Revoke' })).toBeVisible();

  // Member sees only the shared one; private records stay private.
  await member.goto('/app/vault');
  await expect(member.getByRole('link', { name: /House rental agreement/ })).toBeVisible();
  await expect(member.getByText('Salary slip November')).toHaveCount(0);
  const s = await api<unknown[]>(member, '/search?q=salary');
  expect(s.data).toHaveLength(0);
  const docId = leaseUrl.split('/').pop()!;
  expect((await member.request.get(`/api/v1/files/document/${docId}?download=1`)).status()).toBe(403);

  // Revoke → gone immediately.
  await owner.getByRole('button', { name: 'Revoke' }).click();
  await expect(owner.getByText('Revoked', { exact: true })).toBeVisible();
  await member.goto('/app/vault');
  await expect(member.getByText('House rental agreement')).toHaveCount(0);
  expect((await member.request.get(`/api/v1/files/document/${docId}`)).status()).toBe(404);
  await ownerCtx.close();
  await memberCtx.close();
});

test('Workflow F — subscription: renewal reminder, cancellation checklist, confirmation, no future reminders', async ({ page }) => {
  await register(page, 'Sana Khan');
  await skipOnboarding(page);
  await page.goto('/app/subscriptions');
  await page.getByLabel('Service').fill('StreamFlix');
  await page.getByLabel('Price (₹)').fill('649');
  await page.getByLabel('Next renewal').fill(istToday(10));
  await page.getByRole('button', { name: 'Save' }).click();
  const card = page.locator('article', { hasText: 'StreamFlix' });
  await expect(card).toContainText('renews');
  let agenda = await api<{ type: string }[]>(page, `/calendar?from=${istToday()}&to=${istToday(30)}`);
  expect(agenda.data.filter((i) => i.type === 'renewal')).toHaveLength(1);
  await card.getByRole('button', { name: 'Plan to cancel' }).click();
  await expect(card.getByText('Cancellation checklist')).toBeVisible();
  await card.locator('input[type=checkbox]').first().check();
  await card.getByLabel('Cancelled on').fill(istToday());
  await card.getByLabel('Confirmation details').fill('Confirmation email 22 Nov');
  await card.getByRole('button', { name: 'It’s cancelled' }).click();
  await expect(card).toContainText('Cancelled');
  agenda = await api<{ type: string }[]>(page, `/calendar?from=${istToday()}&to=${istToday(30)}`);
  expect(agenda.data.filter((i) => i.type === 'renewal')).toHaveLength(0);
});

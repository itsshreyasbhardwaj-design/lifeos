import { expect, test } from '@playwright/test';
import { api, dmy, istToday, openCapture, receiptPdf, register, skipOnboarding } from './helpers';

test('Workflow B — receipt PDF → purchase, warranty, return → reminders → search → original receipt', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'page.pdf() fixture generation needs Chromium');
  await register(page, 'Ravi Kumar');
  await skipOnboarding(page);
  await page.goto('/app/billing');
  await page.getByRole('button', { name: 'Start 14-day free trial' }).first().click();
  await expect(page.getByText('Trial ends').first()).toBeVisible();

  const invoiceDate = istToday(-2);
  const pdf = await receiptPdf(browser, `<h2>Croma</h2><p>Tax Invoice</p><p>Invoice No: CRM/26/55120</p><p>Invoice Date: ${dmy(invoiceDate)}</p>
    <p>Item: Sony WH-1000XM5 Headphones Qty 1 ₹29,990.00</p><p>Grand Total ₹29,990.00</p><p>1 year manufacturer warranty.</p><p>7 days replacement policy.</p>`);
  await openCapture(page);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.locator('dialog input[type=file]').setInputFiles({ name: 'croma-invoice.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await page.waitForURL(/\/app\/inbox\/cap_/);

  const purchase = page.getByRole('article', { name: 'Suggested Purchase' });
  await expect(purchase).toBeVisible({ timeout: 45_000 });
  await expect(purchase.getByLabel('Product')).toHaveValue(/Sony WH-1000XM5 Headphones/);
  await expect(purchase.getByLabel('Purchase date')).toHaveValue(invoiceDate);
  await expect(purchase.getByLabel('Amount paid')).toHaveValue('29990');
  await purchase.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('link', { name: /Saved — open/ })).toHaveCount(1);

  const warranty = page.getByRole('article', { name: 'Suggested Warranty' });
  await expect(warranty.getByText(/Worked out from/)).toBeVisible();
  await warranty.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('link', { name: /Saved — open/ })).toHaveCount(2);
  await page.getByRole('article', { name: 'Suggested Return window' }).getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('link', { name: /Saved — open/ })).toHaveCount(3);

  // Reminders exist for the warranty and the return deadline (calendar overlay shows the deadline).
  const agenda = await api<{ type: string; title: string }[]>(page, `/calendar?from=${istToday()}&to=${istToday(30)}`);
  expect(agenda.data.some((i) => i.type === 'return_deadline')).toBe(true);

  // Search, then retrieve the original receipt.
  await page.goto('/app/search?q=sony headphones');
  await expect(page.getByRole('link', { name: /Sony WH-1000XM5 Headphones/ }).first()).toBeVisible();
  await page.goto('/app/search?q=sony headphones&type=purchase');
  await page.getByRole('link', { name: /Sony WH-1000XM5 Headphones/ }).first().click();
  await page.waitForURL(/\/app\/purchases\/pur_/);
  await expect(page.getByText(/Return by/)).toBeVisible();
  await expect(page.getByText(/manufacturer warranty|read from your receipt/)).toBeVisible();
  await page.getByRole('link', { name: 'Open receipt' }).click();
  await page.waitForURL(/\/app\/vault\/doc_/);
  const id = page.url().split('/').pop()!;
  const file = await page.request.get(`/api/v1/files/document/${id}`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
});

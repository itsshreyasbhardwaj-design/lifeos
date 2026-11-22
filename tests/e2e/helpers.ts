import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-only-password-123';

let n = 0;
export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now().toString(36)}${(n++).toString(36)}@lifeos.test`;
}

/** Today's date in Asia/Kolkata, the timezone the test accounts use. */
export function istToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export async function register(page: Page, name: string, opts: { email?: string; locale?: string; next?: string } = {}) {
  const email = opts.email ?? uniqueEmail(name.toLowerCase().split(' ')[0]!);
  await page.goto(`/signup${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  if (opts.locale) await page.getByLabel('Language').selectOption(opts.locale);
  // A form filled before hydration is discarded when React takes over; retry until the request goes out.
  await expect(async () => {
    await page.getByRole('button', { name: /create free account/i }).click();
    await expect(page).not.toHaveURL(/\/signup/, { timeout: 8000 });
  }).toPass({ timeout: 45_000 });
  return email;
}

export async function skipOnboarding(page: Page) {
  await page.waitForURL(/onboarding/);
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.waitForURL(/\/app$/);
}

/** Same-origin API call with the page's cookies. */
export async function api<T = unknown>(page: Page, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<{ status: number; data: T }> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { origin } });
  const json = (await res.json().catch(() => ({}))) as { data?: T };
  return { status: res.status(), data: json.data as T };
}

export async function textImage(browser: Browser, lines: string[]): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 900, height: 120 + lines.length * 56 } });
  await page.setContent(`<body style="margin:0;background:#fff"><div style="padding:40px;font:36px/1.5 Arial, sans-serif;color:#000">${lines.map((l) => `<div>${l}</div>`).join('')}</div></body>`);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

export async function receiptPdf(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(`<body style="font:14px Arial;padding:24px">${html}</body>`);
  const pdf = await page.pdf({ format: 'A5' });
  await page.close();
  return pdf;
}

export async function openCapture(page: Page) {
  const desktop = page.getByRole('button', { name: /^Capture C$/ });
  if (await desktop.isVisible()) await desktop.click();
  else await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

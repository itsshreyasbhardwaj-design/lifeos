import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { api, register, skipOnboarding } from './helpers';

const EXT = resolve(process.cwd(), '../extension');

test('browser extension: connect with a scoped token, save a note and a task', async ({ page, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'MV3 extensions load in Chromium only');
  await register(page, 'Esha Extension');
  await skipOnboarding(page);
  const { data } = await api<{ token: string }>(page, '/me/tokens', { name: 'Extension', scopes: ['capture:write', 'tasks:write'] });

  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lifeos-ext-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByLabel('Server address').fill(baseURL!);
    await popup.getByLabel('Token').fill(data.token);
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(popup.locator('#status')).toHaveText('Connected');
    await popup.getByLabel('Note or task').fill('Renew passport by 15/12/2026');
    await popup.getByRole('button', { name: 'Save as note' }).click();
    await expect(popup.locator('#status')).toHaveText('Saved to Inbox');
    await popup.getByLabel('Note or task').fill('Call the plumber tomorrow at 10am');
    await popup.getByRole('button', { name: 'Add as task' }).click();
    await expect(popup.locator('#status')).toHaveText('Task added');
  } finally {
    await ctx.close();
  }
  const caps = await api<{ text_content: string; source_type: string; source_app: string }[]>(page, '/captures?status=all');
  expect(caps.data.find((c) => c.text_content?.includes('Renew passport'))?.source_app).toBe('browser-extension');
  const tasks = await api<{ title: string; due_time: string | null }[]>(page, '/tasks');
  expect(tasks.data.find((t) => t.title === 'Call the plumber')?.due_time).toBe('10:00');
});

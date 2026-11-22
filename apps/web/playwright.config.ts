import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end tests run against a production build on a throwaway database
 * and file store, so they never touch your development data.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const tmp = process.env.LIFEOS_E2E_DIR ?? mkdtempSync(join(tmpdir(), 'lifeos-e2e-'));
process.env.LIFEOS_E2E_DIR = tmp;
const PORT = Number(process.env.E2E_PORT ?? 3299);

export default defineConfig({
  testDir: '../../tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: join(root, 'test-results', 'e2e.json') }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, grep: /@cross-browser/ },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] }, grep: /@cross-browser/ },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    cwd: here,
    url: `http://localhost:${PORT}/api/v1/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      LIFEOS_ROOT: root,
      DATABASE_URL: join(tmp, 'pglite'),
      LIFEOS_FILES_DIR: join(tmp, 'files'),
      LIFEOS_SECRET: 'e2e-only-secret-e2e-only-secret-0123456789',
      LIFEOS_ENABLE_DEV_BILLING: '1',
      LIFEOS_INSECURE_COOKIES: '1',
      LIFEOS_WORKER_INTERVAL_MS: '500',
      LIFEOS_PUSH: '0',
      LIFEOS_FETCH_URLS: '0',
      LIFEOS_OCR_DIR: join(root, 'data', 'ocr-models'),
    },
  },
});

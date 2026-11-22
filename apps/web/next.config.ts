import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Configuration lives at the repository root; Next only looks in apps/web.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
for (const file of ['.env', '.env.local']) {
  const path = resolve(repoRoot, file);
  if (!existsSync(path)) continue;
  try {
    process.loadEnvFile(path);
  } catch {
    // A malformed .env must not stop the server; the app reports missing config.
  }
}
process.env.LIFEOS_ROOT ??= repoRoot;
if (process.env.DATABASE_URL && !/^(postgres(ql)?|memory):\/\//.test(process.env.DATABASE_URL) && !isAbsolute(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = resolve(repoRoot, process.env.DATABASE_URL);
}

const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // React Refresh evaluates strings in development only.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  reactStrictMode: true,
  // E2E builds use their own directory so a running dev server cannot clobber them.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  // Workspace packages ship TypeScript source with .ts specifiers.
  transpilePackages: ['@lifeos/core', '@lifeos/extract'],
  // WASM / worker-based dependencies must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'tesseract.js', 'unpdf'],
  env: { LIFEOS_ROOT: process.env.LIFEOS_ROOT },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;

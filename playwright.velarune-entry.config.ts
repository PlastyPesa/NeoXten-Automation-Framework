import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(repoRoot, 'e2e'),
  testMatch: '**/velarune-dashboard-entry.spec.ts',
  timeout: 120_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:9884',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node ${path.join(repoRoot, 'scripts', 'velarune-studio-e2e-server.mjs')}`,
    cwd: repoRoot,
    url: 'http://127.0.0.1:9884/api/health',
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, VELARUNE_E2E_PORT: '9884' },
  },
});

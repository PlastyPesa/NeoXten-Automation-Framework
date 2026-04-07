import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(repoRoot, 'e2e'),
  testMatch: '**/velarune-icon-batch5.spec.ts',
  timeout: 180_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:9880',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node ${path.join(repoRoot, 'scripts', 'velarune-studio-e2e-server.mjs')}`,
    cwd: repoRoot,
    url: 'http://127.0.0.1:9880/api/health',
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, VELARUNE_E2E_PORT: '9880' },
  },
});

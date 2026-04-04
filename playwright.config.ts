import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(repoRoot, 'e2e'),
  /** UI dashboard tests use `playwright.dashboard.config.ts` (vite preview on :4173). */
  testIgnore: '**/operator-dashboard.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://127.0.0.1:8787',
  },
  webServer: {
    command: 'node dist/cli/index.js operator serve',
    cwd: repoRoot,
    url: 'http://127.0.0.1:8787/api/health',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      NEOXTEN_OPERATOR_HOME: path.join(repoRoot, '.neoxten-operator-e2e'),
      NEOXTEN_FRAMEWORK_ROOT: repoRoot,
    },
  },
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { DASHBOARD_OPERATOR_PORT } from './e2e/dashboard-constants';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(repoRoot, 'ui');

/**
 * Dashboard UI + Control API (Vite preview proxies /api → operator port via NEOXTEN_OPERATOR_API_PORT).
 * Requires: `npm run build` (framework) and `npm run build --prefix ui`.
 */
export default defineConfig({
  testDir: path.join(repoRoot, 'e2e'),
  testMatch: '**/operator-dashboard.spec.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node dist/cli/index.js operator serve',
      cwd: repoRoot,
      url: `http://127.0.0.1:${DASHBOARD_OPERATOR_PORT}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEOXTEN_OPERATOR_HOME: path.join(repoRoot, '.neoxten-operator-e2e'),
        NEOXTEN_FRAMEWORK_ROOT: repoRoot,
        NEOXTEN_OPERATOR_PORT: String(DASHBOARD_OPERATOR_PORT),
      },
    },
    {
      command: `${process.execPath} ${path.join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js')} preview --host 127.0.0.1 --port 4173 --strictPort`,
      cwd: uiRoot,
      url: 'http://127.0.0.1:4173/',
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEOXTEN_OPERATOR_API_PORT: String(DASHBOARD_OPERATOR_PORT),
      },
    },
  ],
});

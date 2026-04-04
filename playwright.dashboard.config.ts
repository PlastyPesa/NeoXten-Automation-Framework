import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(repoRoot, 'ui');

/**
 * Loopback port reserved for this harness only. Avoids:
 * - `loadAppConfig()` reading the real user's app.json (8787+ scan → 8790…) while Vite still proxies :8787
 * - clashes with a dev operator on 8787 when we pin the same port for serve + proxy
 */
const DASHBOARD_OPERATOR_PORT = 47_987;

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

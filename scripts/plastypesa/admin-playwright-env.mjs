import { getConfig } from './config.mjs';

/**
 * Merged into `npx playwright test` (admin frontend cwd) so Vite dev uses the same
 * execute-api stage as NeoXten (`PLASTYPESA_API_BASE` / config default).
 *
 * Important: `PLASTYPESA_API_BASE` ends with `/api` (e.g. .../prod/api). The admin
 * Vite app sets axios `baseURL` to `VITE_APP_DEV_BACKEND_URL` and paths already
 * include `/api/...`, so this value must be the stage URL **without** a trailing `/api`
 * (e.g. .../prod). Passing the full apiBase would produce .../prod/api/api/... and
 * break admin login in E2E.
 *
 * PLASTYPESA_E2E_ADMIN_USE_VITE_DOTENV=1 — do not set VITE_*; use admin `.env` only.
 * PLASTYPESA_ADMIN_VITE_BACKEND_URL — explicit override (same shape as admin `.env`).
 */
export function getAdminPlaywrightProcessEnv() {
  if (process.env.PLASTYPESA_E2E_ADMIN_USE_VITE_DOTENV === '1') {
    return {};
  }
  const override = (process.env.PLASTYPESA_ADMIN_VITE_BACKEND_URL || '').trim();
  if (override) {
    return { VITE_APP_DEV_BACKEND_URL: override.replace(/\/$/, '') };
  }
  const { apiBase } = getConfig();
  const viteBackend = apiBase.replace(/\/api$/i, '').replace(/\/$/, '');
  if (!viteBackend) return {};
  return { VITE_APP_DEV_BACKEND_URL: viteBackend };
}

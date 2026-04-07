/**
 * Single source for dashboard E2E operator port.
 * Must match `playwright.dashboard.config.ts` webServer URL.
 */
export const DASHBOARD_OPERATOR_PORT = 47_987;
export const DASHBOARD_OPERATOR_API_ORIGIN = `http://127.0.0.1:${DASHBOARD_OPERATOR_PORT}`;

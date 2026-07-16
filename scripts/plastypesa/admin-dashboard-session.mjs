import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { defaultAdminFrontendRoot } from './localization/config.mjs';
import { getAdminPlaywrightProcessEnv } from './admin-playwright-env.mjs';
import { getPlastypesaPersona, rememberPersonaSession } from './personas.mjs';

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function getAdminBaseUrl() {
  // Production API CORS explicitly allows the dashboard's localhost dev origin.
  // Keep one canonical hostname so authenticated XHRs are not blocked by the
  // browser treating 127.0.0.1 as a different origin.
  return process.env.PLASTYPESA_ADMIN_BASE_URL || 'http://localhost:8080';
}

export function getAdminApiBaseUrl() {
  const env = getAdminPlaywrightProcessEnv();
  return env.VITE_APP_DEV_BACKEND_URL || getAdminBaseUrl();
}

async function isReachable(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export async function ensureAdminWebServer(
  frontendRoot = defaultAdminFrontendRoot(),
  baseURL = getAdminBaseUrl(),
) {
  if (process.env.PLASTYPESA_ADMIN_WEBSERVER === '0') {
    return { child: null, reused: true };
  }

  if (await isReachable(baseURL)) {
    return { child: null, reused: true };
  }

  const child = spawn('npm run dev', {
    cwd: frontendRoot,
    env: {
      ...process.env,
      ...getAdminPlaywrightProcessEnv(),
    },
    shell: true,
    stdio: 'inherit',
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(1000);
    if (await isReachable(baseURL)) {
      return { child, reused: false };
    }
  }

  throw new Error(`Admin frontend never became reachable at ${baseURL}`);
}

export function killAdminWebServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', `${child.pid}`, '/t', '/f'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

export async function launchAdminBrowser(options = {}) {
  const browser = await chromium.launch({
    headless:
      options.headless ??
      (process.env.PLASTYPESA_ADMIN_HEADED === '1' ? false : true),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

async function waitForDashboardReady(page, baseURL) {
  const dashboardUrlPattern = /\/dashboard(?:[/?#]|$)/;
  const dashboardUrl = new URL('/dashboard', baseURL).toString();
  const dashboardHeading = page.getByRole('heading', { name: /^Dashboard$/ }).first();
  const signOutButton = page.getByRole('button', { name: /sign out/i }).first();

  try {
    await Promise.race([
      page.waitForURL(dashboardUrlPattern, { timeout: 45000 }),
      dashboardHeading.waitFor({ state: 'visible', timeout: 45000 }),
    ]);
  } catch {
    // Fall through to the retry loop below so we can recover from cookie/write timing.
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (dashboardUrlPattern.test(page.url())) {
      return true;
    }

    const dashboardVisible = await dashboardHeading.isVisible().catch(() => false);
    const signOutVisible = await signOutButton.isVisible().catch(() => false);
    if (dashboardVisible || signOutVisible) {
      return true;
    }

    const hasAccessTokenCookie = await page
      .evaluate(() => document.cookie.includes('accessToken='))
      .catch(() => false);

    if (hasAccessTokenCookie && /\/login(?:[/?#]|$)/.test(page.url())) {
      await page.goto(dashboardUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      }).catch(() => null);
    }

    await sleep(1000);
  }

  return false;
}

export async function loginToAdminDashboard(
  page,
  credentials = getPlastypesaPersona('admin').credentials,
  options = {},
) {
  const baseURL = options.baseURL || getAdminBaseUrl();
  await page.goto(new URL('/login', baseURL).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.getByTestId('admin-login-email').fill(credentials.email);
  await page.getByTestId('admin-login-password').fill(credentials.password);
  await page.getByTestId('admin-login-submit').click();
  const dashboardReady = await waitForDashboardReady(page, baseURL);
  if (!dashboardReady) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Admin login did not reach dashboard. URL=${page.url()} body=${bodyText.slice(0, 240)}`,
    );
  }
  rememberPersonaSession(options.personaName || 'admin', {
    baseURL,
    lastRoute: '/dashboard',
    lastLoginAt: new Date().toISOString(),
  });
  return credentials;
}

export async function adminApi(page, path, options = {}) {
  const token = await page.evaluate(() => {
    const encoded = document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('accessToken='))
      ?.split('=')
      .slice(1)
      .join('=') || '';
    const decoded = decodeURIComponent(encoded);
    // react-cookie JSON-serializes strings in document.cookie. Browser hooks
    // deserialize them automatically; this direct API helper must do the same.
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  });
  const apiBase = String(options.baseURL || getAdminApiBaseUrl()).replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${apiBase}${normalizedPath}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let json;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

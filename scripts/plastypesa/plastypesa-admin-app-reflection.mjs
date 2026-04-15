#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { loadMobileAppUserCredentials } from './credential-registry.mjs';
import {
  adminApi,
  ensureAdminWebServer,
  getAdminBaseUrl,
  killAdminWebServer,
  launchAdminBrowser,
  loginToAdminDashboard,
} from './admin-dashboard-session.mjs';
import {
  NEOXTEN_ROOT,
  defaultAdminFrontendRoot,
  getLocalizationOutDir,
  writeJson,
  writeText,
} from './localization/config.mjs';

const TARGET_LANGUAGE = (process.env.PLASTYPESA_ADMIN_APP_REFLECTION_LANGUAGE || 'ro').trim();
const ALLOW_MUTATION =
  process.env.PLASTYPESA_ADMIN_APP_REFLECTION_ALLOW_MUTATION === '1';

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function toDatetimeLocalValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createCampaignPayload() {
  const marker = `${Date.now()}`.slice(-6);
  const campaignId =
    process.env.PLASTYPESA_ADMIN_APP_REFLECTION_CAMPAIGN_ID ||
    `neoxten-reflection-${marker}`;
  const title =
    process.env.PLASTYPESA_ADMIN_APP_REFLECTION_TITLE ||
    `NeoXten reflection ${marker}`;
  const message =
    process.env.PLASTYPESA_ADMIN_APP_REFLECTION_MESSAGE ||
    `Confirm app banner sync ${marker}`;
  const endsAt = new Date(Date.now() + 10 * 60 * 1000);
  return {
    campaignId,
    title,
    message,
    endsAt,
    bannerScope: 'main_shell',
    bannerPosition: 'top',
    bannerStyle: 'standard',
    bannerDurationSec: 120,
  };
}

function buildExpectedLocalizedCopy(config, fallback) {
  const translations = config?.translations || {};
  const localized = translations[TARGET_LANGUAGE] || translations.en || {};
  return {
    title: localized.title || fallback.title,
    message: localized.message || fallback.message,
  };
}

async function fetchMobileUserLocalizedBanner(fallback) {
  try {
    const cfg = getConfig();
    const { email, password } = loadMobileAppUserCredentials();
    const loginResponse = await fetch(url(cfg, '/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginJson = await loginResponse.json().catch(() => null);
    const token = loginJson?.token;
    if (!loginResponse.ok || !token) {
      return fallback;
    }

    const bannerResponse = await fetch(url(cfg, '/home/active-in-app-banner'), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const bannerJson = await bannerResponse.json().catch(() => null);
    const banner = bannerJson?.data?.banner;
    if (!bannerResponse.ok || !banner) {
      return fallback;
    }

    return {
      title: banner.title || fallback.title,
      message: banner.message || fallback.message,
    };
  } catch {
    return fallback;
  }
}

function renderMarkdown(report) {
  const lines = [
    '# PlastyPesa Admin-App Reflection',
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Result: ${report.result}`,
    `Target language: ${report.targetLanguage}`,
    `Campaign ID: ${report.campaignId}`,
    '',
    '## Steps',
    ...report.steps.map((step) => {
      const detail = step.detail ? ` - ${step.detail}` : '';
      return `- ${step.action}: ${step.ok ? 'ok' : 'failed'}${detail}`;
    }),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function recordStep(report, action, ok, detail = '') {
  report.steps.push({
    at: new Date().toISOString(),
    action,
    ok,
    detail,
  });
  if (!ok) {
    report.result = 'FAIL';
  }
}

async function waitForPinnedConfig(page, campaignId) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await adminApi(page, '/api/admin/active-in-app-banner');
    const config = response?.json?.data?.config;
    if (response.ok && config?.inAppBanner?.bannerId === campaignId) {
      return config;
    }
    await sleep(1000);
  }
  return null;
}

async function configurePinnedBanner(page, payload, report) {
  await page.goto(new URL('/announcements', getAdminBaseUrl()).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  const panel = page
    .locator('div.bg-card')
    .filter({
      has: page.getByRole('heading', { name: /Pinned in-app banner/i }),
    })
    .first();
  await panel.getByText(/Status:/).waitFor({ state: 'visible', timeout: 45000 });

  await panel.getByPlaceholder('Pinned title').fill(payload.title);
  await panel.getByPlaceholder('Pinned message').fill(payload.message);
  await panel.getByLabel('Use fixed end date/time (local)').check();
  await panel.locator('input[type="datetime-local"]').fill(
    toDatetimeLocalValue(payload.endsAt),
  );
  await panel
    .getByLabel('Banner on-screen max (seconds)')
    .fill(String(payload.bannerDurationSec));
  await panel.getByLabel('Campaign ID (optional)').fill(payload.campaignId);
  await panel.getByRole('button', { name: 'Main shell', exact: true }).click();
  await panel.getByRole('button', { name: 'Top', exact: true }).click();
  await panel.getByRole('button', { name: 'Standard', exact: true }).click();
  const saveResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes('/api/admin/active-in-app-banner') &&
      response.request().method() === 'PUT'
    );
  }, { timeout: 45000 }).catch(() => null);
  await panel.getByRole('button', { name: 'Save pinned banner' }).click();

  let config = null;
  const saveResponse = await saveResponsePromise;
  if (saveResponse) {
    try {
      const body = await saveResponse.json();
      config = body?.data?.config || null;
    } catch {
      config = null;
    }
  }
  if (!config) {
    config = await waitForPinnedConfig(page, payload.campaignId);
  }
  recordStep(
    report,
    'save-pinned-banner',
    Boolean(config),
    config ? 'dashboard update confirmed' : 'pinned banner config not observed',
  );
  return config;
}

async function clearPinnedBanner(page, report) {
  await page.goto(new URL('/announcements', getAdminBaseUrl()).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  const panel = page
    .locator('div.bg-card')
    .filter({
      has: page.getByRole('heading', { name: /Pinned in-app banner/i }),
    })
    .first();
  await panel.getByText(/Status:/).waitFor({ state: 'visible', timeout: 45000 });
  const clearResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes('/api/admin/active-in-app-banner') &&
      response.request().method() === 'DELETE'
    );
  }, { timeout: 45000 }).catch(() => null);
  await panel.getByRole('button', { name: 'Clear pinned' }).click();
  const clearResponse = await clearResponsePromise;
  let ok = Boolean(clearResponse?.ok());
  try {
    await panel.getByText(/Status:\s*Inactive/).waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    ok = false;
  }
  recordStep(
    report,
    'clear-pinned-banner',
    ok,
    ok ? 'cleanup confirmed' : 'cleanup request failed',
  );
}

function runMobileBannerVerification(expected, report) {
  const script = resolve(
    NEOXTEN_ROOT,
    'scripts/plastypesa/localization/mobile-visible-adb.mjs',
  );
  const result = spawnSync(process.execPath, [script], {
    cwd: NEOXTEN_ROOT,
    env: {
      ...process.env,
      PLASTYPESA_LOCALIZATION_ADB_LANGUAGE_NAME:
        process.env.PLASTYPESA_LOCALIZATION_ADB_LANGUAGE_NAME || 'Română',
                  PLASTYPESA_LOCALIZATION_ADB_FORCE_INSTALL:
                    process.env.PLASTYPESA_LOCALIZATION_ADB_FORCE_INSTALL || '0',
      PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_TITLE: expected.title,
      PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_MESSAGE: expected.message,
      PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_TIMEOUT_MS:
        process.env.PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_TIMEOUT_MS || '30000',
    },
    stdio: 'inherit',
  });
  const ok = (result.status ?? 1) === 0;
  recordStep(
    report,
    'verify-mobile-banner',
    ok,
    ok ? 'mobile visible walkthrough matched expected banner' : 'mobile verification failed',
  );
  return ok;
}

async function main() {
  bootstrapPlastyPesaEnv();

  const outDir = getLocalizationOutDir();
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: 'PASS',
    targetLanguage: TARGET_LANGUAGE,
    personas: ['admin', 'mobileUser'],
    campaignId: '',
    steps: [],
  };

  if (!ALLOW_MUTATION) {
    recordStep(
      report,
      'mutation-gate',
      false,
      'set PLASTYPESA_ADMIN_APP_REFLECTION_ALLOW_MUTATION=1 to allow live pinned-banner mutation',
    );
    report.finishedAt = new Date().toISOString();
    writeJson(resolve(outDir, 'admin-app-reflection.json'), report);
    writeText(resolve(outDir, 'admin-app-reflection.md'), renderMarkdown(report));
    process.exit(1);
  }

  const payload = createCampaignPayload();
  report.campaignId = payload.campaignId;

  const server = await ensureAdminWebServer();
  const { browser, context, page } = await launchAdminBrowser();
  let config = null;
  let runError = null;

  try {
    await loginToAdminDashboard(page, undefined, { personaName: 'admin' });
    recordStep(report, 'login-admin-dashboard', true);

    config = await configurePinnedBanner(page, payload, report);
    if (config) {
      report.backendBannerConfig = config;
      const translatedExpected = buildExpectedLocalizedCopy(config, payload);
      const expected = await fetchMobileUserLocalizedBanner(translatedExpected);
      report.expectedTitle = expected.title;
      report.expectedMessage = expected.message;
      runMobileBannerVerification(expected, report);
    }
  } catch (error) {
    runError = error;
    recordStep(
      report,
      'reflection-run',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (config) {
      await clearPinnedBanner(page, report);
    }
    await context.close();
    await browser.close();
    killAdminWebServer(server.child);
  }

  report.finishedAt = new Date().toISOString();
  writeJson(resolve(outDir, 'admin-app-reflection.json'), report);
  writeText(resolve(outDir, 'admin-app-reflection.md'), renderMarkdown(report));
  console.log(`[plastypesa-reflection] Report written to ${outDir}`);
  if (runError) {
    process.exit(1);
  }
  process.exit(report.result === 'PASS' ? 0 : 1);
}

await main();

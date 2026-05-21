#!/usr/bin/env node
/**
 * Post-P8 launch certification: production admin route walk.
 *
 * Visits every protected admin route that should render for launch and records
 * body snippets plus browser console/page errors. This complements the older
 * P0 route smoke, which only covered the first Wave-0 routes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import {
  launchAdminBrowser,
  loginToAdminDashboard,
} from './admin-dashboard-session.mjs';

const BASE = (process.env.PLASTYPESA_ADMIN_BASE_URL || 'https://plastypesa.com').replace(
  /\/$/,
  '',
);

const ROUTES = [
  { path: '/dashboard', name: 'Dashboard', expect: /dashboard|analytics|users|overview/i },
  { path: '/users', name: 'Users', expect: /user|email|country|status/i },
  { path: '/stores', name: 'Stores', expect: /store|address|country|status/i },
  { path: '/groups', name: 'Groups', expect: /group|challenge|member|invite|founder/i },
  { path: '/feedback', name: 'Feedback', expect: /feedback|open|acknowledged|message/i },
  { path: '/reward-coverage', name: 'Reward Coverage', expect: /reward|coverage|country|tremendous/i },
  { path: '/sort-proof-review', name: 'Sort Proof Review', expect: /sort|proof|review|queue|trusted/i },
  { path: '/eco-catalog', name: 'Eco Catalog', expect: /catalog|material|action|PET|HDPE|circular/i },
  { path: '/eco-scan-qa', name: 'Eco Scan QA', expect: /eco scan|qa|recognition|rollout|sampling/i },
  { path: '/learning-modules', name: 'Learning Modules', expect: /learning|module|sponsored|category/i },
  { path: '/b2b-tokens', name: 'B2B Tokens', expect: /b2b|token|partner|last/i },
  { path: '/b2b-impact', name: 'B2B Impact Export', expect: /impact|export|csv|material|region/i },
  { path: '/community-moderation', name: 'Community Moderation', expect: /community|moderation|post|report/i },
  { path: '/weekly-rewards', name: 'Weekly Rewards', expect: /weekly|reward|leaderboard|tremendous/i },
  { path: '/announcements', name: 'Announcements', expect: /announcement|banner|notification|campaign/i },
  { path: '/automation', name: 'Automation', expect: /automation|content|queue|quiz|draft/i },
  { path: '/settings', name: 'Settings', expect: /settings|profile|password|account/i },
  { path: '/academy', name: 'Academy', expect: /academy|game|quiz|create|schedule/i },
  { path: '/draw-campaigns', name: 'Draw Campaigns', expect: /campaign|draw|legal|approval|reward/i },
];

function outPath() {
  const dir = resolve(process.cwd(), '.neoxten-out');
  mkdirSync(dir, { recursive: true });
  return resolve(dir, `plastypesa-launch-admin-${Date.now()}.json`);
}

async function checkRoute(page, route, browserErrors) {
  const url = `${BASE}${route.path}`;
  const errors = [];
  const warnings = [];
  const beforeErrors = browserErrors.length;
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    await page.waitForTimeout(2500);
    const status = response?.status() ?? 0;
    const currentUrl = page.url();
    let body = (await page.locator('body').innerText().catch(() => '')).slice(0, 10_000);
    if (body.length < 80) {
      await page.waitForTimeout(6000);
      body = (await page.locator('body').innerText().catch(() => '')).slice(0, 10_000);
    }
    if (/\/login(?:[/?#]|$)/.test(currentUrl)) errors.push('redirected to login');
    if (status >= 500) errors.push(`HTTP ${status}`);
    if (body.length < 80) errors.push('empty or tiny body');
    if (!route.expect.test(body)) errors.push(`expected text not found: ${route.expect}`);
    if (/not found|404|something went wrong/i.test(body) && !route.expect.test(body)) {
      errors.push('possible error page');
    }
    const newBrowserErrors = browserErrors.slice(beforeErrors);
    const pageErrors = newBrowserErrors.filter((entry) => entry.type === 'pageerror');
    const resourceErrors = newBrowserErrors.filter((entry) => entry.type !== 'pageerror');
    const severeErrors = pageErrors.filter((entry) => !/favicon|ResizeObserver/i.test(entry.message));
    if (severeErrors.length) {
      errors.push(`browser page errors: ${severeErrors.map((entry) => entry.message).slice(0, 3).join(' | ')}`);
    }
    if (resourceErrors.length) {
      warnings.push(
        `browser resource warnings: ${resourceErrors
          .map((entry) => entry.message)
          .slice(0, 5)
          .join(' | ')}`,
      );
    }
    return {
      ...route,
      url: currentUrl,
      status,
      pass: errors.length === 0,
      errors,
      warnings,
      snippet: body.replace(/\s+/g, ' ').slice(0, 220),
    };
  } catch (err) {
    return {
      ...route,
      url: page.url(),
      pass: false,
      errors: [err?.message || String(err)],
      warnings,
      snippet: '',
    };
  }
}

async function main() {
  bootstrapPlastyPesaEnv();
  const browserErrors = [];
  const { browser, page } = await launchAdminBrowser({ headless: true });
  page.on('pageerror', (error) => browserErrors.push({ type: 'pageerror', message: error.message }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') browserErrors.push({ type: 'console', message: msg.text() });
  });

  const results = [];
  try {
    await loginToAdminDashboard(page, undefined, { baseURL: BASE });
    console.log('[launch-admin] Logged in to', BASE);
    for (const route of ROUTES) {
      const result = await checkRoute(page, route, browserErrors);
      results.push(result);
      console.log(
        `  ${result.pass ? 'PASS' : 'FAIL'}  ${result.name} (${result.path})${
          result.errors.length ? ` — ${result.errors.join('; ')}` : ''
        }${result.warnings?.length ? ` [warn: ${result.warnings.length}]` : ''}`,
      );
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((entry) => !entry.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    total: results.length,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
  };
  const path = outPath();
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[launch-admin] Report: ${path}`);
  console.log(`[launch-admin] ${report.pass} pass, ${report.fail} fail`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[launch-admin]', err);
  process.exit(1);
});

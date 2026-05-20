#!/usr/bin/env node
/**
 * P0 — Production admin Wave-0 route walk (https://plastypesa.com).
 * Uses ALL CREDENTIALS via credential-registry (admin login file).
 */
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
  { path: '/groups', name: 'Groups', expect: /group|member|invite|founder/i },
  { path: '/feedback', name: 'User Feedback', expect: /feedback|open|acknowledged/i },
  { path: '/reward-coverage', name: 'Reward Coverage', expect: /reward|coverage|tremendous|country/i },
  {
    path: '/sort-proof-review',
    name: 'Sort proof (CAR)',
    expect: /sort|review|queue|proof/i,
  },
  { path: '/announcements', name: 'Announcements', expect: /announcement|campaign|banner/i },
  {
    path: '/automation',
    name: 'Automation / Content Queue',
    expect: /automation|content|queue|quiz|draft/i,
  },
];

async function checkRoute(page, route) {
  const url = `${BASE}${route.path}`;
  const errors = [];
  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    await page.waitForTimeout(4000);
    const status = response?.status() ?? 0;
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 8000);
    const onLogin = /\/login/.test(page.url());
    if (onLogin) {
      errors.push('redirected to login');
    }
    if (status >= 500) {
      errors.push(`HTTP ${status}`);
    }
    if (body.match(/not found|404|something went wrong/i) && !route.expect.test(body)) {
      errors.push('possible error page');
    }
    if (!route.expect.test(body) && body.length < 80) {
      errors.push('empty or tiny body');
    }
    return {
      name: route.name,
      path: route.path,
      url: page.url(),
      status,
      pass: errors.length === 0,
      errors,
      snippet: body.replace(/\s+/g, ' ').slice(0, 120),
    };
  } catch (err) {
    return {
      name: route.name,
      path: route.path,
      url: page.url(),
      pass: false,
      errors: [err.message],
      snippet: '',
    };
  }
}

async function main() {
  bootstrapPlastyPesaEnv();
  const { browser, page } = await launchAdminBrowser({ headless: true });
  const results = [];
  try {
    await loginToAdminDashboard(page, undefined, { baseURL: BASE });
    console.log('[p0-admin] Logged in to', BASE);
    for (const route of ROUTES) {
      const r = await checkRoute(page, route);
      results.push(r);
      const mark = r.pass ? 'PASS' : 'FAIL';
      console.log(`  ${mark}  ${r.name} (${r.path}) ${r.errors.length ? '— ' + r.errors.join('; ') : ''}`);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== P0 admin Wave-0 walk ===');
  console.log(`  ${results.length - failed.length} pass, ${failed.length} fail`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[p0-admin]', err);
  process.exit(1);
});

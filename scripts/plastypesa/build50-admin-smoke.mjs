#!/usr/bin/env node
/**
 * BUILD 50 — logged-in admin smoke against production dashboard.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { loadAdminDashboardCredentials } from './credential-registry.mjs';

const OUT = path.join(process.cwd(), '.neoxten-out', 'build50-admin-smoke');
const BASE = process.env.PLASTYPESA_ADMIN_PROD_URL || 'https://plastypesa.com';
const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  bootstrapPlastyPesaEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const admin = loadAdminDashboardCredentials();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    record('login page loads', page.url().includes('login') || page.url().includes(BASE));

    await page.getByLabel(/email/i).first().fill(admin.email);
    await page.getByLabel(/password/i).first().fill(admin.password);
    await page.getByRole('button', { name: /sign in|login/i }).first().click();

    await page.waitForURL(/dashboard/, { timeout: 45000 });
    record('admin dashboard reached', /dashboard/.test(page.url()));

    await page.waitForTimeout(3500);
    const bodyText = await page.locator('body').innerText();
    fs.writeFileSync(path.join(OUT, 'dashboard-text.txt'), bodyText, 'utf8');
    await page.screenshot({ path: path.join(OUT, 'dashboard.png'), fullPage: true });

    record(
      'ops alert banner visible',
      /action required|sort proof|community|trust|ops/i.test(bodyText),
    );

    const bell = page.locator('[aria-label*="alert" i], [aria-label*="notification" i], button:has(svg)').first();
    if (await bell.count()) {
      await bell.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const panelText = await page.locator('body').innerText();
      record('AI alert bell opens panel', /alert|automation|quiz|content|medium|high/i.test(panelText));
    } else {
      record('AI alert bell present', false, 'bell selector not found');
    }

    await page.goto(`${BASE}/dashboard/community-moderation`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);
    const modText = await page.locator('body').innerText();
    record('community moderation route loads', /community|moderation|flagged|posts/i.test(modText));

    await page.goto(`${BASE}/dashboard/trust-integrity`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);
    const trustText = await page.locator('body').innerText();
    record('trust integrity route loads', /trust|integrity|case|fraud/i.test(trustText));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'build50-admin-smoke.json'), JSON.stringify(report, null, 2));
  console.log(`\n[build50-admin] ${report.pass} pass, ${report.fail} fail → ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[build50-admin]', err);
  process.exit(2);
});

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adminApi,
  ensureAdminWebServer,
  getAdminBaseUrl,
  killAdminWebServer,
  launchAdminBrowser,
  loginToAdminDashboard,
} from './admin-dashboard-session.mjs';

const results = [];
function pass(name) {
  results.push({ name, status: 'PASS' });
  console.log(`  PASS  ${name}`);
}
function fail(name, error) {
  results.push({ name, status: 'FAIL', error: error.message });
  console.error(`  FAIL  ${name}: ${error.message}`);
}
async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseURL = getAdminBaseUrl();
const server = await ensureAdminWebServer();
const { browser, page } = await launchAdminBrowser({ headless: true });
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  await loginToAdminDashboard(page);
  await page.goto(new URL('/market-rewards', baseURL).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.getByText('Market Reward Operations', { exact: true }).waitFor({
    state: 'visible',
    timeout: 45000,
  });

  await check('kenya_lane_exact_schedule', async () => {
    await page.getByText('Market configuration', { exact: true }).waitFor({
      state: 'visible',
      timeout: 45000,
    });
    const body = await page.locator('body').innerText();
    assert(body.includes('Kenya'), 'Kenya lane missing');
    assert(body.includes('KES') && body.includes('10,000'), 'KES 10,000 total missing');
    assert(body.includes('Ranks 4–10'), 'rank 4-10 band missing');
    const values = await page.locator('input[type="number"]').evaluateAll((nodes) =>
      nodes.map((node) => Number(node.value)),
    );
    assert(
      JSON.stringify(values.slice(0, 4)) === JSON.stringify([4500, 2500, 1600, 200]),
      `schedule inputs mismatch: ${JSON.stringify(values)}`,
    );
    assert(body.includes('CASH OFF'), 'Kenya cash must remain off before funded rehearsal');
  });

  await check('europe_lane_isolated_recognition_only', async () => {
    await page.getByRole('button', { name: /Europe/ }).click();
    await page.getByText('Europe remains recognition-only unless independently approved.', {
      exact: true,
    }).waitFor({
      state: 'visible',
      timeout: 45000,
    });
    const body = await page.locator('body').innerText();
    assert(body.includes('RECOGNITION ONLY'), 'Europe recognition-only status missing');
    assert(body.includes('Europe remains recognition-only'), 'Europe activation guard copy missing');
    const weeklyMetric = await page
      .getByText('Weekly schedule', { exact: true })
      .locator('..')
      .innerText();
    assert(!weeklyMetric.includes('KES'), `Kenya currency leaked into Europe metric: ${weeklyMetric}`);
  });

  await check('admin_reconciliation_endpoint', async () => {
    const response = await adminApi(
      page,
      '/api/market-rewards/admin/reconciliation?marketCode=EU',
    );
    assert(response.status === 200, `reconciliation HTTP ${response.status}`);
    assert(
      typeof response.json?.data?.balanced === 'boolean',
      'reconciliation balanced flag missing',
    );
    assert(Array.isArray(response.json?.data?.anomalies), 'reconciliation anomalies missing');
  });

  await check('owner_operations_visible', async () => {
    for (const label of [
      'Market configuration',
      'Weekly closes',
      'Claims & payouts',
      'Disputes & reconciliation',
    ]) {
      assert(await page.getByText(label, { exact: true }).isVisible(), `${label} tab missing`);
    }
  });

  await check('reconciliation_export_is_real_csv', async () => {
    await page.getByText('Disputes & reconciliation', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
    await page.getByTestId('reward-reconciliation-export').click();
    const download = await downloadPromise;
    const filePath = await download.path();
    assert(filePath, 'browser did not persist the reconciliation download');
    const content = readFileSync(filePath, 'utf8');
    assert(
      content.startsWith('"marketCode","weekStart","slot","rank","claimStatus"'),
      `unexpected export content: ${content.slice(0, 100)}`,
    );
    assert(!/<html|<!doctype/i.test(content), 'export downloaded the SPA HTML shell');
  });

  mkdirSync(resolve('artifacts'), { recursive: true });
  await page.screenshot({
    path: resolve('artifacts/plastypesa-market-rewards-admin.png'),
    fullPage: true,
  });

  await check('no_market_page_console_errors', async () => {
    const relevant = consoleErrors.filter(
      (line) => !/favicon|third-party cookie|browserslist/i.test(line),
    );
    assert(relevant.length === 0, relevant.join(' | '));
  });
} finally {
  await browser.close();
  killAdminWebServer(server.child);
}

const passed = results.filter((item) => item.status === 'PASS').length;
const failed = results.filter((item) => item.status === 'FAIL').length;
console.log(`\nMarket Rewards Admin: ${passed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);

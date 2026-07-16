import { mkdirSync, writeFileSync } from 'node:fs';
import {
  getAdminBaseUrl,
  launchAdminBrowser,
  loginToAdminDashboard,
} from './admin-dashboard-session.mjs';

const baseURL = getAdminBaseUrl();
const outDir = '.neoxten-out/plastypesa-admin-settings-batch';
mkdirSync(outDir, { recursive: true });

const { browser, page } = await launchAdminBrowser({ headless: true });
const requests = [];
const consoleErrors = [];
const pageErrors = [];

page.on('request', (request) => {
  const url = request.url();
  if (/\/api\/master(?:\/batch|\?)/.test(url)) {
    requests.push({ method: request.method(), url });
  }
});
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

let report;
try {
  await loginToAdminDashboard(page, undefined, { baseURL });
  await page.goto(new URL('/settings', baseURL).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page
    .getByText('Plan 2 Economy (admin overrides)', { exact: true })
    .waitFor({ state: 'visible', timeout: 60000 });
  await page
    .getByText('Referral Points', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 60000 });

  await page.waitForTimeout(5000);
  await page.screenshot({
    path: `${outDir}/settings-live.png`,
    fullPage: true,
  });

  const batchRequests = requests.filter(({ url }) => url.includes('/api/master/batch'));
  const individualRequests = requests.filter(({ url }) => /\/api\/master\?/.test(url));
  const expectedOneOffNames = new Set([
    'founders-voucher-start-at',
    'founders-timer-visible',
    'demo-videos',
    'impact-report-config',
  ]);
  const unexpectedIndividualRequests = individualRequests.filter(({ url }) => {
    const name = new URL(url).searchParams.get('name');
    return !expectedOneOffNames.has(name);
  });
  const failedBatchResponses = [];
  for (const request of batchRequests) {
    const response = await page.request.get(request.url, {
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => {
          const value = document.cookie
            .split(';')
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith('accessToken='))
            ?.split('=')
            .slice(1)
            .join('=') || '';
          const decoded = decodeURIComponent(value);
          try {
            return JSON.parse(decoded);
          } catch {
            return decoded;
          }
        })}`,
      },
    });
    if (!response.ok()) {
      failedBatchResponses.push({ url: request.url, status: response.status() });
    }
  }

  const errors = [];
  if (batchRequests.length !== 2) {
    errors.push(`expected exactly 2 batch requests, observed ${batchRequests.length}`);
  }
  if (unexpectedIndividualRequests.length > 0) {
    errors.push(
      `observed unexpected individual master requests: ${JSON.stringify(unexpectedIndividualRequests)}`,
    );
  }
  if (failedBatchResponses.length > 0) {
    errors.push(`batch endpoint failures: ${JSON.stringify(failedBatchResponses)}`);
  }
  if (consoleErrors.length > 0) {
    errors.push(`console errors: ${consoleErrors.join(' | ')}`);
  }
  if (pageErrors.length > 0) {
    errors.push(`page errors: ${pageErrors.join(' | ')}`);
  }

  report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    result: errors.length === 0 ? 'PASS' : 'FAIL',
    batchRequestCount: batchRequests.length,
    individualRequestCount: individualRequests.length,
    batchRequests,
    individualRequests,
    unexpectedIndividualRequests,
    failedBatchResponses,
    consoleErrors,
    pageErrors,
    errors,
  };
} catch (error) {
  report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    result: 'FAIL',
    requests,
    consoleErrors,
    pageErrors,
    errors: [error.message],
  };
} finally {
  await browser.close();
}

writeFileSync(`${outDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.result !== 'PASS') process.exitCode = 1;

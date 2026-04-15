#!/usr/bin/env node
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapPlastyPesaEnv } from '../env-bootstrap.mjs';
import { getAdminPlaywrightProcessEnv } from '../admin-playwright-env.mjs';
import {
  LOCALIZATION_GLOSSARY,
  PUBLIC_WEB_ROUTES,
  SUPPORTED_WEB_LANGUAGES,
  defaultAdminFrontendRoot,
  ensureDir,
  getLocalizationOutDir,
  pathForLocale,
  writeJson,
  writeText,
} from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LANGUAGE_NAMES = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  pt: 'Português',
  ro: 'Română',
};

function localePath(...parts) {
  return resolve(defaultAdminFrontendRoot(), 'public/locales', ...parts);
}

function readLocaleJson(lang, file) {
  return JSON.parse(readFileSync(localePath(lang, file), 'utf8'));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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

async function ensureWebServer(frontendRoot, baseURL) {
  if (process.env.PLASTYPESA_LOCALIZATION_WEBSERVER === '0') {
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

function killServer(child) {
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForMeaningfulBody(page, routeId) {
  await page.locator('body').waitFor({ state: 'visible', timeout: 45000 });

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const state = await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        readyState: document.readyState,
        textLength: text.length,
        hasStructuredContent: Boolean(
          document.querySelector('main, h1, h2, article, footer'),
        ),
      };
    });

    const ready =
      state.readyState === 'interactive' || state.readyState === 'complete';
    if (ready && (state.textLength > 80 || state.hasStructuredContent)) {
      return;
    }

    await sleep(500);
  }

  throw new Error(`Page content never became ready for ${routeId}`);
}

function renderMarkdown(report) {
  const lines = [
    '# PlastyPesa Web Localization Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Base URL: ${report.baseURL}`,
    '',
    '## Routes Audited',
    ...report.routesVisited.map((route) => `- ${route}`),
    '',
    '## Findings',
    ...report.findings.map((finding) => `- [${finding.severity.toUpperCase()}] ${finding.message} (\`${finding.path}\`)`),
    '',
    '## Screenshots',
    ...report.pages.map((page) => `- \`${page.id}\`: \`${page.screenshotPath}\``),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function collectPageReport(page, lang, route, screenshotsDir) {
  const urlPath = pathForLocale(route, lang);
  const url = new URL(urlPath, process.env.PLASTYPESA_ADMIN_BASE_URL || 'http://127.0.0.1:8080').toString();
  await page.goto(process.env.PLASTYPESA_ADMIN_BASE_URL || 'http://127.0.0.1:8080', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.evaluate((activeLang) => {
    if (activeLang === 'en') {
      localStorage.removeItem('plastypesa_lang');
      return;
    }
    localStorage.setItem('plastypesa_lang', activeLang);
  }, lang);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await waitForMeaningfulBody(page, `${lang}/${route.id}`);

  const bodyText = await page.locator('body').innerText();
  const htmlLang = await page.locator('html').getAttribute('lang');
  const metaDescriptions = await page.evaluate(() =>
    Array.from(document.querySelectorAll('meta[name="description"]'))
      .map((node) => node.getAttribute('content') || '')
      .filter(Boolean),
  );
  const metaDescription = metaDescriptions.at(-1) || null;
  const screenshotPath = resolve(screenshotsDir, `${lang}-${route.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const suspiciousTerms = lang === 'en'
    ? []
    : LOCALIZATION_GLOSSARY.suspiciousEnglishTerms.filter((term) =>
        bodyText.toLowerCase().includes(term.toLowerCase()) ||
        (metaDescription || '').toLowerCase().includes(term.toLowerCase()),
      );

  return {
    id: `${lang}-${route.id}`,
    routeId: route.id,
    lang,
    url,
    htmlLang,
    screenshotPath,
    metaDescriptions,
    metaDescription,
    suspiciousTerms,
    bodySample: bodyText.slice(0, 400),
  };
}

async function verifyLanguageSwitcher(page, baseURL) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: /Change language/i }).click();
  await page.getByRole('button', { name: LANGUAGE_NAMES.es, exact: true }).click();
  await page.waitForURL(/\/es\/?$/, { timeout: 30000 });
  return page.url();
}

async function main() {
  bootstrapPlastyPesaEnv();

  const frontendRoot = defaultAdminFrontendRoot();
  const outDir = getLocalizationOutDir();
  const screenshotsDir = ensureDir(resolve(outDir, 'web-screenshots'));
  const baseURL = process.env.PLASTYPESA_ADMIN_BASE_URL || 'http://127.0.0.1:8080';

  const server = await ensureWebServer(frontendRoot, baseURL);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    routesVisited: [],
    pages: [],
    findings: [],
    switcher: null,
    consoleMessages: [],
    networkFailures: [],
  };

  try {
    page.on('console', (message) => {
      const type = message.type();
      if (type === 'error' || type === 'warning') {
        report.consoleMessages.push({
          type,
          text: message.text(),
        });
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || 'requestfailed';
      if (failure.includes('ERR_ABORTED')) {
        return;
      }
      report.networkFailures.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure,
      });
    });

    try {
      report.switcher = await verifyLanguageSwitcher(page, baseURL);
    } catch (error) {
      report.findings.push({
        severity: 'high',
        path: 'switcher',
        message: `Language switcher verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }

    for (const lang of SUPPORTED_WEB_LANGUAGES) {
      for (const route of PUBLIC_WEB_ROUTES) {
        if (!route.localized && lang !== 'en') continue;
        let pageReport;
        try {
          pageReport = await collectPageReport(page, lang, route, screenshotsDir);
        } catch (error) {
          report.findings.push({
            severity: 'high',
            path: `${lang}/${route.id}`,
            message: `Route audit failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          continue;
        }
        report.routesVisited.push(pageReport.url);
        report.pages.push(pageReport);

        if (route.localized && pageReport.htmlLang && !pageReport.htmlLang.startsWith(lang)) {
          report.findings.push({
            severity: 'medium',
            path: `${lang}/${route.id}`,
            message: `HTML lang attribute mismatch for ${lang}: got "${pageReport.htmlLang}"`,
          });
        }
        if ((pageReport.metaDescriptions || []).length > 1) {
          report.findings.push({
            severity: 'medium',
            path: `${lang}/${route.id}`,
            message: `Multiple meta description tags detected (${pageReport.metaDescriptions.length})`,
          });
        }
        if (pageReport.suspiciousTerms.length > 0) {
          report.findings.push({
            severity: 'high',
            path: `${lang}/${route.id}`,
            message: `Suspicious English leakage detected: ${pageReport.suspiciousTerms.join(', ')}`,
          });
        }
      }
    }

    for (const failure of report.networkFailures) {
      if (!['document', 'fetch', 'xhr', 'script'].includes(failure.resourceType)) {
        continue;
      }
      report.findings.push({
        severity: 'high',
        path: 'network',
        message: `${failure.method} ${failure.url} failed (${failure.failure})`,
      });
    }

    for (const message of report.consoleMessages) {
      if (message.type !== 'error') {
        continue;
      }
      report.findings.push({
        severity: 'medium',
        path: 'console',
        message: message.text,
      });
    }
  } finally {
    await context.close();
    await browser.close();
    killServer(server.child);
  }

  writeJson(resolve(outDir, 'web-audit.json'), report);
  writeText(resolve(outDir, 'web-audit.md'), renderMarkdown(report));
  console.log(`[plastypesa-localization] Web audit written to ${outDir}`);
}

await main();

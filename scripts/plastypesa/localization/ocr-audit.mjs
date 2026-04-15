#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWorker } from 'tesseract.js';
import {
  LOCALIZATION_GLOSSARY,
  ensureDir,
  getLocalizationOutDir,
  writeJson,
  writeText,
} from './config.mjs';

const LANGUAGE_NAME_TO_CODE = {
  English: 'en',
  Italiano: 'it',
  'Español': 'es',
  Deutsch: 'de',
  'Français': 'fr',
  'Português': 'pt',
  'Română': 'ro',
};

const RENDERED_ENGLISH_UI_TERMS = [
  ...LOCALIZATION_GLOSSARY.suspiciousEnglishTerms,
  'privacy policy',
  'terms & conditions',
  'gdpr compliance',
  'download app',
  'select your language',
  'choose your preferred language to continue',
  'daily quiz',
  'back',
];

const LANDING_TERM_EQUIVALENTS = {
  'daily quiz': {
    it: ['quiz giornaliero'],
    es: ['quiz diario'],
    de: ['tagliches quiz'],
    fr: ['quiz quotidien'],
    pt: ['quiz diario'],
    ro: ['quiz zilnic'],
  },
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function listPngFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPngFiles(path));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      files.push(path);
    }
  }
  return files;
}

function safeReadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectTargets(outDir) {
  const targets = [];
  const seen = new Set();

  const webReport = safeReadJson(resolve(outDir, 'web-audit.json'));
  for (const page of webReport?.pages || []) {
    if (!page.screenshotPath || !existsSync(page.screenshotPath)) continue;
    seen.add(page.screenshotPath);
    targets.push({
      id: page.id,
      surface: 'web',
      expectedLang: page.lang || 'en',
      path: `${page.lang}/${page.routeId}`,
      screenshotPath: page.screenshotPath,
      context: page.url,
    });
  }

  const mobileReport = safeReadJson(resolve(outDir, 'mobile-adb-visible.json'));
  const mobileLang =
    LANGUAGE_NAME_TO_CODE[mobileReport?.targetLanguage] || mobileReport?.targetLanguage || 'en';
  const mobileStartedAtMs = Number.isFinite(Date.parse(mobileReport?.startedAt || ''))
    ? Date.parse(mobileReport?.startedAt || '')
    : 0;
  for (const filePath of listPngFiles(outDir)) {
    if (seen.has(filePath)) continue;
    const name = filePath.split(/[\\/]/).at(-1) || filePath;
    if (name.startsWith('verdict-')) continue;
    if (mobileStartedAtMs > 0) {
      try {
        if (statSync(filePath).mtimeMs + 1000 < mobileStartedAtMs) {
          continue;
        }
      } catch {
        continue;
      }
    }
    targets.push({
      id: name.replace(/\.png$/i, ''),
      surface: 'mobile',
      expectedLang: mobileLang,
      path: `mobile/${name}`,
      screenshotPath: filePath,
      context: mobileReport?.result || 'unknown',
    });
  }

  return targets.sort((left, right) => {
    try {
      return statSync(left.screenshotPath).mtimeMs - statSync(right.screenshotPath).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function buildFindings(target, extractedText, webPage = null) {
  const normalized = normalizeText(extractedText);
  const findings = [];
  if (!normalized) return findings;

  if (target.expectedLang !== 'en') {
    const suspiciousTerms = RENDERED_ENGLISH_UI_TERMS.filter((term) => {
      if (!normalized.includes(normalizeText(term))) {
        return false;
      }
      // DOM text is the stronger source of truth for rendered web copy.
      // If the web audit already saw a clean localized page, suppress OCR-only
      // landing hits that are likely caused by decorative assets or OCR drift.
      if (
        target.surface === 'web' &&
        webPage &&
        Array.isArray(webPage.suspiciousTerms) &&
        !webPage.suspiciousTerms.includes(term) &&
        target.path.endsWith('/landing')
      ) {
        return false;
      }
      if (target.path.endsWith('/landing')) {
        const equivalents =
          LANDING_TERM_EQUIVALENTS[term]?.[target.expectedLang] || [];
        if (equivalents.some((candidate) => normalized.includes(normalizeText(candidate)))) {
          return false;
        }
      }
      return true;
    });
    if (suspiciousTerms.length > 0) {
      findings.push({
        severity: 'high',
        type: 'english-leak',
        path: target.path,
        message: `Rendered UI still contains English terms: ${suspiciousTerms.join(', ')}`,
      });
    }
  }

  const forbiddenBrandTerms = LOCALIZATION_GLOSSARY.forbiddenBrandTerms.filter((term) =>
    normalized.includes(normalizeText(term)),
  );
  if (forbiddenBrandTerms.length > 0) {
    findings.push({
      severity: 'medium',
      type: 'forbidden-brand-term',
      path: target.path,
      message: `Rendered UI contains forbidden brand terms: ${forbiddenBrandTerms.join(', ')}`,
    });
  }

  const truncatedLines = extractedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('...') || line.endsWith('…'));
  if (truncatedLines.length >= 2) {
    findings.push({
      severity: 'medium',
      type: 'possible-truncation',
      path: target.path,
      message: `OCR saw ${truncatedLines.length} truncated-looking lines in the rendered UI`,
    });
  }

  const garbledTokens = extractedText.match(/[�]{1,}|[?]{3,}|[|]{3,}/g) || [];
  if (garbledTokens.length > 0) {
    findings.push({
      severity: 'medium',
      type: 'garbled-text',
      path: target.path,
      message: `OCR saw garbled-looking rendered text tokens: ${garbledTokens.join(', ')}`,
    });
  }

  return findings;
}

function renderMarkdown(report) {
  const lines = [
    '# PlastyPesa OCR Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Engine: ${report.engine}`,
    `Targets analyzed: ${report.targets.length}`,
    `Findings: ${report.findings.length}`,
    '',
    '## Findings',
    ...(report.findings.length
      ? report.findings.map(
          (finding) =>
            `- [${finding.severity.toUpperCase()}] ${finding.message} (\`${finding.path}\`)`,
        )
      : ['- none']),
    '',
    '## OCR Targets',
    ...report.targets.map(
      (target) =>
        `- \`${target.id}\` [${target.surface}] ${target.expectedLang} confidence=${target.confidence} text="${target.excerpt}"`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const outDir = getLocalizationOutDir();
  const targets = collectTargets(outDir);
  const webReport = safeReadJson(resolve(outDir, 'web-audit.json'));
  const webPageById = new Map((webReport?.pages || []).map((page) => [page.id, page]));
  const report = {
    generatedAt: new Date().toISOString(),
    engine: 'tesseract.js:eng',
    targets: [],
    findings: [],
  };

  if (targets.length === 0) {
    writeJson(resolve(outDir, 'ocr-audit.json'), report);
    writeText(resolve(outDir, 'ocr-audit.md'), renderMarkdown(report));
    console.log('[plastypesa-localization] OCR audit skipped because no PNG artifacts were found');
    return;
  }

  const worker = await createWorker('eng', 1, {
    cachePath: ensureDir(resolve(outDir, '.tesseract-cache')),
  });
  try {
    for (const target of targets) {
      const result = await worker.recognize(target.screenshotPath);
      const text = result?.data?.text || '';
      const confidence = Number(result?.data?.confidence || 0).toFixed(1);
      const findings = buildFindings(target, text, webPageById.get(target.id) || null);
      report.targets.push({
        ...target,
        confidence,
        wordCount: result?.data?.words?.length || 0,
        excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 160),
      });
      report.findings.push(...findings);
    }
  } finally {
    await worker.terminate();
  }

  writeJson(resolve(outDir, 'ocr-audit.json'), report);
  writeText(resolve(outDir, 'ocr-audit.md'), renderMarkdown(report));
  console.log(`[plastypesa-localization] OCR audit written to ${outDir}`);
  process.exit(report.findings.some((finding) => finding.severity === 'high') ? 1 : 0);
}

await main();

#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLocalizationOutDir, writeJson, writeText } from './config.mjs';

function safeReadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function pushFinding(report, severity, source, path, message) {
  const key = `${severity}|${source}|${path}|${message}`;
  if (report._seen.has(key)) {
    return;
  }
  report._seen.add(key);
  report.findings.push({ severity, source, path, message });
  if (severity === 'high' || severity === 'medium') {
    report.overall = 'FAIL';
  }
}

function requireFresh(report, source, evidence) {
  const timestamp = evidence?.generatedAt || evidence?.finishedAt || evidence?.startedAt;
  const ageMs = timestamp ? Date.now() - Date.parse(timestamp) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 6 * 60 * 60 * 1000) {
    pushFinding(
      report,
      'high',
      source,
      'generatedAt',
      `${source} evidence is missing a valid timestamp or is older than 6 hours`,
    );
  }
}

function renderMarkdown(report) {
  const lines = [
    '# PlastyPesa Evidence Verdict',
    '',
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.overall}`,
    '',
    '## Sources',
    ...report.sources.map((source) => `- \`${source.name}\`: ${source.status}`),
    '',
    '## Findings',
    ...(report.findings.length
      ? report.findings.map(
          (finding) =>
            `- [${finding.severity.toUpperCase()}] ${finding.message} (\`${finding.source}:${finding.path}\`)`,
        )
      : ['- none']),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function addSource(report, name, status) {
  report.sources.push({ name, status });
}

function main() {
  const outDir = getLocalizationOutDir();
  const report = {
    generatedAt: new Date().toISOString(),
    overall: 'PASS',
    sources: [],
    findings: [],
    _seen: new Set(),
  };

  const web = safeReadJson(resolve(outDir, 'web-audit.json'));
  if (web) {
    addSource(report, 'web-audit', 'loaded');
    requireFresh(report, 'web-audit', web);
    for (const finding of web.findings || []) {
      pushFinding(
        report,
        finding.severity === 'high' ? 'high' : 'medium',
        'web-audit',
        finding.path,
        finding.message,
      );
    }
    for (const msg of web.consoleMessages || []) {
      pushFinding(
        report,
        'medium',
        'web-console',
        'console',
        `${msg.type}: ${msg.text}`,
      );
    }
    for (const failure of web.networkFailures || []) {
      pushFinding(
        report,
        'medium',
        'web-network',
        failure.url,
        `Failed ${failure.method} request: ${failure.failure}`,
      );
    }
  } else {
    addSource(report, 'web-audit', 'missing');
    pushFinding(report, 'high', 'web-audit', 'source', 'Required web audit is missing');
  }

  const ocr = safeReadJson(resolve(outDir, 'ocr-audit.json'));
  if (ocr) {
    addSource(report, 'ocr-audit', 'loaded');
    requireFresh(report, 'ocr-audit', ocr);
    for (const finding of ocr.findings || []) {
      pushFinding(report, finding.severity, 'ocr-audit', finding.path, finding.message);
    }
  } else {
    addSource(report, 'ocr-audit', 'missing');
    pushFinding(report, 'high', 'ocr-audit', 'source', 'Required OCR audit is missing');
  }

  const mobile = safeReadJson(resolve(outDir, 'mobile-adb-visible.json'));
  if (mobile) {
    addSource(report, 'mobile-adb-visible', mobile.result || 'loaded');
    requireFresh(report, 'mobile-adb-visible', mobile);
    if (mobile.result && mobile.result !== 'PASS') {
      pushFinding(
        report,
        'high',
        'mobile-adb-visible',
        'result',
        `Visible mobile walkthrough failed with result ${mobile.result}`,
      );
    }
    if (mobile.result !== 'PASS') {
      for (const step of mobile.steps || []) {
        if (step.ok !== false) continue;
        pushFinding(
          report,
          'medium',
          'mobile-adb-visible',
          step.action,
          step.detail || `ADB step failed: ${step.action}`,
        );
      }
    }
  } else {
    addSource(report, 'mobile-adb-visible', 'missing');
    pushFinding(
      report,
      'high',
      'mobile-adb-visible',
      'source',
      'Required visible mobile walkthrough is missing',
    );
  }

  const reflectionEnabled =
    process.env.PLASTYPESA_LOCALIZATION_ENABLE_ADMIN_APP_REFLECTION === '1';
  const reflection = reflectionEnabled
    ? safeReadJson(resolve(outDir, 'admin-app-reflection.json'))
    : null;
  if (!reflectionEnabled) {
    addSource(report, 'admin-app-reflection', 'skipped');
  } else if (reflection) {
    addSource(report, 'admin-app-reflection', reflection.result || 'loaded');
    requireFresh(report, 'admin-app-reflection', reflection);
    if (reflection.result && reflection.result !== 'PASS') {
      pushFinding(
        report,
        'high',
        'admin-app-reflection',
        'result',
        `Admin-to-app reflection failed with result ${reflection.result}`,
      );
    }
  } else {
    addSource(report, 'admin-app-reflection', 'missing');
    pushFinding(
      report,
      'high',
      'admin-app-reflection',
      'source',
      'Admin-to-app reflection was enabled but its evidence is missing',
    );
  }

  const persistedReport = {
    generatedAt: report.generatedAt,
    overall: report.overall,
    sources: report.sources,
    findings: report.findings,
  };
  writeJson(resolve(outDir, 'evidence-verdict.json'), persistedReport);
  writeText(resolve(outDir, 'evidence-verdict.md'), renderMarkdown(persistedReport));
  console.log(`[plastypesa-localization] Evidence verdict written to ${outDir}`);
  process.exit(report.overall === 'PASS' ? 0 : 1);
}

main();

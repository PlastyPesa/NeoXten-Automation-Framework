#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import {
  LOCALIZATION_GLOSSARY,
  defaultAdminFrontendRoot,
  defaultMobileRoot,
  getLocalizationOutDir,
  writeJson,
  writeText,
} from './config.mjs';

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath, predicate));
      continue;
    }
    if (predicate(fullPath)) out.push(fullPath);
  }
  return out;
}

function flattenJson(value, prefix = '', out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenJson(item, prefix ? `${prefix}.${index}` : `${index}`, out);
    });
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix] = value;
  return out;
}

function parseJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseDartTranslations(path) {
  const text = readFileSync(path, 'utf8');
  const matches = [...text.matchAll(/^\s*'([^']+)'\s*:\s*/gm)];
  const keys = matches.map((match) => match[1]);
  return { keys, text };
}

function lineMatches(text, patterns) {
  const findings = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isCommentLikeLine(line)) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;
      const value = match[1]?.trim();
      if (!value) continue;
      if (pattern.filter && !pattern.filter(value, line)) continue;
      findings.push({
        line: index + 1,
        value,
        sourceLine: line.trim(),
      });
    }
  }
  return findings;
}

function isCommentLikeLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/') ||
    trimmed.startsWith('*')
  );
}

function normalizeCandidateText(value) {
  return value
    .replace(/\$\{[^}]+\}/g, ' ')
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, ' ')
    .replace(/\\n/g, ' ')
    .trim();
}

function isLikelyUserFacingLiteral(value) {
  const cleaned = normalizeCandidateText(value);
  if (!cleaned) return false;
  if (cleaned.includes('/') || cleaned.includes('assets/')) return false;
  if (/^[a-z0-9_.-]+$/i.test(cleaned) && !cleaned.includes(' ')) return false;
  return /[A-Za-z]{3}/.test(cleaned);
}

function extractQuotedLiterals(line) {
  return [...line.matchAll(/["'`](.+?)["'`]/g)].map((match) => match[1]).filter(Boolean);
}

function collectForbiddenTermHits(path, text) {
  const hits = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isCommentLikeLine(line)) continue;
    const literals = extractQuotedLiterals(line).filter(isLikelyUserFacingLiteral);
    for (const literal of literals) {
      for (const term of LOCALIZATION_GLOSSARY.forbiddenBrandTerms) {
        const regex = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        let match;
        while ((match = regex.exec(literal)) !== null) {
          hits.push({ path, line: index + 1, term, match: match[0] });
        }
      }
    }
  }
  return hits;
}

function hasAlphabeticWord(value) {
  return /[A-Za-z]{3}/.test(normalizeCandidateText(value));
}

function summarizeList(values, limit = 8) {
  return values.slice(0, limit).join(', ');
}

function renderMarkdown(report) {
  const lines = [
    '# PlastyPesa Static Localization Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Mobile locale files checked: ${report.mobile.localeFilesChecked}`,
    `- Web locale files checked: ${report.web.localeFilesChecked}`,
    `- Findings: ${report.summary.totalFindings}`,
    '',
    '## Summary',
    ...report.summary.byType.map((entry) => `- ${entry.type}: ${entry.count}`),
    '',
    '## Findings',
  ];

  for (const finding of report.findings) {
    lines.push(`- [${finding.severity.toUpperCase()}] ${finding.type}: ${finding.message}`);
    lines.push(`  Path: \`${finding.path}\``);
    if (finding.line) lines.push(`  Line: ${finding.line}`);
    if (finding.details) lines.push(`  Details: ${finding.details}`);
  }

  lines.push('', '## Notes', ...report.notes.map((note) => `- ${note}`), '');
  return `${lines.join('\n')}\n`;
}

function buildReport() {
  const adminFrontendRoot = defaultAdminFrontendRoot();
  const mobileRoot = defaultMobileRoot();
  const findings = [];

  const mobileTranslationDir = resolve(mobileRoot, 'lib/core/translations');
  const mobileTranslationFiles = walk(
    mobileTranslationDir,
    (path) => extname(path) === '.dart' && !path.endsWith('app_translations.dart'),
  );

  const mobileMaps = new Map();
  for (const file of mobileTranslationFiles) {
    mobileMaps.set(file, parseDartTranslations(file));
  }
  const englishFile = resolve(mobileTranslationDir, 'en.dart');
  const englishKeys = new Set(mobileMaps.get(englishFile)?.keys ?? []);
  for (const [file, info] of mobileMaps.entries()) {
    if (file === englishFile) continue;
    const localeKeys = new Set(info.keys);
    const missing = [...englishKeys].filter((key) => !localeKeys.has(key));
    const extra = [...localeKeys].filter((key) => !englishKeys.has(key));
    if (missing.length > 0) {
      findings.push({
        severity: 'high',
        type: 'mobile-missing-keys',
        path: relative(mobileRoot, file),
        message: `Missing ${missing.length} translation keys compared with en.dart`,
        details: summarizeList(missing),
      });
    }
    if (extra.length > 0) {
      findings.push({
        severity: 'medium',
        type: 'mobile-extra-keys',
        path: relative(mobileRoot, file),
        message: `Has ${extra.length} extra translation keys not present in en.dart`,
        details: summarizeList(extra),
      });
    }
  }

  const enText = mobileMaps.get(englishFile)?.text ?? '';
  if (enText.includes("'earn_50_pts': 'Earn 200 pts")) {
    findings.push({
      severity: 'high',
      type: 'source-english-mismatch',
      path: relative(mobileRoot, englishFile),
      message: 'Translation key earn_50_pts does not match its visible copy',
      details: "Key name says 50 pts while value says 'Earn 200 pts for each plastic avoidance action'",
    });
  }
  if (enText.includes("'learning_module_title': 'Deep Learning'")) {
    findings.push({
      severity: 'high',
      type: 'source-english-terminology',
      path: relative(mobileRoot, englishFile),
      message: "Source English uses 'Deep Learning' for eco lessons",
      details: 'This is likely to be interpreted as machine learning rather than educational modules.',
    });
  }
  if (enText.includes("'points_reward_lines_label': 'Reward lines'")) {
    findings.push({
      severity: 'medium',
      type: 'source-english-ux-copy',
      path: relative(mobileRoot, englishFile),
      message: "Source English label 'Reward lines' is unclear UX copy",
    });
  }

  const mobileUiFiles = walk(
    resolve(mobileRoot, 'lib'),
    (path) =>
      extname(path) === '.dart' &&
      !path.includes(`${mobileTranslationDir}`) &&
      !path.includes('/generated/') &&
      !path.includes('\\generated\\'),
  );
  const mobileUiPatterns = [
    {
      regex: /(?:const\s+)?Text\(\s*['"]([^'"]{3,})['"]/,
      filter: (value, line) =>
        hasAlphabeticWord(value) &&
        !line.includes('.tr') &&
        !/^(PlastyPesa|Poppins|support@plastypesa\.com|assets\/|https?:\/\/|QR code)$/i.test(value),
    },
    {
      regex: /hintText:\s*['"]([^'"]{3,})['"]/,
      filter: (value, line) => hasAlphabeticWord(value) && !line.includes('.tr'),
    },
    {
      regex: /labelTitle:\s*['"]([^'"]{3,})['"]/,
      filter: (value, line) => hasAlphabeticWord(value) && !line.includes('.tr'),
    },
    {
      regex: /showMessage\([^,]+,\s*['"]([^'"]{3,})['"]/,
      filter: (value, line) => hasAlphabeticWord(value) && !line.includes('.tr'),
    },
  ];
  for (const file of mobileUiFiles) {
    const text = readFileSync(file, 'utf8');
    const matches = lineMatches(text, mobileUiPatterns);
    for (const match of matches.slice(0, 8)) {
      findings.push({
        severity: 'high',
        type: 'mobile-hardcoded-ui-string',
        path: relative(mobileRoot, file),
        line: match.line,
        message: `Hardcoded user-facing string detected: "${match.value}"`,
      });
    }
    for (const hit of collectForbiddenTermHits(relative(mobileRoot, file), text)) {
      findings.push({
        severity: 'high',
        type: 'mobile-forbidden-brand-term',
        path: hit.path,
        line: hit.line,
        message: `Forbidden brand term detected: "${hit.match}"`,
      });
    }
  }

  const webLocalesRoot = resolve(adminFrontendRoot, 'public/locales');
  const webLocaleFiles = walk(webLocalesRoot, (path) => extname(path) === '.json');
  const englishNamespaceFiles = walk(resolve(webLocalesRoot, 'en'), (path) => extname(path) === '.json');
  const englishNamespaces = new Map();
  for (const file of englishNamespaceFiles) {
    englishNamespaces.set(relative(resolve(webLocalesRoot, 'en'), file), flattenJson(parseJson(file)));
  }

  for (const langDir of readdirSync(webLocalesRoot, { withFileTypes: true })) {
    if (!langDir.isDirectory() || langDir.name === 'en') continue;
    const langRoot = resolve(webLocalesRoot, langDir.name);
    for (const [namespaceFile, englishMap] of englishNamespaces.entries()) {
      const localizedFile = resolve(langRoot, namespaceFile);
      if (!statSafe(localizedFile)) {
        findings.push({
          severity: 'high',
          type: 'web-missing-namespace',
          path: relative(adminFrontendRoot, localizedFile),
          message: `Missing locale namespace ${namespaceFile} for ${langDir.name}`,
        });
        continue;
      }
      const localizedMap = flattenJson(parseJson(localizedFile));
      const missing = Object.keys(englishMap).filter((key) => !(key in localizedMap));
      if (missing.length > 0) {
        findings.push({
          severity: 'high',
          type: 'web-missing-keys',
          path: relative(adminFrontendRoot, localizedFile),
          message: `Missing ${missing.length} translation keys compared with en/${namespaceFile}`,
          details: summarizeList(missing),
        });
      }
      const localizedText = Object.values(localizedMap)
        .filter((value) => typeof value === 'string')
        .join('\n')
        .toLowerCase();
      const suspiciousHits = LOCALIZATION_GLOSSARY.suspiciousEnglishTerms.filter((term) =>
        localizedText.includes(term.toLowerCase()),
      );
      if (suspiciousHits.length > 0) {
        findings.push({
          severity: 'medium',
          type: 'web-suspicious-english-leak',
          path: relative(adminFrontendRoot, localizedFile),
          message: `Suspicious English product terms found in non-English locale`,
          details: summarizeList(suspiciousHits),
        });
      }
    }
  }

  const landingFiles = walk(
    resolve(adminFrontendRoot, 'src'),
    (path) =>
      ['.ts', '.tsx'].includes(extname(path)) &&
      (path.includes('LandingPage') || path.endsWith('SEOHead.tsx') || path.endsWith('LanguageSwitcher.tsx')),
  );
  const webUiPatterns = [
    {
      regex: /defaultValue:\s*["']([^"']{3,})["']/,
    },
    {
      regex: /aria-label=["']([^"']{3,})["']/,
    },
  ];
  const hardcodedWebTerms = [
    'Community Discussions',
    'Like',
    'Eco Pledge',
    'Plastic Scan',
    'Plastic Sorting',
    'Daily Quiz',
    'Eco Action',
    'Sorting Tips',
    'General',
    'pts',
  ];
  for (const file of landingFiles) {
    const text = readFileSync(file, 'utf8');
    const patternMatches = lineMatches(text, webUiPatterns);
    for (const match of patternMatches) {
      findings.push({
        severity: 'high',
        type: 'web-hardcoded-fallback',
        path: relative(adminFrontendRoot, file),
        line: match.line,
        message: `Hardcoded landing-page fallback string detected: "${match.value}"`,
      });
    }
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isCommentLikeLine(line)) continue;
      const literals = extractQuotedLiterals(line).filter(isLikelyUserFacingLiteral);
      for (const term of hardcodedWebTerms) {
        if (!literals.some((literal) => literal.includes(term))) continue;
        findings.push({
          severity: 'high',
          type: 'web-hardcoded-ui-string',
          path: relative(adminFrontendRoot, file),
          line: index + 1,
          message: `Hardcoded localized term candidate detected: "${term}"`,
        });
      }
    }
    for (const hit of collectForbiddenTermHits(relative(adminFrontendRoot, file), text)) {
      findings.push({
        severity: 'high',
        type: 'web-forbidden-brand-term',
        path: hit.path,
        line: hit.line,
        message: `Forbidden brand term detected: "${hit.match}"`,
      });
    }
  }

  const byType = Object.entries(
    findings.reduce((acc, finding) => {
      acc[finding.type] = (acc[finding.type] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    mobile: {
      localeFilesChecked: mobileTranslationFiles.length,
    },
    web: {
      localeFilesChecked: webLocaleFiles.length,
    },
    summary: {
      totalFindings: findings.length,
      byType,
    },
    findings,
    notes: [
      'This static audit is heuristic by design; it prioritizes high-signal localization leaks before runtime checks.',
      'Runtime browser and device audits should be used to confirm layout issues, API-driven English leakage, and tap-through coverage.',
    ],
  };
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

const report = buildReport();
const outDir = getLocalizationOutDir();

writeJson(resolve(outDir, 'static-audit.json'), report);
writeText(resolve(outDir, 'static-audit.md'), renderMarkdown(report));

console.log(`[plastypesa-localization] Static audit written to ${outDir}`);

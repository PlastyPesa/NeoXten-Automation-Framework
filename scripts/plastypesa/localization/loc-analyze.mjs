#!/usr/bin/env node
/**
 * PlastyPesa localization analyzer.
 *
 * Reads the per-screen / per-locale rendered-text dump produced by the Flutter
 * audit harness (`integration_test/localization_audit_test.dart` ->
 * `build/integration_test_results/loc-audit-report.json`) and diffs every string
 * against the canonical locale maps (`canonical-locales.json`, dumped from the
 * app's `lib/core/translations/*.dart`).
 *
 * It classifies each rendered string into the locked LOCALIZATION TRIAGE buckets:
 *   - missing-key     : the raw translation key is being rendered (no translation)
 *   - english-leak    : a non-EN screen shows the EN value where the locale differs
 *   - wrong-language  : a screen shows a DIFFERENT locale's value (mixed language)
 *   - truncation      : a rendered string is ellipsis-clipped
 * Strings that match no static locale value are treated as dynamic/user/CMS
 * content and are NOT flagged (per the triage rule).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalizationOutDir, writeJson, writeText } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../../..');

const CANONICAL_PATH =
  process.env.PLASTYPESA_LOC_CANONICAL ||
  resolve(__dirname, 'canonical-locales.json');

const REPORT_PATH =
  process.env.PLASTYPESA_LOC_REPORT ||
  resolve(
    NEOXTEN_ROOT,
    '../plastypesa-mobile-app/build/integration_test_results/loc-audit-report.json',
  );

function normalize(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Strings we never classify (numbers, symbols, single glyphs, pure punctuation).
function isIgnorable(raw) {
  const s = raw.trim();
  if (s.length < 2) return true;
  if (/^[\d\s.,:;+\-%°/|()#@*'"!?&·•…\u2013\u2014]+$/.test(s)) return true;
  // Pure emoji / flag sequences.
  if (/^[\p{Emoji}\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(s)) return true;
  return false;
}

function loadJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildIndex(locales) {
  // valueIndex[locale] = Map(normalizedValue -> Set(keys))
  const valueIndex = {};
  const valueSet = {};
  const keySet = new Set();
  for (const [code, map] of Object.entries(locales)) {
    const idx = new Map();
    const set = new Set();
    for (const [key, value] of Object.entries(map)) {
      keySet.add(key);
      const norm = normalize(value);
      if (!norm) continue;
      set.add(norm);
      if (!idx.has(norm)) idx.set(norm, new Set());
      idx.get(norm).add(key);
    }
    valueIndex[code] = idx;
    valueSet[code] = set;
  }
  return { valueIndex, valueSet, keySet };
}

function matchedLocales(valueSet, norm) {
  const out = [];
  for (const [code, set] of Object.entries(valueSet)) {
    if (set.has(norm)) out.push(code);
  }
  return out;
}

function shortLocale(code) {
  return (code || '').split('_')[0];
}

function main() {
  const locales = loadJson(CANONICAL_PATH, 'canonical-locales.json');
  const report = loadJson(REPORT_PATH, 'loc-audit-report.json');
  const { valueIndex, valueSet, keySet } = buildIndex(locales);
  const EN = 'en_US';

  const surfaces = Array.isArray(report.surfaces) ? report.surfaces : [];

  // Dedup findings by (type|locale|string); aggregate the screens they appear on.
  const findingMap = new Map();
  const addFinding = (type, severity, locale, screen, string, detail) => {
    const fkey = `${type}|${locale}|${normalize(string)}`;
    if (!findingMap.has(fkey)) {
      findingMap.set(fkey, {
        type,
        severity,
        locale,
        string,
        detail,
        screens: [],
      });
    }
    const f = findingMap.get(fkey);
    if (!f.screens.includes(screen)) f.screens.push(screen);
  };

  const coverage = {};
  let totalStrings = 0;

  for (const surface of surfaces) {
    const locale = surface.locale;
    const screen = surface.screen || 'unknown';
    const strings = Array.isArray(surface.strings) ? surface.strings : [];
    coverage[locale] = coverage[locale] || { screens: new Set(), strings: 0 };
    coverage[locale].screens.add(screen.split('#')[0]);
    coverage[locale].strings += strings.length;

    if (!valueSet[locale]) continue; // unknown locale code in report

    for (const raw of strings) {
      totalStrings += 1;
      const s = String(raw);

      // Truncation is independent of language.
      const t = s.trim();
      if (t.endsWith('…') || t.endsWith('...')) {
        addFinding('truncation', 'medium', locale, screen, t, 'ellipsis-clipped');
      }

      if (isIgnorable(s)) continue;

      // Raw translation key leaking to the UI.
      if (keySet.has(t)) {
        addFinding('missing-key', 'high', locale, screen, t, 'raw key rendered (no translation)');
        continue;
      }

      const norm = normalize(s);
      const matched = matchedLocales(valueSet, norm);
      if (matched.length === 0) continue; // dynamic / user / CMS content -> not flagged
      if (matched.includes(locale)) continue; // correct for this locale

      if (locale !== EN && matched.includes(EN)) {
        const keys = [...(valueIndex[EN].get(norm) || [])];
        const expected = keys
          .map((k) => locales[locale]?.[k])
          .filter(Boolean);
        addFinding(
          'english-leak',
          'high',
          locale,
          screen,
          t,
          `EN value shown; expected ${shortLocale(locale)}: ${
            expected.length ? JSON.stringify(expected[0]) : '(key: ' + (keys[0] || '?') + ')'
          }`,
        );
      } else {
        // Some other locale's value rendered on this locale's screen.
        const others = matched.filter((m) => m !== locale).map(shortLocale);
        const keys = [...(valueIndex[matched[0]].get(norm) || [])];
        const expected = keys.map((k) => locales[locale]?.[k]).filter(Boolean);
        addFinding(
          'wrong-language',
          'high',
          locale,
          screen,
          t,
          `shows ${others.join('/')} text; expected ${shortLocale(locale)}: ${
            expected.length ? JSON.stringify(expected[0]) : '(key: ' + (keys[0] || '?') + ')'
          }`,
        );
      }
    }
  }

  const findings = [...findingMap.values()].sort((a, b) => {
    const order = { 'wrong-language': 0, 'english-leak': 1, 'missing-key': 2, truncation: 3 };
    if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
    return a.locale.localeCompare(b.locale);
  });

  const counts = {};
  for (const f of findings) {
    counts[f.type] = counts[f.type] || {};
    counts[f.type][f.locale] = (counts[f.type][f.locale] || 0) + 1;
  }

  const out = {
    schema: 'plastypesa-loc-analyze-v1',
    generatedAt: new Date().toISOString(),
    reportPath: REPORT_PATH,
    canonicalPath: CANONICAL_PATH,
    totals: {
      surfaces: surfaces.length,
      strings: totalStrings,
      findings: findings.length,
    },
    coverage: Object.fromEntries(
      Object.entries(coverage).map(([k, v]) => [
        k,
        { screens: [...v.screens].sort(), stringCount: v.strings },
      ]),
    ),
    counts,
    findings,
  };

  const outDir = getLocalizationOutDir();
  writeJson(resolve(outDir, 'loc-analyze.json'), out);
  writeText(resolve(outDir, 'loc-analyze.md'), renderMarkdown(out));

  console.log(`[loc-analyze] ${findings.length} findings across ${surfaces.length} surfaces`);
  for (const [type, byLocale] of Object.entries(counts)) {
    const total = Object.values(byLocale).reduce((a, b) => a + b, 0);
    console.log(`  ${type}: ${total} (${Object.entries(byLocale).map(([l, n]) => `${shortLocale(l)}:${n}`).join(' ')})`);
  }
  console.log(`[loc-analyze] ledger -> ${resolve(outDir, 'loc-analyze.md')}`);

  const hasHigh = findings.some((f) => f.severity === 'high');
  process.exit(hasHigh ? 1 : 0);
}

function renderMarkdown(out) {
  const byType = {};
  for (const f of out.findings) {
    byType[f.type] = byType[f.type] || [];
    byType[f.type].push(f);
  }
  const lines = [
    '# PlastyPesa Localization Ledger',
    '',
    `Generated: ${out.generatedAt}`,
    `Surfaces: ${out.totals.surfaces} · Strings: ${out.totals.strings} · Findings: ${out.totals.findings}`,
    '',
    '## Coverage (locale -> screens / strings captured)',
    ...Object.entries(out.coverage).map(
      ([loc, c]) => `- \`${loc}\`: ${c.screens.length} screens, ${c.stringCount} strings (${c.screens.join(', ')})`,
    ),
    '',
  ];
  const titles = {
    'wrong-language': 'Wrong / mixed language (HIGH)',
    'english-leak': 'English leak on non-EN screen (HIGH)',
    'missing-key': 'Missing translation — raw key rendered (HIGH)',
    truncation: 'Possible truncation (MEDIUM)',
  };
  for (const type of ['wrong-language', 'english-leak', 'missing-key', 'truncation']) {
    const items = byType[type] || [];
    lines.push(`## ${titles[type]} — ${items.length}`, '');
    if (items.length === 0) {
      lines.push('- none', '');
      continue;
    }
    for (const f of items) {
      lines.push(
        `- [\`${f.locale}\`] "${f.string}" — ${f.detail}  _(screens: ${f.screens.slice(0, 6).join(', ')}${f.screens.length > 6 ? '…' : ''})_`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

main();

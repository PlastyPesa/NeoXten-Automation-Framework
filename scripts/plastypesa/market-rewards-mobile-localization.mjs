#!/usr/bin/env node
/**
 * Strict Phase 4 locale gate for the market-aware mobile experience.
 * Unlike the broad heuristic audit, this fails on any missing/empty key,
 * English leakage, or placeholder mismatch in the newly shipped surface.
 */
import { readFileSync } from 'node:fs';

const canonical = JSON.parse(
  readFileSync(
    new URL('./localization/canonical-locales.json', import.meta.url),
    'utf8',
  ),
);
const locales = ['en_US', 'it_IT', 'es_ES', 'de_DE', 'fr_FR', 'pt_PT', 'ro_RO'];
const english = canonical.en_US;
const keys = Object.keys(english).filter(
  (key) =>
    key.startsWith('market_') ||
    key === 'leaderboard_weekly_screen_subtitle_dynamic' ||
    key === 'leaderboard_showing_global_dynamic',
);
const placeholderSet = (value) =>
  [...String(value).matchAll(/@[A-Za-z0-9_]+/g)]
    .map((match) => match[0])
    .sort()
    .join(',');
const allowedEqual = new Set([
  'market_claim_mobile_number',
]);
const failures = [];

for (const locale of locales) {
  const values = canonical[locale] || {};
  for (const key of keys) {
    const value = String(values[key] || '').trim();
    if (!value) failures.push(`${locale}: missing/empty ${key}`);
    if (
      locale !== 'en_US' &&
      !allowedEqual.has(key) &&
      value.toLocaleLowerCase() === String(english[key]).trim().toLocaleLowerCase()
    ) {
      failures.push(`${locale}: English leakage in ${key}`);
    }
    if (placeholderSet(value) !== placeholderSet(english[key])) {
      failures.push(
        `${locale}: placeholder mismatch in ${key} (${placeholderSet(value)} vs ${placeholderSet(english[key])})`,
      );
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `PASS: ${keys.length} market-reward keys × ${locales.length} locales; zero missing keys, English leaks, or placeholder mismatches.`,
);

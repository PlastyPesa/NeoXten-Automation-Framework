#!/usr/bin/env node
/**
 * Device-free static audit of the PlastyPesa locale maps.
 *
 * Reads canonical-locales.json (dumped from lib/core/translations/*.dart) and
 * cross-compares all 7 locales to find the data-level defects that surface as
 * "mixed language on cards" / "mixed words in translations":
 *
 *   - missing-key      : key exists in EN but not in this locale -> runtime
 *                        falls back to English (English leak on screen)
 *   - cross-language   : this locale's value equals ANOTHER non-EN locale's
 *                        value for the same key (wrong language pasted in)
 *   - untranslated     : value is byte-identical to EN (and looks translatable)
 *   - diacritic-leak   : value contains diacritics exclusive to another language
 *
 * No device, no network, no model calls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANON = process.env.PLASTYPESA_LOC_CANONICAL || resolve(__dirname, 'canonical-locales.json');
const OUT = resolve(__dirname, '../../../.neoxten-out/plastypesa-localization');

const EN = 'en_US';
const NON_EN = ['it_IT', 'es_ES', 'de_DE', 'fr_FR', 'pt_PT', 'ro_RO'];

// Diacritics that strongly indicate a specific language.
const RO_ONLY = /[șțȘȚ]/; // s/t-comma -> Romanian
const DE_ONLY = /[äöüÄÖÜß]/; // umlauts/eszett -> German (also present in some loans)
const ES_ONLY = /[ñ¿¡]/;

function norm(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Heuristic: is this EN value something we'd expect to be translated?
function looksTranslatable(v) {
  const s = String(v || '').trim();
  if (s.length < 4) return false;
  if (!/[a-z]/i.test(s)) return false;
  // Brand / universal tokens that are legitimately identical across locales.
  const allow = new Set(['plastypesa', 'co₂', 'co2', 'ok', 'quiz', 'email', 'e-mail', 'pin', 'gdpr', 'id']);
  if (allow.has(s.toLowerCase())) return false;
  return true;
}

function main() {
  if (!existsSync(CANON)) {
    console.error(`canonical-locales.json missing at ${CANON} — run: dart run tool/dump_locales.dart`);
    process.exit(2);
  }
  const L = JSON.parse(readFileSync(CANON, 'utf8'));
  const en = L[EN] || {};
  const enKeys = Object.keys(en);

  const findings = [];
  const summary = {};

  for (const loc of NON_EN) {
    const map = L[loc] || {};
    const s = { missing: 0, crossLanguage: 0, untranslated: 0, diacriticLeak: 0 };

    for (const key of enKeys) {
      const enVal = en[key];
      if (!(key in map)) {
        s.missing += 1;
        findings.push({ type: 'missing-key', locale: loc, key, en: enVal });
        continue;
      }
      const val = map[key];
      const nv = norm(val);

      // cross-language: same value as another non-EN locale, different from EN
      if (nv && nv !== norm(enVal)) {
        const collide = NON_EN.filter((m) => m !== loc && norm(L[m]?.[key]) === nv);
        if (collide.length) {
          s.crossLanguage += 1;
          findings.push({
            type: 'cross-language',
            locale: loc,
            key,
            value: val,
            sharesWith: collide.map((c) => c.split('_')[0]),
            expectedDifferentFrom: collide.map((c) => c.split('_')[0]),
          });
        }
      }

      // untranslated == EN
      if (nv && nv === norm(enVal) && looksTranslatable(enVal)) {
        s.untranslated += 1;
        findings.push({ type: 'untranslated', locale: loc, key, value: val });
      }

      // diacritic leak (wrong-language contamination inside a value)
      if (loc !== 'ro_RO' && RO_ONLY.test(val)) {
        s.diacriticLeak += 1;
        findings.push({ type: 'diacritic-leak', locale: loc, key, value: val, foreign: 'ro' });
      } else if (loc !== 'de_DE' && DE_ONLY.test(val) && !ES_ONLY.test(val)) {
        // umlauts can appear in loanwords; only flag if value also lacks this locale's own marks — keep low-noise: report separately
        findings.push({ type: 'diacritic-leak', locale: loc, key, value: val, foreign: 'de(?)', soft: true });
      }
    }
    summary[loc] = s;
  }

  // Stale keys (present in a locale but not EN)
  for (const loc of NON_EN) {
    const map = L[loc] || {};
    for (const key of Object.keys(map)) {
      if (!(key in en)) findings.push({ type: 'stale-key', locale: loc, key });
    }
  }

  console.log('=== PlastyPesa STATIC locale audit (device-free) ===');
  console.log(`EN keys: ${enKeys.length}`);
  for (const loc of NON_EN) {
    const s = summary[loc];
    console.log(
      `${loc}: missing=${s.missing}  cross-language=${s.crossLanguage}  untranslated=${s.untranslated}  diacritic-leak=${s.diacriticLeak}`,
    );
  }
  const hi = findings.filter((f) => ['missing-key', 'cross-language'].includes(f.type)).length;
  console.log(`\nHIGH (missing-key + cross-language): ${hi}`);
  console.log(`Total findings: ${findings.length}`);

  // Write ledger
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'static-locale-audit.json'), JSON.stringify({ summary, findings }, null, 2));

  // A few concrete examples of the worst categories for the report
  const examples = (type, n = 8) => findings.filter((f) => f.type === type).slice(0, n);
  console.log('\n--- sample cross-language ---');
  for (const f of examples('cross-language')) {
    console.log(`  [${f.locale}] ${f.key} = "${String(f.value).slice(0, 60)}" (shares with ${f.sharesWith.join('/')})`);
  }
  console.log('\n--- sample missing-key ---');
  for (const f of examples('missing-key')) {
    console.log(`  [${f.locale}] ${f.key} -> EN "${String(f.en).slice(0, 50)}"`);
  }
  console.log('\n--- sample untranslated(==EN) ---');
  for (const f of examples('untranslated')) {
    console.log(`  [${f.locale}] ${f.key} = "${String(f.value).slice(0, 50)}"`);
  }
  console.log('\n--- sample diacritic-leak ---');
  for (const f of examples('diacritic-leak')) {
    console.log(`  [${f.locale}] ${f.key} = "${String(f.value).slice(0, 60)}" (foreign ${f.foreign})`);
  }
}

main();

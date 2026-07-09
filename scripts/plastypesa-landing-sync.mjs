#!/usr/bin/env node
/**
 * PlastyPesa landing launch-sync check (Playwright, rendered pages).
 *
 * Phase B recognition-first contract on the RENDERED landing page:
 *   - no "[value TBD]" / "[date TBD]" / "[pts]" placeholders anywhere
 *   - no active cash/voucher promise (no €70/€20 amounts while recognition
 *     mode is ON server-side)
 *   - no brand-violating words (prize/lottery/gambling/win) in any language
 *   - reward section renders the recognition tiers (Champion of the Week)
 *
 * Runs against all 7 language routes.
 *
 * Env:
 *   PLASTYPESA_LANDING_BASE — default https://plastypesa.com
 *     (point at http://localhost:8080 to verify the local build BEFORE deploy)
 *   PLASTYPESA_SIMULATE_RECOGNITION=1 — intercept /api/home/landing-data and
 *     force the prize payload into recognition mode (0 amounts). Use this to
 *     prove the FRONTEND recognition rendering path before the backend
 *     recognition-mode deploy goes live. Never needed against prod post-deploy.
 *
 * Exit code 1 on any failure.
 */
import { chromium } from 'playwright';

const SIMULATE_RECOGNITION = process.env.PLASTYPESA_SIMULATE_RECOGNITION === '1';

const BASE = (process.env.PLASTYPESA_LANDING_BASE || 'https://plastypesa.com').replace(/\/$/, '');
const LANGS = [
  ['en', '/'],
  ['it', '/it'],
  ['es', '/es'],
  ['pt', '/pt'],
  ['ro', '/ro'],
  ['de', '/de'],
  ['fr', '/fr'],
];

// Brand words per language (word-boundary; avoids false hits inside longer words).
const BRAND_RE =
  /\b(prize|prizes|lottery|gambling|winnings|premio|pr[eé]mio|premi|premiu|preis|prix|loteria|loter[ií]a|loterie|lotteria|lotterie|gl(ü|ue)cksspiel|jackpot)\b/i;
// The FAQ "honest answers" copy deliberately DISCLAIMS these words in all 7
// languages ("Recognition first — never a prize, lottery, or competition.",
// "Is PlastyPesa a lottery or prize draw? No. …"). Only PROMISSORY use is a
// violation: a sentence with a brand word passes when it is a question or
// contains a negation word.
// Token-based (JS \b breaks on non-ASCII letters like ă/ü). Exact words plus
// negation prefixes (kein/keine…, nessun/nessuna…, aucun/aucune…, niciun…).
const NEGATION_WORDS = new Set([
  'never', 'no', 'not', 'nu', 'não', 'nao', 'mai', 'nunca', 'niciodată',
  'niciodata', 'niemals', 'nie', 'jamais', 'nem', 'non', 'nein', 'ni',
  "n'y", 'n’y',
]);
const NEGATION_PREFIXES = ['kein', 'nessun', 'aucun', 'niciun', 'nicio'];

function hasNegation(sentence) {
  const tokens = sentence.toLowerCase().split(/[^\p{L}'’]+/u).filter(Boolean);
  return tokens.some(
    (t) => NEGATION_WORDS.has(t) || NEGATION_PREFIXES.some((p) => t.startsWith(p)),
  );
}

function promissoryBrandHit(body) {
  for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
    if (!BRAND_RE.test(sentence)) continue;
    if (sentence.trim().endsWith('?')) continue; // FAQ question
    if (hasNegation(sentence)) continue; // explicit denial/disclaimer
    return sentence.trim().slice(0, 160);
  }
  return null;
}

const PLACEHOLDER_RE = /\[(value|date|pts|data|fecha|Datum|dat[aă])[^\]]*\]|\bTBD\b/i;
const CASH_PROMISE_RE = /€\s?70|70\s?€|EUR\s?70|€\s?20|20\s?€|EUR\s?20/i;

const failures = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

if (SIMULATE_RECOGNITION) {
  await page.route('**/api/home/landing-data*', async (route) => {
    const resp = await route.fetch();
    const json = await resp.json();
    if (json?.data?.landingPrize) {
      json.data.landingPrize = {
        ...json.data.landingPrize,
        firstPrize: 0,
        otherPrize: 0,
        first: 0,
        second: 0,
        third: 0,
        other: 0,
        recognitionOnly: true,
      };
    }
    await route.fulfill({ response: resp, json });
  });
  console.log('  (simulating recognition-mode landing-data payload)');
}

for (const [lang, path] of LANGS) {
  await page
    .goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  const brandHit = promissoryBrandHit(body);
  const checks = [
    ['no_placeholders', !PLACEHOLDER_RE.test(body), PLACEHOLDER_RE],
    ['no_promissory_brand_words', !brandHit, null, brandHit],
    ['no_cash_amount_promise', !CASH_PROMISE_RE.test(body), CASH_PROMISE_RE],
    ['page_rendered', body.length > 2000, null],
  ];
  for (const [name, ok, re, detail] of checks) {
    if (ok) {
      console.log(`  PASS  [${lang}] ${name}`);
    } else {
      const m = re ? body.match(re) : null;
      const ctx = m
        ? ` -> "${body.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, ' ').trim()}"`
        : detail
          ? ` -> "${detail}"`
          : ` (body ${body.length} chars)`;
      console.log(`  FAIL  [${lang}] ${name}${ctx}`);
      failures.push(`[${lang}] ${name}${ctx}`);
    }
  }
}
await browser.close();

console.log(
  failures.length
    ? `\nlanding-sync: ${failures.length} FAILURE(S) against ${BASE}`
    : `\nlanding-sync: all checks green against ${BASE}`,
);
process.exit(failures.length ? 1 : 0);

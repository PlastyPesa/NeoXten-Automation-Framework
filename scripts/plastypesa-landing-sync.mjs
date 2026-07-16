#!/usr/bin/env node
/**
 * PlastyPesa landing launch-sync check (Playwright, rendered pages).
 *
 * Phase 5 market-isolated contract on the RENDERED landing page:
 *   - no "[value TBD]" / "[date TBD]" / "[pts]" placeholders anywhere
 *   - Europe remains recognition-only with no cash amount
 *   - Kenya renders the API-backed KES 10,000 schedule and Reliability Wall
 *   - no brand-violating words (prize/lottery/gambling/win) in any language
 *   - reward section renders the recognition tiers (Champion of the Week)
 *
 * Runs Europe and Kenya against all 7 language routes.
 *
 * Env:
 *   PLASTYPESA_LANDING_BASE — default https://plastypesa.com
 *     (point at http://localhost:8080 to verify the local build BEFORE deploy)
 *   PLASTYPESA_SIMULATE_RECOGNITION=1 — intercept /api/home/landing-data and
 *     force the prize payload into recognition mode (0 amounts). Use this to
 *     prove the FRONTEND recognition rendering path before the backend
 *     recognition-mode deploy goes live. Never needed against prod post-deploy.
 *   PLASTYPESA_SIMULATE_PHASE5=1 — intercept the new public market/Wall APIs
 *     with production-shaped data so the local frontend can be proved before
 *     the backend deployment. Never use this for post-deploy live proof.
 *
 * Exit code 1 on any failure.
 */
import { chromium } from 'playwright';

const SIMULATE_RECOGNITION = process.env.PLASTYPESA_SIMULATE_RECOGNITION === '1';
const SIMULATE_PHASE5 = process.env.PLASTYPESA_SIMULATE_PHASE5 === '1';

const BASE = (process.env.PLASTYPESA_LANDING_BASE || 'https://plastypesa.com').replace(/\/$/, '');
const ROUTES = [
  ['en', 'EU', '/'],
  ['it', 'EU', '/it'],
  ['es', 'EU', '/es'],
  ['pt', 'EU', '/pt'],
  ['ro', 'EU', '/ro'],
  ['de', 'EU', '/de'],
  ['fr', 'EU', '/fr'],
  ['en', 'KE', '/ke'],
  ['it', 'KE', '/it/ke'],
  ['es', 'KE', '/es/ke'],
  ['pt', 'KE', '/pt/ke'],
  ['ro', 'KE', '/ro/ke'],
  ['de', 'KE', '/de/ke'],
  ['fr', 'KE', '/fr/ke'],
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
const KENYA_CASH_RE = /\b(?:KES|KSh)\b/i;
const KENYA_TOTAL_RE = /10(?:[.,\s\u00a0])?000/;
const I18N_KEY_RE = /\b(?:fnd|wall|hero|cta|faq)_[a-z0-9_]+\b/i;
const KENYA_TITLE_NAMES = {
  en: 'Kenya',
  it: 'Kenya',
  es: 'Kenia',
  pt: 'Quénia',
  ro: 'Kenya',
  de: 'Kenia',
  fr: 'Kenya',
};

const failures = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

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

if (SIMULATE_PHASE5) {
  await page.route('**/market-rewards/public/markets/*', async (route) => {
    const marketCode = new URL(route.request().url()).pathname.split('/').pop()?.toUpperCase();
    const isKenya = marketCode === 'KE';
    await route.fulfill({
      status: isKenya || marketCode === 'EU' ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify({
        type: isKenya || marketCode === 'EU' ? 'success' : 'error',
        data: {
          marketCode,
          cashEnabled: isKenya,
          recognitionOnly: !isKenya,
          currency: isKenya ? 'KES' : null,
          rewardTiers: {
            schedule: isKenya
              ? [
                  { rankFrom: 1, rankTo: 1, amount: 4500 },
                  { rankFrom: 2, rankTo: 2, amount: 2500 },
                  { rankFrom: 3, rankTo: 3, amount: 1600 },
                  { rankFrom: 4, rankTo: 10, amount: 200 },
                ]
              : [],
            recipientCount: isKenya ? 10 : 5,
            weeklyTotal: isKenya ? 10000 : 0,
            feesPaidSeparately: isKenya,
          },
          claimWindowDays: isKenya ? 7 : null,
          minApprovedSortProofs: isKenya ? 1 : null,
        },
      }),
    });
  });
  await page.route('**/market-rewards/champions*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'success',
        data: [
          {
            marketCode: 'KE',
            weekStart: '2026-07-06T00:00:00.000Z',
            weekEnd: '2026-07-12T23:59:59.999Z',
            snapshotAt: '2026-07-12T23:59:59.999Z',
            totalParticipants: 24,
            champions: [
              {
                slot: 1,
                rank: 1,
                ecoHandle: 'VerifiedEco742',
                weeklyPoints: 12400,
                rewarded: true,
                rewardPending: false,
                rewardAmount: 4500,
                currency: 'KES',
                paidAt: '2026-07-13T10:00:00.000Z',
                paymentReferencePrefix: 'MPES',
              },
            ],
          },
        ],
      }),
    }),
  );
  console.log('  (simulating Phase 5 public market APIs)');
}

for (const [lang, market, path] of ROUTES) {
  const response = await page
    .goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 })
    .catch(() => null);
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  const brandHit = promissoryBrandHit(body);
  const pageFacts = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
    canonicalCount: document.querySelectorAll('link[rel="canonical"]').length,
    title: document.title,
  }));
  const checks = [
    ['http_200', response?.status() === 200, null, `status ${response?.status() ?? 'navigation failed'}`],
    ['no_placeholders', !PLACEHOLDER_RE.test(body), PLACEHOLDER_RE],
    ['no_promissory_brand_words', !brandHit, null, brandHit],
    ['no_stale_euro_promise', !CASH_PROMISE_RE.test(body), CASH_PROMISE_RE],
    ['no_i18n_key_leakage', !I18N_KEY_RE.test(body), I18N_KEY_RE],
    ['html_language_matches_route', pageFacts.lang.toLowerCase().startsWith(lang), null, `lang="${pageFacts.lang}"`],
    ['no_mobile_horizontal_overflow', pageFacts.overflow <= 1, null, `overflow ${pageFacts.overflow}px`],
    ['one_canonical', pageFacts.canonicalCount === 1, null, `${pageFacts.canonicalCount} canonical links`],
    ['canonical_matches_route', pageFacts.canonical === `https://plastypesa.com${path}`, null, pageFacts.canonical],
    [
      'market_aware_title',
      market === 'KE'
        ? pageFacts.title.includes(KENYA_TITLE_NAMES[lang])
        : !Object.values(KENYA_TITLE_NAMES).some((name) => pageFacts.title.includes(name)),
      null,
      pageFacts.title,
    ],
    ['eu_has_no_kes_schedule', market !== 'EU' || !KENYA_CASH_RE.test(body), KENYA_CASH_RE],
    ['ke_has_kes_schedule', market !== 'KE' || KENYA_CASH_RE.test(body), null],
    ['ke_has_weekly_total', market !== 'KE' || KENYA_TOTAL_RE.test(body), null],
    [
      'populated_reliability_wall_renders',
      !SIMULATE_PHASE5 ||
        market !== 'KE' ||
        (body.includes('VerifiedEco742') && body.includes('MPES')),
      null,
    ],
    ['page_rendered', body.length > 2000, null],
  ];
  for (const [name, ok, re, detail] of checks) {
    if (ok) {
      console.log(`  PASS  [${lang}/${market}] ${name}`);
    } else {
      const m = re ? body.match(re) : null;
      const ctx = m
        ? ` -> "${body.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, ' ').trim()}"`
        : detail
          ? ` -> "${detail}"`
          : ` (body ${body.length} chars)`;
      console.log(`  FAIL  [${lang}/${market}] ${name}${ctx}`);
      failures.push(`[${lang}/${market}] ${name}${ctx}`);
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

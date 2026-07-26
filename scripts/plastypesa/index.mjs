#!/usr/bin/env node
/**
 * PlastyPesa API regression suite (Node fetch, no browser).
 *
 * Env:
 *   PLASTYPESA_API_BASE       — override API root (default: prod eu-west-2)
 *   PLASTYPESA_USER_JWT       — inject Bearer token (highest priority)
 *   PLASTYPESA_TEST_EMAIL     — + PLASTYPESA_TEST_PASSWORD → POST /auth/login (token cached under .neoxten/)
 *   PLASTYPESA_TEST_DEVICE_ID — optional login body
 *   PLASTYPESA_TOKEN_CACHE=0  — disable file cache for password login
 *   PLASTYPESA_REQUIRE_AUTHENTICATED=1 — exit 1 if no JWT after bootstrap (release gates)
 *   PLASTYPESA_AUTH_ONLY=1    — only unauthenticated protection checks
 *   PLASTYPESA_RELEASE_PACK   — if 1 and PLASTYPESA_SUITES unset → run release-pack suite list (see release-pack-config.mjs)
 *   PLASTYPESA_SUITES         — comma list (overrides release-pack when set)
 *   PLASTYPESA_SORT_PROOF_E2E=1 — extra Anthropic-backed POST (costs quota; feature must be enabled)
 *   PLASTYPESA_ENV_FILE       — optional path to .env (defaults to NeoXten repo .env); loads PLASTYPESA_* keys only
 *   PLASTYPESA_ADMIN_JWT      — admin Bearer for admin-announcements suite (GET + gated POST)
 *   PLASTYPESA_PHASE1_ANNOUNCEMENT_API=1 — enable POST dry-run test (set after backend in-app banner Phase 1 is deployed)
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getConfig } from './config.mjs';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import { SuiteRunner, printFailureDetails, exitCodeFromSummaries } from './runner.mjs';
import * as authBaseline from './suites/auth-baseline.mjs';
import * as publicRoutes from './suites/public-routes.mjs';
import * as userProfile from './suites/user-profile.mjs';
import * as impactReport from './suites/impact-report.mjs';
import * as sortProof from './suites/sort-proof.mjs';
import * as regressionCore from './suites/regression-core.mjs';
import * as communityFeed from './suites/community-feed.mjs';
import * as adminAnnouncements from './suites/admin-announcements.mjs';
import * as challengesProgress from './suites/challenges-progress.mjs';
import * as ecoCatalog from './suites/eco-catalog.mjs';
import * as ecoScan from './suites/eco-scan.mjs';
import * as ecoScanConfig from './suites/eco-scan-config.mjs';
import * as circularEconomy from './suites/circular-economy.mjs';
import * as b2bImpact from './suites/b2b-impact.mjs';
import * as gdpr from './suites/gdpr.mjs';
import * as launchSync from './suites/launch-sync.mjs';
import * as dailyQuizContinuity from './suites/daily-quiz-continuity.mjs';
import * as quizAnswerShuffle from './suites/quiz-answer-shuffle.mjs';
import * as readRewardRotation from './suites/read-reward-rotation.mjs';
import * as swissClockWeek from './suites/swiss-clock-week.mjs';
import * as closeIntegrity from './suites/close-integrity.mjs';
import * as weeklyEarnersUi from './suites/weekly-earners-ui.mjs';
import * as forceUpdateGate from './suites/force-update-gate.mjs';
import * as communityPulse from './suites/community-pulse.mjs';
import * as dailyCheckInbox from './suites/daily-check-inbox.mjs';
import * as numberSync from './suites/number-sync.mjs';

/** Optional until `/challenges/*` routes are deployed to prod (404 today). */
const OPTIONAL_SUITES = [{ id: 'challenges-progress', mod: challengesProgress }];

const ALL_SUITES = [
  { id: 'auth-baseline', mod: authBaseline },
  { id: 'public-routes', mod: publicRoutes },
  { id: 'user-profile', mod: userProfile },
  { id: 'impact-report', mod: impactReport },
  { id: 'sort-proof', mod: sortProof },
  { id: 'regression-core', mod: regressionCore },
  { id: 'community-feed', mod: communityFeed },
  { id: 'admin-announcements', mod: adminAnnouncements },
  { id: 'eco-catalog', mod: ecoCatalog },
  { id: 'eco-scan', mod: ecoScan },
  // P5 — Recognition v2 rollout envelope exposed at GET /api/eco-scan/config
  { id: 'eco-scan-config', mod: ecoScanConfig },
  // P6 — High-value streams + circular-economy narrative: HVS catalog
  // rows are present and (post-publish) linked to circular-economy
  // learning modules; the public learn list exposes the new isSponsored
  // / sponsoredBy fields for the mobile Sponsored badge.
  { id: 'circular-economy', mod: circularEconomy },
  // P7 — B2B impact API. Verifies auth gate at the perimeter and
  // (optionally, when PLASTYPESA_B2B_TOKEN is set) asserts the
  // k-anonymity contract and no-PII guarantee on a live response.
  { id: 'b2b-impact', mod: b2bImpact },
  // P8 — GDPR self-service (Article 17 erasure + Article 20 portability).
  // Auth perimeter on the four /api/user/me/gdpr/* endpoints, plus the
  // OTP-gate behaviour on export and delete. The destructive delete
  // path itself is never run live by this suite.
  { id: 'gdpr', mod: gdpr },
  // Phase B — recognition-first launch sync: prizes payload, legal masters,
  // landing-data, market config (admin token optional; skips without it).
  { id: 'launch-sync', mod: launchSync },
  // Phase E — daily-quiz continuity: exactly one ACTIVE automated daily
  // quiz, fresh within 36h; fails loudly when automation stops publishing.
  { id: 'daily-quiz-continuity', mod: dailyQuizContinuity },
  { id: 'quiz-answer-shuffle', mod: quizAnswerShuffle },
  // BUILD 50 — read reward rotation: max 5 articles/day, next in rotation only.
  { id: 'read-reward-rotation', mod: readRewardRotation },
  // P-POINTS-SWISS-CLOCK (2026-07-26) — Monday-based competition week +
  // clamped weekly windows served by the live API. Guards the exact regime
  // failure behind the 2026-07-26 trust incident.
  { id: 'swiss-clock-week', mod: swissClockWeek },
  // P-WEEKLY-CLOSE-AUTO (2026-07-26) — close/claims integrity: one live
  // close per (market, weekStart), Jul 19–25 stays DRAFT/0-claims until the
  // owner confirms, and post-Jul-26 closes carry a passing evidence pack.
  { id: 'close-integrity', mod: closeIntegrity },
  // P-WEEKLY-WINNERS-UI (2026-07-26) — the mobile celebration card, Top-3
  // ribbon, Past earners tab and all-time card render from existing endpoints
  // with no new backend, so this suite is the only thing guarding the fields
  // they depend on (weeklyPoints / confirmedAt / closeId / ledger-only past).
  { id: 'weekly-earners-ui', mod: weeklyEarnersUi },
  // P-FORCE-UPDATE-MIN-VERSION (2026-07-26) — watches both failure edges of
  // the release gate: silently broken (can't pull a bad build) and silently
  // left ON (production refusing app traffic nobody meant to refuse).
  { id: 'force-update-gate', mod: forceUpdateGate },
  // P-SOCIAL-PROOF-PRESENCE Phase 1 (2026-07-26) — the community pulse card's
  // numbers are trust claims on the home screen. Guards the exclusions that
  // keep 82 suspended fraud accounts out of "members", the null-below-3 rule
  // that stops the app printing "0 online", and the funding gate on the KES
  // 15,000 milestone promise.
  { id: 'community-pulse', mod: communityPulse },
  // Owner 2026-07-27 — Home mission strip + pulse + board lifetime must agree.
  // Guards the 51-vs-38 Kenya learners dual-counter class of bug.
  { id: 'number-sync', mod: numberSync },
  // P-DAILY-CHECK-ADMIN-EXPANSION + P-ECO-GUARDIAN-ALERT-FORM (2026-07-26) —
  // Daily Check is the page ops opens every morning, and each of its loaders
  // swallows its own errors, so a dead section looks exactly like an empty
  // queue. Proves every action queue is present, that disputes are filtered on
  // statuses the model really issues, and that a founding qualifier owed the
  // KES 20,000 reward can never be invisible.
  { id: 'daily-check-inbox', mod: dailyCheckInbox },
];

function resolveSuites(cfg) {
  let suites = ALL_SUITES;
  if (cfg.authOnly) {
    return suites.filter((s) => s.id === 'auth-baseline');
  }
  if (cfg.suiteFilter.length > 0) {
    const pool = [...ALL_SUITES, ...OPTIONAL_SUITES];
    const set = new Set(cfg.suiteFilter);
    suites = pool.filter((s) => set.has(s.id));
    const unknown = cfg.suiteFilter.filter((x) => !pool.some((s) => s.id === x));
    if (unknown.length) {
      console.warn('Unknown suite ids (ignored):', unknown.join(', '));
    }
    return suites;
  }
  return suites;
}

export async function runPlastyPesaApiSuite() {
  bootstrapPlastyPesaEnv();
  const baseCfg = getConfig();

  const auth = await resolvePlastyPesaAuth(baseCfg);
  if (auth.authError) {
    console.error('\n[plastypesa-auth] FATAL:', auth.authError, '\n');
    return 1;
  }
  if (baseCfg.requireAuthenticated && !auth.authHeaders) {
    console.error(
      '\n[plastypesa-auth] PLASTYPESA_REQUIRE_AUTHENTICATED=1 but no JWT resolved. Set PLASTYPESA_USER_JWT or email/password login.\n',
    );
    return 1;
  }

  const cfg = {
    ...baseCfg,
    authHeaders: auth.authHeaders,
    authSource: auth.authSource,
  };

  const suites = resolveSuites(cfg);

  console.log('\n=== PlastyPesa API Suite ===\n');
  console.log(`API: ${cfg.apiBase}`);
  console.log(`Mode: ${cfg.releasePack ? 'release-pack' : 'full'}`);
  console.log(`Auth: ${cfg.authSource}`);
  console.log(`Suites: ${suites.map((s) => s.id).join(', ')}\n`);

  const summaries = [];
  const flatFailures = [];

  for (const { id: suiteId, mod } of suites) {
    const runner = new SuiteRunner(suiteId);
    await mod.run(cfg, runner);
    const s = runner.summary();
    summaries.push({ suite: suiteId, ...s });
    for (const r of s.results) {
      if (r.status === 'FAIL') {
        flatFailures.push({ suite: suiteId, name: r.name, error: r.error });
      }
    }
  }

  console.log('\n=== Summary ===\n');
  let tp = 0,
    tf = 0,
    ts = 0;
  for (const s of summaries) {
    tp += s.pass;
    tf += s.fail;
    ts += s.skip;
    console.log(
      `  ${s.suite}: ${s.pass} pass, ${s.fail} fail, ${s.skip} skip`,
    );
  }
  console.log(`\n  TOTAL: ${tp} pass, ${tf} fail, ${ts} skip\n`);

  printFailureDetails(flatFailures);

  if (tf > 0) {
    console.log(
      '\nTip: Authenticated flows — PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    console.log(
      'Tip: PLASTYPESA_SORT_PROOF_E2E=1 runs an extra live Anthropic call (optional).\n',
    );
  }

  return exitCodeFromSummaries(summaries.map((s) => ({ fail: s.fail })));
}

const isMain =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  const code = await runPlastyPesaApiSuite();
  process.exit(code);
}

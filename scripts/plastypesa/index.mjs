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

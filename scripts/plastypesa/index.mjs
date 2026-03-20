#!/usr/bin/env node
/**
 * PlastyPesa API regression suite (Node fetch, no browser).
 *
 * Env:
 *   PLASTYPESA_API_BASE       — override API root (default: prod eu-west-2)
 *   PLASTYPESA_USER_JWT       — Bearer token for authenticated flows
 *   PLASTYPESA_AUTH_ONLY=1    — only unauthenticated protection checks
 *   PLASTYPESA_SUITES         — comma list: auth-baseline,public-routes,impact-report,weekly-challenge,sort-proof,regression-core
 *   PLASTYPESA_SORT_PROOF_E2E=1 — extra Anthropic-backed POST (costs quota; feature must be enabled)
 *   PLASTYPESA_ENV_FILE       — optional path to .env (defaults to NeoXten repo .env); loads PLASTYPESA_* keys only
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getConfig } from './config.mjs';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { SuiteRunner, printFailureDetails, exitCodeFromSummaries } from './runner.mjs';
import * as authBaseline from './suites/auth-baseline.mjs';
import * as publicRoutes from './suites/public-routes.mjs';
import * as impactReport from './suites/impact-report.mjs';
import * as weeklyChallenge from './suites/weekly-challenge.mjs';
import * as sortProof from './suites/sort-proof.mjs';
import * as regressionCore from './suites/regression-core.mjs';

const ALL_SUITES = [
  { id: 'auth-baseline', mod: authBaseline },
  { id: 'public-routes', mod: publicRoutes },
  { id: 'impact-report', mod: impactReport },
  { id: 'weekly-challenge', mod: weeklyChallenge },
  { id: 'sort-proof', mod: sortProof },
  { id: 'regression-core', mod: regressionCore },
];

export async function runPlastyPesaApiSuite() {
  bootstrapPlastyPesaEnv();
  const baseCfg = getConfig();

  let suites = ALL_SUITES;
  if (baseCfg.authOnly) {
    suites = ALL_SUITES.filter((s) => s.id === 'auth-baseline');
  } else if (baseCfg.suiteFilter.length > 0) {
    const set = new Set(baseCfg.suiteFilter);
    suites = ALL_SUITES.filter((s) => set.has(s.id));
    const unknown = baseCfg.suiteFilter.filter((x) => !ALL_SUITES.some((s) => s.id === x));
    if (unknown.length) {
      console.warn('Unknown suite ids (ignored):', unknown.join(', '));
    }
  }

  console.log('\n=== PlastyPesa API Suite ===\n');
  console.log(`API: ${baseCfg.apiBase}`);
  console.log(
    `Auth token: ${baseCfg.userJwt ? 'present (authenticated suites active)' : 'absent (skips marked SKIP)'}`,
  );
  console.log(`Suites: ${suites.map((s) => s.id).join(', ')}\n`);

  const summaries = [];
  const flatFailures = [];

  for (const { id: suiteId, mod } of suites) {
    const runner = new SuiteRunner(suiteId);
    await mod.run(baseCfg, runner);
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
      '\nTip: set PLASTYPESA_USER_JWT for impact report, weekly challenge, sort-proof config, winners wall, etc.',
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

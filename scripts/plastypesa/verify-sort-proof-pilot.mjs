#!/usr/bin/env node
/**
 * Sort-proof pilot verification: live E2E POST + post-check chain (impact, reward-history, transactions).
 * Does NOT toggle admin — rollback/disable must be verified manually or via admin (see docs/SORT_PROOF_RUNBOOK.md).
 *
 * Env: same as NeoXten PlastyPesa suite (PLASTYPESA_API_BASE, PLASTYPESA_USER_JWT or email/password).
 * Optional: PLASTYPESA_TOKEN_CACHE=0 for fresh login.
 */
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import { readJson, TINY_PNG_BASE64 } from './assert.mjs';

async function getImpactSortCount(cfg, headers) {
  const r = await fetch(url(cfg, '/home/impact-report'), { headers });
  const { body, text } = await readJson(r);
  if (r.status !== 200) throw new Error(`impact-report ${r.status}: ${text.slice(0, 200)}`);
  const n = body?.data?.userImpact?.sortProofCount;
  return typeof n === 'number' ? n : null;
}

async function getRewardLifetimeSummary(cfg, headers) {
  const r = await fetch(
    url(cfg, '/transaction/reward-history?type=lifetime&page=1&limit=5'),
    { headers },
  );
  const { body, text } = await readJson(r);
  if (r.status !== 200) throw new Error(`reward-history ${r.status}: ${text.slice(0, 200)}`);
  const s = body?.data?.summary;
  return {
    totalEntries: s?.totalEntries ?? 0,
    totalPoints: s?.totalPoints ?? 0,
  };
}

async function getTransactionCountFirstPage(cfg, headers) {
  const r = await fetch(url(cfg, '/transaction/all'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ page: 1, limit: 50, transactionType: 'all' }),
  });
  const { body, text } = await readJson(r);
  if (r.status !== 200) throw new Error(`transaction/all ${r.status}: ${text.slice(0, 200)}`);
  const arr = body?.data;
  return Array.isArray(arr) ? arr.length : 0;
}

async function main() {
  bootstrapPlastyPesaEnv();
  process.env.PLASTYPESA_SORT_PROOF_E2E = '1';

  const baseCfg = getConfig();
  const auth = await resolvePlastyPesaAuth(baseCfg);
  if (auth.authError) {
    console.error('[pilot-verify] Auth error:', auth.authError);
    process.exit(1);
  }
  if (!auth.authHeaders) {
    console.error('[pilot-verify] No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD');
    process.exit(1);
  }

  const cfg = { ...baseCfg, authHeaders: auth.authHeaders, authSource: auth.authSource };
  const h = cfg.authHeaders;

  console.log('\n=== Sort-proof pilot verification ===');
  console.log('API:', cfg.apiBase);
  console.log('Auth:', cfg.authSource, '\n');

  const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), { headers: h });
  const cfgJson = await readJson(cfgRes);
  if (cfgJson.body?.data?.enabled !== true) {
    console.error(
      '[pilot-verify] sort-proof is DISABLED in config. Enable in admin, then re-run.',
    );
    process.exit(2);
  }

  const before = {
    sortProofCount: await getImpactSortCount(cfg, h),
    reward: await getRewardLifetimeSummary(cfg, h),
    txPageLen: await getTransactionCountFirstPage(cfg, h),
  };
  console.log('Baseline — impact userImpact.sortProofCount:', before.sortProofCount);
  console.log('Baseline — reward-history lifetime totalEntries:', before.reward.totalEntries, 'totalPoints:', before.reward.totalPoints);
  console.log('Baseline — transaction/all page1 row count:', before.txPageLen);

  const r = await fetch(url(cfg, '/home/sort-proof'), {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      image: TINY_PNG_BASE64,
      streamA: 'PET',
      streamB: 'PP',
    }),
  });
  const submit = await readJson(r);

  if (r.status === 429) {
    console.log('\n[pilot-verify] E2E POST returned 429 (cap/throttle). Post-check deltas skipped.');
    console.log('Verdict: E2E path reachable; run again later or adjust cap.');
    process.exit(0);
  }

  if (r.status !== 200) {
    console.error('[pilot-verify] E2E POST failed:', r.status, submit.text?.slice(0, 500));
    process.exit(1);
  }

  const verified = submit.body?.data?.verified === true;
  const pts = submit.body?.data?.pointsEarned ?? 0;
  console.log('\nE2E POST 200 — verified:', verified, 'confidence:', submit.body?.data?.confidence);

  const after = {
    sortProofCount: await getImpactSortCount(cfg, h),
    reward: await getRewardLifetimeSummary(cfg, h),
    txPageLen: await getTransactionCountFirstPage(cfg, h),
  };
  console.log('\nAfter — impact sortProofCount:', after.sortProofCount);
  console.log('After — reward-history lifetime totalEntries:', after.reward.totalEntries, 'totalPoints:', after.reward.totalPoints);
  console.log('After — transaction/all page1 row count:', after.txPageLen);

  const dCount = after.sortProofCount - before.sortProofCount;
  const dEntries = after.reward.totalEntries - before.reward.totalEntries;
  const dPoints = after.reward.totalPoints - before.reward.totalPoints;

  console.log('\n--- Post-check summary ---');
  console.log('Delta sortProofCount:', dCount, '(expected 0 or 1 if backend increments on success)');
  console.log('Delta reward-history totalEntries:', dEntries);
  console.log('Delta reward-history totalPoints:', dPoints);

  if (verified && dCount > 1) {
    console.warn('[pilot-verify] WARN: sortProofCount jumped more than 1 — investigate duplicate credit.');
    process.exit(3);
  }

  console.log('\n[pilot-verify] Done. For rollback: disable in admin, GET config enabled=false, POST /home/sort-proof → 403.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

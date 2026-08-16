#!/usr/bin/env node
/**
 * One-shot live contract dump for the Screen Truth inventory (2026-08-16).
 * Read-only. Strips email/phone/token. Does not write Mongo.
 *
 *   node scripts/plastypesa/truth-inventory-snapshot.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import { loadMobileAppUserCredentials } from './credential-registry.mjs';
import { readJson } from './assert.mjs';

bootstrapPlastyPesaEnv();

const OUT_DIR = resolve(
  process.cwd(),
  '.neoxten-out',
  'truth-inventory-20260816',
);

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function scrubProfile(p) {
  if (!p) return p;
  return {
    ecoHandle: p.ecoHandle || p.username || null,
    country: p.country || null,
    countryCode: p.countryCode || null,
    status: p.status || null,
    points: p.points ?? null,
    lifetimePoints: p.lifetimePoints ?? p.lifetimeStats?.totalPoints ?? null,
    weeklyPoints: p.weeklyPoints ?? p.weeklyStats?.totalPoints ?? null,
    weeklyStats: p.weeklyStats
      ? { totalPoints: p.weeklyStats.totalPoints, weekStart: p.weeklyStats.weekStart }
      : null,
    lastAppVersionCode: p.lastAppVersionCode ?? null,
  };
}

async function get(cfg, path, headers) {
  const res = await fetch(url(cfg, path), { headers });
  const parsed = await readJson(res);
  return { status: res.status, body: parsed.body, ok: res.ok };
}

async function main() {
  const cfg = getConfig();
  if (!cfg.testEmail || !cfg.testPassword) {
    const creds = loadMobileAppUserCredentials();
    cfg.testEmail = creds.email;
    cfg.testPassword = creds.password;
  }
  const auth = await resolvePlastyPesaAuth(cfg);
  cfg.authHeaders = auth.authHeaders;
  if (auth.authError) {
    console.error('AUTH_ERROR', auth.authError);
  }
  if (!cfg.authHeaders) {
    console.error('NO_AUTH — cannot snapshot', auth.authSource);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const takenAt = new Date().toISOString();

  const paths = {
    earnHub: '/home/earn-hub',
    pulse: '/community/pulse',
    profile: '/user/my-profile',
    boardWeekly: '/home/leaderboard?type=weekly&scope=global',
    marketKePublic: '/market-rewards/public/markets/KE',
    marketMine: '/market-rewards/market/mine',
    reviewQueue: '/home/review-queue',
    adsConfig: '/master?name=ads-config',
  };

  const raw = {};
  for (const [name, path] of Object.entries(paths)) {
    raw[name] = await get(cfg, path, cfg.authHeaders);
  }
  raw.marketKePublicUnauth = await get(cfg, paths.marketKePublic, {
    'Content-Type': 'application/json',
  });

  const eh = raw.earnHub.body?.data || {};
  const pulse = raw.pulse.body?.data || {};
  const profile = scrubProfile(
    raw.profile.body?.data || raw.profile.body?.user || {},
  );
  const board = raw.boardWeekly.body?.data || {};
  const ke =
    raw.marketKePublicUnauth.body?.data ||
    raw.marketKePublic.body?.data ||
    {};
  const mine = raw.marketMine.body?.data || raw.marketMine.body || {};
  const review = raw.reviewQueue.body?.data || {};
  const adsRow = Array.isArray(raw.adsConfig.body?.data)
    ? raw.adsConfig.body.data[0]
    : raw.adsConfig.body?.data;
  const adsMeta = adsRow?.metadata;
  const ads =
    adsMeta && typeof (Array.isArray(adsMeta) ? adsMeta[0] : adsMeta) === 'object'
      ? Array.isArray(adsMeta)
        ? adsMeta[0]
        : adsMeta
      : {};

  const schedule =
    ke.rewardTiers?.schedule ||
    mine.rewardTiers?.schedule ||
    mine.schedule ||
    [];
  const ladderAmounts = schedule.map((t) => Number(t.amount));

  const contract = {
    takenAt,
    apiBase: cfg.apiBase,
    ecoHandle: profile.ecoHandle,
    country: profile.countryCode || profile.country,
    lastAppVersionCode: profile.lastAppVersionCode,
    http: Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v.status]),
    ),
    earn: {
      sortProofPoints: eh.sortProofPoints,
      quizCompletionPoints: eh.quizCompletionPoints,
      previousDailyQuizPoints: eh.previousDailyQuizPoints,
      ecosortPointsPerCorrect: eh.ecosortPointsPerCorrect,
      readRewardPoints: eh.readRewardPoints,
      pledgePoints: eh.pledgePoints,
      communityPostPoints: eh.communityPostPoints,
      referralPoints: eh.referralPoints,
      referralBoostActive: eh.referralBoostActive,
      referralBoostEndsAt: eh.referralBoostEndsAt,
      ecoActionPoints: eh.ecoAction?.points,
      ecoActionState: eh.ecoAction?.state,
      deskEnabled: eh.deskToday?.enabled,
      deskReady: eh.deskToday?.ready,
      deskShiftPoints: eh.deskToday?.shiftPoints,
      stillAvailableToday: eh.stillAvailableToday?.points,
      earnDayKey: eh.earnDayKey,
      earnDayTimeZone: eh.earnDayTimeZone,
      pointsEpoch: eh.clientConfig?.pointsEpoch ?? eh.pointsEpoch,
    },
    me: {
      hubWeekly: eh.rank?.weeklyPoints ?? eh.weeklyPoints,
      hubLifetime: eh.rank?.lifetimePoints,
      hubPosition: eh.rank?.position,
      hubBand: eh.rank?.band,
      profileWeekly: profile.weeklyPoints,
      profileLifetime: profile.lifetimePoints ?? profile.points,
      boardWeekly: board.currentUser?.weeklyPoints,
      boardLifetime: board.currentUser?.lifetimePoints,
      boardRank: board.currentUser?.rank,
    },
    kenyaHeadcount: {
      hubMembers: eh.communityProgress?.communityMembers,
      pulseMembers: pulse.members,
      milestoneKe: pulse.milestone?.currentKeMembers,
      membersToTop20: eh.communityProgress?.membersToTop20Unlock,
    },
    reviewQueue: {
      sortPosition: review.sort?.position ?? eh.reviewQueue?.sort?.position,
      ecoPosition: review.eco?.position ?? eh.reviewQueue?.eco?.position,
      pollSeconds: review.pollSeconds ?? eh.reviewQueue?.pollSeconds,
    },
    ladder: {
      amounts: ladderAmounts,
      weeklyTotal: ke.rewardTiers?.weeklyTotal ?? ke.weeklyTotal,
      cashEnabled: ke.cashEnabled ?? mine.cashEnabled,
    },
    ads: pick(ads, [
      'adsEnabled',
      'bannerEnabled',
      'quizInterstitialEnabled',
      'rewardedEnabled',
      'appOpenEnabled',
      'adsOffForUser',
    ]),
    mismatches: [],
  };

  const n = (a, b) =>
    Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) !== Number(b);

  if (n(contract.kenyaHeadcount.hubMembers, contract.kenyaHeadcount.pulseMembers)) {
    contract.mismatches.push(
      `Kenya headcount hub ${contract.kenyaHeadcount.hubMembers} ≠ pulse ${contract.kenyaHeadcount.pulseMembers}`,
    );
  }
  if (n(contract.me.hubWeekly, contract.me.boardWeekly)) {
    contract.mismatches.push(
      `weekly hub ${contract.me.hubWeekly} ≠ board ${contract.me.boardWeekly}`,
    );
  }
  if (n(contract.me.hubLifetime, contract.me.profileLifetime)) {
    contract.mismatches.push(
      `lifetime hub ${contract.me.hubLifetime} ≠ profile ${contract.me.profileLifetime}`,
    );
  }
  if (n(contract.me.profileLifetime, contract.me.boardLifetime)) {
    contract.mismatches.push(
      `lifetime profile ${contract.me.profileLifetime} ≠ board ${contract.me.boardLifetime}`,
    );
  }
  if (n(contract.me.profileWeekly, contract.me.hubWeekly)) {
    contract.mismatches.push(
      `weekly profile ${contract.me.profileWeekly} ≠ hub ${contract.me.hubWeekly}`,
    );
  }

  const expectedB = [2600, 1500, 1000, 700];
  const retiredA = [4500, 2500, 1600, 200];
  contract.ladder.isB =
    expectedB.every((x) => ladderAmounts.includes(x)) &&
    Number(contract.ladder.weeklyTotal) === 10000;
  contract.ladder.stillA = retiredA.every((x) => ladderAmounts.includes(x));

  writeFileSync(
    resolve(OUT_DIR, 'contract.json'),
    JSON.stringify(contract, null, 2),
  );
  writeFileSync(
    resolve(OUT_DIR, 'earn-hub-keys.json'),
    JSON.stringify(Object.keys(eh).sort(), null, 2),
  );
  writeFileSync(
    resolve(OUT_DIR, 'http-status.json'),
    JSON.stringify(contract.http, null, 2),
  );

  console.log(JSON.stringify(contract, null, 2));
  console.log(`\nWrote ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

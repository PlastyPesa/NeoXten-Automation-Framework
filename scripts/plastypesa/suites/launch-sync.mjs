import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

/**
 * Launch-synchronization suite. Europe remains recognition-first; Kenya has a
 * deterministic KES 10,000 schedule that can be activated by market config.
 *
 * Contract asserted here (server side of the story):
 *   1. `GET /weekly-rewards/leaderboard` prizes payload: while the server
 *      reports `recognitionOnly: true`, amounts must be 0 and localized
 *      descriptions empty (the shipped app amount-gates and falls back to
 *      its recognition copy) — and no user-visible string may contain
 *      brand-violating or voucher-promising text.
 *   2. Legal masters (terms-of-us / privacy-policy / gdpr-compliance):
 *      recognition-first Terms section present, "draw entries" retired,
 *      no active voucher promise, no brand-violating words, July 2026 stamp.
 *   3. `GET /home/landing-data`: landingPrize fails safe (0 amounts +
 *      recognitionOnly) while recognition mode is ON, and communityStats
 *      exposes the verified counts the landing impact section renders.
 *   4. User market resolves fail-closed and exposes only the public schedule.
 *   5. Market config consistency (needs PLASTYPESA_ADMIN_JWT): KE uses the
 *      locked ranked KES schedule; EU remains recognition-only.
 *
 * Env:
 *   PLASTYPESA_EXPECT_RECOGNITION=1 — the LAUNCH GATE mode: fail unless the
 *     live payloads actually report recognition mode. Without it, a payload
 *     in cash mode is validated against the cash contract instead (so the
 *     suite stays meaningful pre-deploy and after the owner enables cash).
 *
 * Brand checks run on user-visible STRING VALUES only, never on raw JSON
 * (field names like `firstPrize` are internal contract, not copy).
 */
export const id = 'launch-sync';

const BRAND_VIOLATIONS = /\b(prize|prizes|lottery|gambl\w*|winnings)\b/i;
const VOUCHER_PROMISE = /(EUR|€)\s*\d+\s*(digital\s+)?voucher/i;
const EXPECT_RECOGNITION = process.env.PLASTYPESA_EXPECT_RECOGNITION === '1';
const LEGAL_LANGS = {
  en: 'Last updated:',
  it: 'Ultimo aggiornamento:',
  es: 'Última actualización:',
  de: 'Zuletzt aktualisiert:',
  fr: 'Dernière mise à jour :',
  pt: 'Última atualização:',
  ro: 'Ultima actualizare:',
};

/** Collect every string leaf in a JSON payload (user-visible copy lives there). */
function stringLeaves(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const v of node) stringLeaves(v, out);
  else if (node && typeof node === 'object')
    for (const v of Object.values(node)) stringLeaves(v, out);
  return out;
}

function assertCopySafe(payload, label) {
  for (const s of stringLeaves(payload)) {
    assert(!BRAND_VIOLATIONS.test(s), `${label}: brand-violating copy: "${s.slice(0, 120)}"`);
  }
}

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'weekly_rewards_prizes_recognition_safe',
      'no user JWT resolved (authenticated endpoint)',
    );
  } else {
  await runner.test('weekly_rewards_prizes_recognition_safe', async () => {
    const r = await fetch(url(cfg, '/weekly-rewards/leaderboard'), {
      method: 'GET',
      headers: { ...cfg.headersJson, ...cfg.authHeaders },
    });
    const { body } = await readJson(r);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const prizes = body?.data?.prizes;
    assert(prizes, 'prizes object must exist (app banner contract)');
    assertCopySafe(prizes, 'prizes');
    if (EXPECT_RECOGNITION) {
      assert(
        prizes.recognitionOnly === true,
        'LAUNCH GATE: prizes payload must report recognitionOnly:true',
      );
    }
    if (prizes.recognitionOnly === true) {
      assert(prizes.firstPrize === 0, `recognition mode: firstPrize must be 0, got ${prizes.firstPrize}`);
      assert(prizes.otherPrize === 0, `recognition mode: otherPrize must be 0, got ${prizes.otherPrize}`);
      assert(
        (prizes.first?.description ?? '') === '' && (prizes.runnerUp?.description ?? '') === '',
        'recognition mode: localized prize descriptions must be empty (no "EUR 0 digital voucher")',
      );
      for (const s of stringLeaves(prizes)) {
        assert(!VOUCHER_PROMISE.test(s), `recognition mode: voucher promise in copy: "${s.slice(0, 120)}"`);
      }
    } else {
      // Cash mode (future, owner-enabled): amounts must be positive and consistent.
      assert(prizes.firstPrize > 0 && prizes.otherPrize > 0, 'cash mode: amounts must be positive');
    }
  });
  }

  if (!cfg.authHeaders) {
    runner.skip('user_market_resolves_fail_closed', 'no user JWT resolved');
  } else {
    await runner.test('user_market_resolves_fail_closed', async () => {
      const r = await fetch(url(cfg, '/market-rewards/market/mine'), {
        method: 'GET',
        headers: { ...cfg.headersJson, ...cfg.authHeaders },
      });
      const { body } = await readJson(r);
      assert(r.status === 200, `expected 200, got ${r.status}`);
      const market = body?.data;
      assert(market && typeof market.recognitionOnly === 'boolean', 'public market payload missing');
      assert(market.payoutRail === undefined, 'public market payload leaked payout rail');
      assert(market.accountAgeDays === undefined, 'public market payload leaked account-age fraud gate');
      if (market.marketCode === null) {
        assert(market.cashEnabled === false, 'unknown market must fail closed with cash disabled');
        assert(market.recognitionOnly === true, 'unknown market must fail closed to recognition');
      }
      if (market.marketCode === 'EU') {
        assert(market.cashEnabled === false, 'EU user market must keep cash disabled');
        assert(market.recognitionOnly === true, 'EU user market must be recognition-only');
      }
    });
  }

  if (!cfg.authHeaders) {
    runner.skip('mobile_market_reward_contract_isolated', 'no user JWT resolved');
  } else {
    await runner.test('mobile_market_reward_contract_isolated', async () => {
      const marketResponse = await fetch(url(cfg, '/market-rewards/market/mine'), {
        headers: { ...cfg.headersJson, ...cfg.authHeaders },
      });
      const { body: marketBody } = await readJson(marketResponse);
      const market = marketBody?.data;
      assert(marketResponse.status === 200 && market, 'mobile market contract unavailable');

      const boardResponse = await fetch(
        url(cfg, '/home/leaderboard?type=weekly&scope=global&limit=20'),
        { headers: { ...cfg.headersJson, ...cfg.authHeaders } },
      );
      const { body: boardBody } = await readJson(boardResponse);
      const board = boardBody?.data;
      assert(boardResponse.status === 200 && board, 'mobile leaderboard unavailable');
      assert(
        (board.marketRewardConfig?.marketCode ?? null) === (market.marketCode ?? null),
        'leaderboard market differs from /market/mine',
      );
      const expectedDepth = Math.max(5, Math.min(20, market.rewardTiers?.recipientCount || 5));
      assert(
        Array.isArray(board.leaderboard) && board.leaderboard.length <= expectedDepth,
        `leaderboard exceeded market depth ${expectedDepth}`,
      );
      if (market.marketCode === 'KE') {
        assert(market.currency === 'KES', 'Kenya mobile contract must use KES');
        assert(market.rewardTiers?.recipientCount === 10, 'Kenya mobile contract must expose 10 slots');
        assert(market.rewardTiers?.weeklyTotal === 10000, 'Kenya mobile contract must total KES 10,000');
        assert(market.rewardTiers?.feesPaidSeparately === true, 'Kenya mobile contract must disclose separate fees');
      }
      if (market.marketCode === 'EU') {
        assert(market.cashEnabled === false && market.recognitionOnly === true, 'EU mobile lane must be recognition-only');
      }

      const claimsResponse = await fetch(url(cfg, '/market-rewards/claims/mine'), {
        headers: { ...cfg.headersJson, ...cfg.authHeaders },
      });
      const { body: claimsBody } = await readJson(claimsResponse);
      assert(claimsResponse.status === 200 && Array.isArray(claimsBody?.data), 'claim history contract invalid');

      const championsResponse = await fetch(
        url(cfg, `/market-rewards/champions${market.marketCode ? `?marketCode=${market.marketCode}` : ''}`),
        { headers: { ...cfg.headersJson, ...cfg.authHeaders } },
      );
      const { body: championsBody } = await readJson(championsResponse);
      assert(championsResponse.status === 200 && Array.isArray(championsBody?.data), 'reliability wall contract invalid');
      const serialized = JSON.stringify(championsBody.data);
      for (const privateField of ['legalName', 'mobileMoneyNumber', 'payoutIdentityHash']) {
        assert(!serialized.includes(privateField), `reliability wall leaked ${privateField}`);
      }
    });
  }

  await runner.test('public_market_contracts_are_isolated_without_auth', async () => {
    const keResponse = await fetch(url(cfg, '/market-rewards/public/markets/KE'), {
      headers: cfg.headersJson,
    });
    const { body: keBody } = await readJson(keResponse);
    const ke = keBody?.data;
    assert(keResponse.status === 200 && ke, `KE public contract expected 200, got ${keResponse.status}`);
    assert(ke.marketCode === 'KE' && ke.currency === 'KES', 'KE public contract market/currency mismatch');
    assert(
      typeof ke.cashEnabled === 'boolean' && typeof ke.recognitionOnly === 'boolean',
      'KE public activation flags are missing',
    );
    assert(
      !(ke.cashEnabled === true && ke.recognitionOnly === true),
      'KE cannot enable cash while forcing recognition-only rendering',
    );
    assert(ke.rewardTiers?.recipientCount === 10, 'KE public contract must expose 10 recipient slots');
    assert(ke.rewardTiers?.weeklyTotal === 10000, 'KE public contract must total KES 10,000');
    assert(ke.rewardTiers?.feesPaidSeparately === true, 'KE public contract must disclose separate M-Pesa fees');
    assert(ke.payoutRail === undefined, 'KE public contract leaked payout rail');
    assert(ke.accountAgeDays === undefined, 'KE public contract leaked fraud-control configuration');

    const euResponse = await fetch(url(cfg, '/market-rewards/public/markets/EU'), {
      headers: cfg.headersJson,
    });
    const { body: euBody } = await readJson(euResponse);
    const eu = euBody?.data;
    assert(euResponse.status === 200 && eu, `EU public contract expected 200, got ${euResponse.status}`);
    assert(eu.marketCode === 'EU', 'EU public contract market mismatch');
    assert(eu.cashEnabled === false && eu.recognitionOnly === true, 'EU public lane must remain recognition-only');
    assert(eu.rewardTiers?.weeklyTotal === 0, 'EU public contract must suppress dormant cash totals');
    assert(
      Array.isArray(eu.rewardTiers?.schedule) && eu.rewardTiers.schedule.length === 0,
      'EU public contract must suppress dormant cash tiers',
    );

    const hiddenResponse = await fetch(url(cfg, '/market-rewards/public/markets/ZM'), {
      headers: cfg.headersJson,
    });
    assert(hiddenResponse.status === 404, `unlaunched ZM market must remain hidden, got ${hiddenResponse.status}`);
  });

  await runner.test('generic_master_routes_do_not_bypass_market_projection', async () => {
    const sensitive = await fetch(url(cfg, '/master?name=market-config-KE'), {
      headers: cfg.headersJson,
    });
    assert(
      sensitive.status === 404,
      `generic public master route exposed internal KE config with HTTP ${sensitive.status}`,
    );

    const batch = await fetch(url(cfg, '/master/batch?names=market-config-KE'), {
      headers: cfg.headersJson,
    });
    assert(
      batch.status === 403,
      `anonymous master batch route must require admin authentication, got HTTP ${batch.status}`,
    );
  });

  await runner.test('public_reliability_wall_is_ledger_only_and_private', async () => {
    const r = await fetch(url(cfg, '/market-rewards/champions?marketCode=KE'), {
      headers: cfg.headersJson,
    });
    const { body } = await readJson(r);
    assert(r.status === 200, `public Reliability Wall expected 200, got ${r.status}`);
    assert(Array.isArray(body?.data), 'public Reliability Wall data must be an array');
    const serialized = JSON.stringify(body.data);
    for (const privateField of [
      'legalName',
      'mobileMoneyNumber',
      'payoutIdentityHash',
      'paymentReference"',
    ]) {
      assert(!serialized.includes(privateField), `public Reliability Wall leaked ${privateField}`);
    }
    for (const week of body.data) {
      assert(Array.isArray(week.champions) && week.champions.length > 0, 'empty week must not be published');
      for (const recipient of week.champions) {
        assert(recipient.rewarded === true, 'non-recorded recipient appeared on Reliability Wall');
        assert(Number(recipient.rewardAmount) > 0, 'published recipient lacks ledger amount');
        assert(recipient.paidAt, 'published recipient lacks ledger payment date');
        assert(
          typeof recipient.paymentReferencePrefix === 'string' &&
            recipient.paymentReferencePrefix.length <= 4,
          'payment reference was not safely truncated',
        );
      }
    }
  });

  await runner.test('legal_masters_recognition_first_wording', async () => {
    async function fetchMaster(name, lang) {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const r = await fetch(url(cfg, `/master?name=${name}&lang=${lang}`), {
            method: 'GET',
            headers: cfg.headersJson,
          });
          const { body } = await readJson(r);
          return { status: r.status, body };
        } catch (err) {
          lastErr = err;
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      throw lastErr;
    }

    for (const [lang, updatedLabel] of Object.entries(LEGAL_LANGS)) {
      for (const name of ['terms-of-us', 'privacy-policy', 'gdpr-compliance']) {
        const { status, body } = await fetchMaster(name, lang);
        assert(status === 200, `${name}/${lang}: expected 200, got ${status}`);
        const html =
          body?.data?.[0]?.metadata?.[0] ?? body?.data?.metadata?.[0] ?? '';
        assert(
          typeof html === 'string' && html.length > 1000,
          `${name}/${lang}: master HTML missing/too short`,
        );
        const plain = html.replace(/<[^>]+>/g, ' ');
        assert(plain.includes(updatedLabel), `${name}/${lang}: localized update label missing`);
        assert(!plain.includes('draw entries'), `${name}/${lang}: "draw entries" still present`);
        assert(!BRAND_VIOLATIONS.test(plain), `${name}/${lang}: brand-violating word present`);
        assert(
          !/top 5 users[^.]*receive digital vouchers/i.test(plain),
          `${name}/${lang}: active voucher promise still present`,
        );
        if (name === 'terms-of-us') {
          assert(/\bKES\b/.test(plain) && /\bM.?Pesa\b/.test(plain), `${name}/${lang}: Kenya terms missing`);
          assert(/\b10[.,\s]?000\b/.test(plain), `${name}/${lang}: KES 10,000 total missing`);
        }
      }
    }
  });

  await runner.test('landing_data_prize_and_stats_recognition_safe', async () => {
    const r = await fetch(url(cfg, '/home/landing-data'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    const { body } = await readJson(r);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const d = body?.data;
    assert(d, 'landing-data payload missing');
    const prize = d.landingPrize;
    if (EXPECT_RECOGNITION) {
      assert(
        prize?.recognitionOnly === true,
        'LAUNCH GATE: landingPrize must report recognitionOnly:true',
      );
    }
    if (prize?.recognitionOnly === true) {
      assert(
        (prize.firstPrize ?? 0) === 0 && (prize.otherPrize ?? 0) === 0,
        `recognition mode: landingPrize amounts must be 0 (got ${prize.firstPrize}/${prize.otherPrize})`,
      );
    }
    // The landing impact section renders these live counts (no invented figures).
    const stats = d.communityStats;
    assert(stats, 'communityStats missing (landing impact section would render dashes)');
    for (const k of ['totalUsers', 'totalSortProofs', 'co2KgAvoided']) {
      assert(typeof stats[k] === 'number', `communityStats.${k} must be a number`);
    }
  });

  const adminJwt = (process.env.PLASTYPESA_ADMIN_JWT || '').trim();
  if (!adminJwt) {
    runner.skip(
      'market_config_ranked_schedule_isolated',
      'PLASTYPESA_ADMIN_JWT not set (admin-only endpoint)',
    );
    return;
  }
  await runner.test('market_config_ranked_schedule_isolated', async () => {
    const r = await fetch(url(cfg, '/market-rewards/admin/markets'), {
      method: 'GET',
      headers: { ...cfg.headersJson, Authorization: `Bearer ${adminJwt}` },
    });
    const { body } = await readJson(r);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const markets = Array.isArray(body?.data) ? body.data : body?.data?.markets;
    assert(Array.isArray(markets) && markets.length >= 3, 'expected >=3 markets (KE, EU, ZM)');
    const ke = markets.find((m) => m.marketCode === 'KE');
    const eu = markets.find((m) => m.marketCode === 'EU');
    assert(ke?.currency === 'KES', `KE currency must be KES, got ${ke?.currency}`);
    assert(ke?.recognitionOnly === false, 'KE must be an independently configurable cash market');
    assert(ke?.payoutRail === 'manual_mpesa', 'KE payout rail must be manual M-Pesa');
    assert(ke?.rewardTiers?.recipientCount === 10, 'KE must have 10 deterministic recipient slots');
    assert(ke?.rewardTiers?.weeklyTotal === 10000, 'KE schedule must total exactly KES 10,000');
    assert(ke?.rewardTiers?.feesPaidSeparately === true, 'KE transfer fees must be paid separately');
    assert(
      JSON.stringify(ke?.rewardTiers?.schedule) === JSON.stringify([
        { rankFrom: 1, rankTo: 1, amount: 4500 },
        { rankFrom: 2, rankTo: 2, amount: 2500 },
        { rankFrom: 3, rankTo: 3, amount: 1600 },
        { rankFrom: 4, rankTo: 10, amount: 200 },
      ]),
      `KE schedule mismatch: ${JSON.stringify(ke?.rewardTiers?.schedule)}`,
    );
    assert(eu?.recognitionOnly === true, 'EU must be recognitionOnly');
    assert(eu?.cashEnabled === false, 'EU cash must remain disabled');
  });
}

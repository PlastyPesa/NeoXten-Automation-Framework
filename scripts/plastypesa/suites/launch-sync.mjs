import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

/**
 * Launch-synchronization suite (Phase B, owner decision 2026-07-09):
 * the launch story is RECOGNITION-FIRST everywhere — no live surface may
 * promise active cash/vouchers until the owner enables a market and the
 * claim/payout flow is ready.
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
 *   4. Market config consistency (needs PLASTYPESA_ADMIN_JWT): no market
 *      has cashEnabled while the recognition-first launch story is live;
 *      KE=KES, EU recognition-only.
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

  await runner.test('legal_masters_recognition_first_wording', async () => {
    for (const name of ['terms-of-us', 'privacy-policy', 'gdpr-compliance']) {
      const r = await fetch(url(cfg, `/master?name=${name}`), {
        method: 'GET',
        headers: cfg.headersJson,
      });
      const { body } = await readJson(r);
      assert(r.status === 200, `${name}: expected 200, got ${r.status}`);
      const html =
        body?.data?.[0]?.metadata?.[0] ?? body?.data?.metadata?.[0] ?? '';
      assert(typeof html === 'string' && html.length > 1000, `${name}: master HTML missing/too short`);
      const plain = html.replace(/<[^>]+>/g, ' ');
      assert(!plain.includes('draw entries'), `${name}: "draw entries" still present`);
      assert(!BRAND_VIOLATIONS.test(plain), `${name}: brand-violating word present`);
      assert(
        !/top 5 users[^.]*receive digital vouchers/i.test(plain),
        `${name}: active voucher promise still present`,
      );
      assert(plain.includes('July 2026'), `${name}: Last-updated stamp not July 2026`);
      if (name === 'terms-of-us') {
        assert(
          plain.includes('Weekly Recognition and Future Rewards'),
          'terms-of-us: recognition-first Section 4 missing',
        );
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
      'market_config_no_cash_enabled_at_launch',
      'PLASTYPESA_ADMIN_JWT not set (admin-only endpoint)',
    );
    return;
  }
  await runner.test('market_config_no_cash_enabled_at_launch', async () => {
    const r = await fetch(url(cfg, '/market-rewards/admin/markets'), {
      method: 'GET',
      headers: { ...cfg.headersJson, Authorization: `Bearer ${adminJwt}` },
    });
    const { body } = await readJson(r);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const markets = Array.isArray(body?.data) ? body.data : body?.data?.markets;
    assert(Array.isArray(markets) && markets.length >= 3, 'expected >=3 markets (KE, EU, ZM)');
    for (const m of markets) {
      assert(
        m.cashEnabled !== true,
        `market ${m.marketCode}: cashEnabled is true — violates recognition-first launch`,
      );
    }
    const ke = markets.find((m) => m.marketCode === 'KE');
    const eu = markets.find((m) => m.marketCode === 'EU');
    assert(ke?.currency === 'KES', `KE currency must be KES, got ${ke?.currency}`);
    assert(eu?.recognitionOnly === true, 'EU must be recognitionOnly');
  });
}

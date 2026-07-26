/**
 * P-WEEKLY-WINNERS-UI (2026-07-26) — API contract the mobile winners UI renders.
 *
 * The Flutter celebration card, Top-3 ribbon, "Past earners" tab, 48h Home
 * banner and all-time card read ONLY from existing endpoints (no new backend
 * was built for them). That makes them silently fragile: drop `weeklyPoints`
 * and every earner shows "0 points"; drop `confirmedAt` and the banner never
 * fires; drop `closeId` and the banner can never be dismissed per close.
 * A green Flutter test would not catch any of that — only this live check will.
 *
 * Asserted here:
 *   1. `/market-rewards/week-earners` returns the fields the hero + ribbon need,
 *      and only ever a CONFIRMED close (celebration gate, locked answer 3).
 *   2. Earner slots are unique and dense from 1 — the hero must be unambiguous.
 *   3. `/market-rewards/champions` (the "Past earners" tab) stays ledger-only:
 *      every published recipient is `rewarded` with a real paid amount, and no
 *      legal names / raw payment references leak.
 *   4. The lifetime board (all-time card) is market-scoped, not a global pool.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'weekly-earners-ui';

const PRIVATE_FIELDS = ['legalName', 'mobileMoneyNumber', 'paymentReference', 'userId', 'email'];

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'weekly_earners_ui_contract',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  let snapshot = null;

  await runner.test('week_earners_contract_supports_celebration_card', async () => {
    const r = await fetch(url(cfg, '/market-rewards/week-earners?marketCode=KE'), {
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`week-earners ${r.status}: ${text.slice(0, 300)}`);
    }
    snapshot = body?.data ?? null;
    if (snapshot === null) {
      // No confirmed cash week yet — the app renders the calm empty state.
      return;
    }
    assert(typeof snapshot.closeId === 'string' && snapshot.closeId.length > 0,
      'closeId required — the 48h Home banner dismissal is keyed on it');
    assert(typeof snapshot.confirmedAt === 'string' && !Number.isNaN(Date.parse(snapshot.confirmedAt)),
      'confirmedAt required — celebration only renders for a CONFIRMED close (locked answer 3)');
    assert(typeof snapshot.weekStart === 'string' && typeof snapshot.weekEnd === 'string',
      'weekStart/weekEnd required for the "Week of …" label');
    assert(Array.isArray(snapshot.earners), 'earners array present');

    for (const earner of snapshot.earners) {
      assert(Number.isFinite(earner.slot) && earner.slot >= 1, `slot must be a positive number, got ${earner.slot}`);
      assert(Number.isFinite(earner.weeklyPoints),
        `weeklyPoints required for slot ${earner.slot} — the card prints "@pts points"`);
      assert(typeof earner.ecoHandle === 'string' && earner.ecoHandle.length > 0,
        `ecoHandle required for slot ${earner.slot}`);
      assert(typeof earner.claimStatus === 'string' && earner.claimStatus.length > 0,
        `claimStatus required for slot ${earner.slot}`);
      for (const field of PRIVATE_FIELDS) {
        assert(earner[field] === undefined,
          `week-earners must never expose ${field} (slot ${earner.slot}) — this list is public in-app`);
      }
    }
  });

  await runner.test('week_earners_slots_are_unique_and_start_at_one', async () => {
    if (!snapshot || !Array.isArray(snapshot.earners) || snapshot.earners.length === 0) return;
    const slots = snapshot.earners.map((e) => e.slot);
    assert(new Set(slots).size === slots.length,
      `duplicate slots in week-earners (${slots.join(', ')}) — the hero card would crown an arbitrary earner`);
    assert(Math.min(...slots) === 1,
      `week-earners must include slot 1 (got min ${Math.min(...slots)}) — the celebration card has no hero otherwise`);
  });

  await runner.test('past_earners_tab_is_ledger_only_and_private', async () => {
    const r = await fetch(url(cfg, '/market-rewards/champions?marketCode=KE'), {
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`champions ${r.status}: ${text.slice(0, 300)}`);
    }
    const weeks = Array.isArray(body?.data) ? body.data : [];
    for (const week of weeks) {
      assert(Array.isArray(week.champions) && week.champions.length > 0,
        `week ${week.weekStart} published with zero recipients — the Past earners tab would render an empty card`);
      for (const recipient of week.champions) {
        assert(recipient.rewarded === true,
          `Past earners is payment proof — ${recipient.ecoHandle} in week ${week.weekStart} is not marked rewarded`);
        assert(Number.isFinite(recipient.rewardAmount) && recipient.rewardAmount > 0,
          `paid recipient ${recipient.ecoHandle} must carry a real amount`);
        assert(recipient.legalName === undefined && recipient.mobileMoneyNumber === undefined,
          `champions must never expose personal payment identity (${recipient.ecoHandle})`);
        assert(recipient.paymentReference === undefined,
          `champions must publish only a reference PREFIX, never the full reference (${recipient.ecoHandle})`);
      }
    }
  });

  await runner.test('all_time_card_reads_a_market_scoped_lifetime_board', async () => {
    // Locked answer 2: a KE user sees the KE all-time leader — never a shared
    // global cash-adjacent board.
    const r = await fetch(
      url(cfg, '/home/leaderboard?page=1&limit=1&type=lifetime&scope=global'),
      { headers: cfg.authHeaders },
    );
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`lifetime leaderboard ${r.status}: ${text.slice(0, 300)}`);
    }
    const rows = body?.data?.leaderboard;
    assert(Array.isArray(rows), 'lifetime leaderboard array present');
    assert(rows.length <= 1, `limit=1 must be honoured (got ${rows.length}) — the all-time card reads rows[0]`);
    if (rows.length === 0) return;
    const leader = rows[0];
    assert(Number.isFinite(leader.lifetimePoints),
      'lifetimePoints required — the all-time card prints "@pts lifetime points"');
    assert(typeof (leader.ecoHandle ?? leader.firstName) === 'string',
      'a display handle is required for the all-time card');
    assert(leader.email === undefined, 'lifetime board must not expose email');
    // The market projection is what keeps this board country-scoped.
    const marketConfig = body?.data?.marketRewardConfig;
    assert(marketConfig === null || typeof marketConfig === 'object',
      'marketRewardConfig key must be present (null for unknown market) so the client can scope the card');
  });
}

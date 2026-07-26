/**
 * P-SOCIAL-PROOF-PRESENCE Phase 1 (2026-07-26) — the community pulse contract.
 *
 * This card is the first thing a Kenyan user sees under their own points, so
 * every one of its numbers is a trust claim. The dangerous failures are not
 * crashes — they are plausible-looking wrong numbers:
 *
 *   * `members` drifting toward the registration count would advertise the 82
 *     SUSPENDED fraud accounts as community (135 registrations vs 41 ACTIVE on
 *     the day this shipped),
 *   * `onlineNow` returning 0 or 1 instead of null would print "0 online" on a
 *     home screen — worse than saying nothing,
 *   * `weeklyActive` exceeding `members` would be arithmetically impossible and
 *     instantly readable as fake,
 *   * the milestone strip switching itself on would promise a KES 15,000 pool
 *     that nobody has funded.
 *
 * A Flutter widget test cannot see any of that: it renders whatever JSON it is
 * handed. Only a live assertion against production can.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'community-pulse';

/** Locked by the owner 2026-07-26: 6750 + 3750 + 2400 + (300 x 7) = 15,000. */
const EXPECTED_POOL = 15000;
const EXPECTED_TARGET = 500;

/**
 * Hard product floor: below this many people online the API must return null.
 * Mirrors ONLINE_MIN_TO_SHOW in community_pulse.service.js.
 */
const ONLINE_MIN_TO_SHOW = 3;

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'community_pulse_contract',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  let pulse = null;

  await runner.test('community_pulse_is_authenticated_only', async () => {
    // The card counts real people. An unauthenticated caller must not be able
    // to scrape community size, and must never trip the presence write.
    const r = await fetch(url(cfg, '/community/pulse'));
    assert(
      r.status === 401 || r.status === 403,
      `unauthenticated /community/pulse should be rejected, got ${r.status}`,
    );
  });

  await runner.test('community_pulse_returns_the_shape_the_card_renders', async () => {
    const r = await fetch(url(cfg, '/community/pulse'), { headers: cfg.authHeaders });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`community/pulse ${r.status}: ${text.slice(0, 300)}`);
    }
    pulse = body?.data ?? null;
    assert(pulse !== null, 'pulse payload is null — the card would never render');

    assert(Number.isInteger(pulse.members) && pulse.members >= 0,
      `members must be a non-negative integer, got ${JSON.stringify(pulse.members)}`);
    assert(Number.isInteger(pulse.weeklyActive) && pulse.weeklyActive >= 0,
      `weeklyActive must be a non-negative integer, got ${JSON.stringify(pulse.weeklyActive)}`);
    assert(pulse.onlineNow === null || Number.isInteger(pulse.onlineNow),
      `onlineNow must be an integer or null, got ${JSON.stringify(pulse.onlineNow)}`);
    assert(pulse.milestone && typeof pulse.milestone === 'object',
      'milestone block required — the leaderboard strip reads it');
  });

  await runner.test('members_excludes_suspended_and_never_leaks_registrations', async () => {
    if (!pulse) return;
    // Live reality on 2026-07-26: 135 registrations, 41 ACTIVE, 82 SUSPENDED
    // (a fraud cleanup), 11 INACTIVE. If `members` ever climbs toward the
    // registration count, the exclusion filter has regressed and the app is
    // advertising a fraud ring as its community.
    const r = await fetch(
      url(cfg, '/home/leaderboard?page=1&limit=1&type=lifetime&scope=global'),
      { headers: cfg.authHeaders },
    );
    const { body } = await readJson(r);
    const totalRanked = Number(body?.data?.total);

    if (Number.isFinite(totalRanked) && totalRanked > 0) {
      // The lifetime board ranks ACTIVE non-admin users. Pulse uses a strictly
      // tighter filter (it also drops operator accounts), so it can never
      // exceed the board.
      assert(pulse.members <= totalRanked,
        `members (${pulse.members}) exceeds the ranked ACTIVE population (${totalRanked}) — ` +
          'the SUSPENDED/INACTIVE exclusion has regressed');
    }

    assert(pulse.members < 100,
      `members = ${pulse.members}; at this stage of launch that is far above the known ACTIVE ` +
        'population and suggests raw registrations are being counted. Re-check activeUserMatch ' +
        'before raising this bound.');
    assert(pulse.registrations === undefined && pulse.totalUsers === undefined,
      'the pulse payload must never expose a raw registration count');
  });

  await runner.test('weekly_active_cannot_exceed_members', async () => {
    if (!pulse) return;
    // Both counts run through the same activeUserMatch filter, so this is an
    // invariant, not a coincidence. Breaking it means the two numbers on one
    // card came from two different populations.
    assert(pulse.weeklyActive <= pulse.members,
      `weeklyActive (${pulse.weeklyActive}) > members (${pulse.members}) — ` +
        'the two counts are no longer drawn from the same population');
  });

  await runner.test('online_now_is_null_below_the_floor_never_zero', async () => {
    if (!pulse) return;
    if (pulse.onlineNow === null) return; // the quiet case, which is correct
    assert(pulse.onlineNow >= ONLINE_MIN_TO_SHOW,
      `onlineNow = ${pulse.onlineNow}; anything below ${ONLINE_MIN_TO_SHOW} must be returned as ` +
        'null so the client cannot render "0 online" / "1 online"');
    assert(pulse.onlineNow <= pulse.members,
      `onlineNow (${pulse.onlineNow}) exceeds members (${pulse.members})`);
  });

  await runner.test('milestone_stays_behind_the_funding_gate', async () => {
    if (!pulse) return;
    const m = pulse.milestone;
    assert(typeof m.enabled === 'boolean', 'milestone.enabled must be a boolean switch');
    assert(m.target === EXPECTED_TARGET,
      `milestone target must stay ${EXPECTED_TARGET} (got ${m.target}) — the copy names this number`);
    assert(m.futureWeeklyPool === EXPECTED_POOL,
      `milestone pool must stay ${EXPECTED_POOL} (got ${m.futureWeeklyPool})`);

    if (Array.isArray(m.futureSchedule) && m.futureSchedule.length > 0) {
      const total = m.futureSchedule.reduce(
        (sum, row) => sum + row.amount * (row.rankTo - row.rankFrom + 1),
        0,
      );
      assert(total === EXPECTED_POOL,
        `futureSchedule sums to ${total}, not the advertised pool ${EXPECTED_POOL} — ` +
          'the strip would promise money the schedule does not pay out');
    }

    if (!m.enabled) {
      // Shipping default until the owner confirms funding. The client hides the
      // whole strip; nothing else in the payload may imply the pool is live.
      assert(m.currentKeMembers === null || Number.isInteger(m.currentKeMembers),
        'currentKeMembers must be null or an integer while the gate is closed');
    } else {
      assert(Number.isInteger(m.currentKeMembers) && m.currentKeMembers >= 0,
        'an enabled milestone must carry a real KE member count to render progress against');
      assert(m.currentKeMembers <= pulse.members,
        `currentKeMembers (${m.currentKeMembers}) exceeds global members (${pulse.members})`);
    }
  });

  await runner.test('pulse_is_cached_and_internally_consistent', async () => {
    if (!pulse) return;
    // Two reads inside the 60s window must be identical. Users compare the Home
    // card with the Leaderboard card seconds apart; different numbers on the two
    // screens read as invented.
    const r = await fetch(url(cfg, '/community/pulse'), { headers: cfg.authHeaders });
    const { body } = await readJson(r);
    const second = body?.data;
    assert(second, 'second pulse read returned no data');
    assert(second.members === pulse.members,
      `members changed between reads (${pulse.members} -> ${second.members}) — the 60s cache is not holding`);
    assert(second.weeklyActive === pulse.weeklyActive,
      `weeklyActive changed between reads (${pulse.weeklyActive} -> ${second.weeklyActive})`);
    assert(second.onlineNow === pulse.onlineNow,
      `onlineNow changed between reads (${pulse.onlineNow} -> ${second.onlineNow})`);
  });

  await runner.test('presence_touch_does_not_break_authenticated_requests', async () => {
    // The middleware writes lastAppSeenAt after res.end on every authenticated
    // request. A regression there (throwing before next(), or double-ending the
    // response) would take down the entire authenticated API, so prove a normal
    // profile read still succeeds and still returns its body intact.
    const r = await fetch(url(cfg, '/user/my-profile'), { headers: cfg.authHeaders });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`user/my-profile ${r.status}: ${text.slice(0, 300)}`);
    }
    assert(body?.data && typeof body.data === 'object',
      'profile body missing — presence middleware may be interfering with res.end');
  });
}

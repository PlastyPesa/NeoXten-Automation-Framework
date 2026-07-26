/**
 * P-POINTS-SWISS-CLOCK (2026-07-26) — competition-week boundary regression.
 *
 * Product truth: week = Monday 00:00 UTC → Sunday 23:59:59 UTC; all-day Sunday
 * the board still shows this week; Monday 00:00 UTC the weekly board zeros;
 * lifetime never resets. One-time extended cutover week Jul 19 → Jul 27 2026
 * (P-AAB-WEEKLY-CONTINUITY: restores the pre-wipe board; Monday era from
 * Jul 27 — replaced the earlier Jul 26 → Aug 3 transition plan).
 *
 * These tests assert the LIVE API serves the correct week regime — the exact
 * failure that caused the 2026-07-26 trust incident (Sunday reset seen by
 * Kenya users + open-ended weekly close window paying the wrong week).
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'swiss-clock-week';

const TRANSITION_START_MS = Date.UTC(2026, 6, 19); // Jul 19 2026 00:00 UTC (extended cutover week)
const MONDAY_EPOCH_MS = Date.UTC(2026, 6, 27);     // Jul 27 2026 00:00 UTC (Monday era)

function expectedWeekStartMs(nowMs) {
  if (nowMs >= MONDAY_EPOCH_MS) {
    const d = new Date(nowMs);
    const dayStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const mondayOffset = (new Date(dayStartMs).getUTCDay() + 6) % 7;
    return dayStartMs - mondayOffset * 86400000;
  }
  if (nowMs >= TRANSITION_START_MS) return TRANSITION_START_MS;
  // Legacy Sunday weeks (only reachable if this suite runs against history).
  const d = new Date(nowMs);
  const dayStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return dayStartMs - new Date(dayStartMs).getUTCDay() * 86400000;
}

function expectedResetMs(nowMs) {
  if (nowMs >= MONDAY_EPOCH_MS) return expectedWeekStartMs(nowMs) + 7 * 86400000;
  if (nowMs >= TRANSITION_START_MS) return MONDAY_EPOCH_MS;
  return expectedWeekStartMs(nowMs) + 7 * 86400000;
}

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'swiss_clock_week_bounds',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('earn_hub_week_start_matches_swiss_clock', async () => {
    const r = await fetch(url(cfg, '/home/earn-hub'), { headers: cfg.authHeaders });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`earn-hub ${r.status}: ${text.slice(0, 300)}`);
    }
    const weekStartUtc = body?.data?.communityProgress?.weekStartUtc;
    assert(typeof weekStartUtc === 'string', 'communityProgress.weekStartUtc present');
    const expected = new Date(expectedWeekStartMs(Date.now())).toISOString();
    assert(
      weekStartUtc === expected,
      `weekStartUtc must be ${expected} (Swiss-clock regime), got ${weekStartUtc}`,
    );
  });

  await runner.test('leaderboard_countdown_targets_monday_reset', async () => {
    const r = await fetch(url(cfg, '/weekly-rewards/leaderboard'), {
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`leaderboard ${r.status}: ${text.slice(0, 300)}`);
    }
    const cd = body?.data?.countdown;
    assert(cd && Number.isFinite(cd.days), 'countdown present');
    const nowMs = Date.now();
    const targetMs = nowMs + cd.days * 86400000 + cd.hours * 3600000 + cd.minutes * 60000;
    const expected = expectedResetMs(nowMs);
    const deltaMin = Math.abs(targetMs - expected) / 60000;
    assert(
      deltaMin <= 5,
      `countdown must target ${new Date(expected).toISOString()} — got ${new Date(targetMs).toISOString()} (Δ ${deltaMin.toFixed(1)} min). An open-ended / Sunday-based window is the 2026-07-26 regression.`,
    );
    // From the Monday epoch the reset instant must always be a Monday.
    if (nowMs >= MONDAY_EPOCH_MS) {
      assert(
        new Date(expected).getUTCDay() === 1,
        'reset instant must be a Monday 00:00 UTC',
      );
    }
  });
}

import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

/**
 * Daily-quiz continuity suite (Phase E, owner requirement 2026-07-11).
 *
 * Daily Quiz is a core launch feature. This gate asserts, against the live
 * API exactly as the app calls it (`POST /game/all`, status ["ACTIVE"]):
 *
 *   1. EXACTLY ONE automated daily quiz is ACTIVE — zero means users see
 *      "No daily quiz today" (content gap / expiry bug); more than one means
 *      the publish path failed to rotate the previous quiz out.
 *   2. The ACTIVE quiz is FRESH: createdAt within the last 36 hours.
 *      The automation republishes ~every 23h (5-min cron, 23h cadence check),
 *      so a healthy pipeline never leaves a quiz older than ~24h ACTIVE;
 *      36h = one full cadence + 13h of cron/approval slack. If automation
 *      stops publishing, the previous quiz intentionally stays ACTIVE
 *      (Phase E expiry-skip keeps content available) — this test is the
 *      alarm that turns that silent staleness into a loud failure instead
 *      of reporting continuity as healthy.
 *
 * Requires a user JWT (same auth as the app); skips without one.
 */
export const id = 'daily-quiz-continuity';

const FRESH_WINDOW_MS = 36 * 60 * 60 * 1000;

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'exactly_one_fresh_active_daily_quiz',
      'no user JWT resolved (authenticated endpoint)',
    );
    return;
  }

  await runner.test('exactly_one_fresh_active_daily_quiz', async () => {
    const r = await fetch(url(cfg, '/game/all'), {
      method: 'POST',
      headers: { ...cfg.headersJson, ...cfg.authHeaders },
      body: JSON.stringify({
        page: 1,
        limit: 100,
        sort: { createdAt: -1 },
        status: ['ACTIVE'],
      }),
    });
    const { body } = await readJson(r);
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const rows = Array.isArray(body?.data) ? body.data : [];

    // The app-facing projection exposes `dailyQuiz` but not `isAutomated`
    // (only the automation publish path creates dailyQuiz:true games today,
    // and its rotation flips ALL prior ACTIVE dailyQuiz rows to COMPLETED,
    // so exactly-one-on-dailyQuiz IS the automated-pipeline invariant).
    const dailies = rows.filter(
      (g) => g.dailyQuiz === true && g.isAutomated !== false,
    );
    assert(
      dailies.length === 1,
      dailies.length === 0
        ? 'NO ACTIVE automated daily quiz — users see "No daily quiz today" (publish pipeline down or quiz wrongly expired)'
        : `${dailies.length} ACTIVE automated daily quizzes — publish rotation failed to complete the previous quiz`,
    );

    const quiz = dailies[0];
    const created = new Date(quiz.createdAt).getTime();
    assert(
      Number.isFinite(created),
      `active daily quiz "${quiz.title}" has unparseable createdAt: ${quiz.createdAt}`,
    );
    const ageH = (Date.now() - created) / 3600000;
    assert(
      Date.now() - created <= FRESH_WINDOW_MS,
      `STALE daily quiz: "${quiz.title}" is ${ageH.toFixed(1)}h old (limit 36h) — automation has stopped publishing; the old quiz stays ACTIVE by design (expiry-skip) but content is no longer fresh`,
    );

    // Sanity: it must be a playable shell — the quiz content doc and reward
    // link the app needs to start the game must both be present.
    assert(
      typeof quiz.quizGameId === 'string' && quiz.quizGameId.length > 0,
      `active daily quiz "${quiz.title}" has no quizGameId (no playable questions doc)`,
    );
    assert(
      quiz.rewardId != null,
      `active daily quiz "${quiz.title}" has no rewardId`,
    );
  });
}

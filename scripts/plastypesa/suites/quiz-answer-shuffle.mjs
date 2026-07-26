/**
 * Anti-cheat: playable quiz must not expose correctAnswerIndex and must not
 * serve every question with the correct option at position A (index 0).
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'quiz-answer-shuffle';

/** Redaction only applies to players; admin payloads keep correctAnswerIndex. */
function jwtIsAdmin(authHeaders) {
  try {
    const token = (authHeaders?.Authorization || '').replace(/^Bearer\s+/, '');
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    );
    const roles = Array.isArray(payload.role) ? payload.role : [payload.role];
    return roles.some((r) => String(r).toLowerCase() === 'admin');
  } catch {
    return false;
  }
}

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'quiz_options_shuffled_for_player',
      'No JWT — set PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }
  if (jwtIsAdmin(cfg.authHeaders)) {
    runner.skip(
      'quiz_options_shuffled_for_player',
      'Admin JWT in use — admin payloads keep correctAnswerIndex by design; ' +
        'run .local-player-redaction-probe.mjs for the player-perspective proof',
    );
    return;
  }

  await runner.test('quiz_options_shuffled_for_player', async () => {
    const listRes = await fetch(url(cfg, '/game/all'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({
        page: 1,
        limit: 5,
        sort: { createdAt: -1 },
        status: ['ACTIVE'],
      }),
    });
    const listBody = await readJson(listRes);
    if (listRes.status !== 200) {
      throw new Error(`game/all ${listRes.status}: ${listBody.text?.slice(0, 200)}`);
    }
    const games = listBody.body?.data || [];
    assert(Array.isArray(games) && games.length > 0, 'at least one ACTIVE game');
    const gameId = games[0]._id || games[0].id;
    assert(gameId, 'ACTIVE game id');

    const quizRes = await fetch(url(cfg, `/game/${gameId}`), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const quizBody = await readJson(quizRes);
    if (quizRes.status !== 200) {
      throw new Error(`game/${gameId} ${quizRes.status}: ${quizBody.text?.slice(0, 200)}`);
    }
    const questions = quizBody.body?.data?.quiz?.questions;
    assert(Array.isArray(questions) && questions.length > 0, 'quiz questions present');

    let atPositionA = 0;
    const positionSet = new Set();
    for (const q of questions) {
      assert(
        q.correctAnswerIndex === undefined,
        'correctAnswerIndex must not be exposed to players',
      );
      assert(Array.isArray(q.options) && q.options.length >= 2, 'options array');
      assert(typeof q.answer === 'string' && q.answer.length > 0, 'answer text present');
      const idx = q.options.indexOf(q.answer);
      assert(idx >= 0, 'answer must be one of the shuffled options');
      positionSet.add(idx);
      if (idx === 0) atPositionA++;
    }

    assert(
      atPositionA < questions.length,
      `all ${questions.length} questions had correct answer at A — shuffle not applied`,
    );
    if (questions.length >= 3) {
      assert(
        positionSet.size >= 2,
        `correct answer landed on the same option letter for all ${questions.length} questions — weak shuffle seed`,
      );
    }
  });
}

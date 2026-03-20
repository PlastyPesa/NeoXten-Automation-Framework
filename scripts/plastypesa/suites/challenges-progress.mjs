import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'challenges-progress';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'challenges_progress_bundle',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('challenges_active_includes_progress_shape', async () => {
    const r = await fetch(url(cfg, '/challenges/active'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`challenges/active ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(Array.isArray(body?.data), 'data array');
    for (const ch of body.data) {
      assert(ch?.progress && typeof ch.progress === 'object', 'challenge.progress');
      assert(typeof ch.progress.currentCount === 'number', 'progress.currentCount');
      assert(typeof ch.progress.completed === 'boolean', 'progress.completed');
      assert(
        ch.progress.completedAt === null || typeof ch.progress.completedAt === 'string',
        'progress.completedAt',
      );
    }
  });

  await runner.test('check_progress_invalid_action_400', async () => {
    const r = await fetch(url(cfg, '/challenges/check-progress'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({ actionType: 'INVALID' }),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 400) {
      throw new Error(`expected 400 invalid actionType, got ${r.status}: ${text.slice(0, 200)}`);
    }
    assert(body?.type === 'error', 'error type');
  });

  await runner.test('check_progress_sort_success_array_shape', async () => {
    const r = await fetch(url(cfg, '/challenges/check-progress'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({ actionType: 'SORT' }),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`check-progress SORT ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(Array.isArray(body?.data), 'data is array');
    for (const row of body.data) {
      assert(row?.challengeId != null, 'row.challengeId');
      assert(typeof row.title === 'string', 'row.title');
      assert(typeof row.currentCount === 'number', 'row.currentCount');
      assert(typeof row.targetCount === 'number', 'row.targetCount');
      assert(typeof row.completed === 'boolean', 'row.completed');
    }
  });
}

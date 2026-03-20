import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'user-profile';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'user_profile_bundle',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('my_profile_success_shape', async () => {
    const r = await fetch(url(cfg, '/user/my-profile'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`my-profile ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const u = body?.data;
    assert(u && typeof u === 'object', 'data user');
    assert(u._id, 'user._id');
    assert(typeof u.points === 'number', 'points number');
    assert(u.weeklyStats && typeof u.weeklyStats === 'object', 'weeklyStats');
    assert(u.lifetimeStats && typeof u.lifetimeStats === 'object', 'lifetimeStats');
    assert(typeof u.weeklyStats.totalPoints === 'number', 'weeklyStats.totalPoints');
    assert(typeof u.lifetimeStats.totalPoints === 'number', 'lifetimeStats.totalPoints');
  });

  await runner.test('profile_completion_shape', async () => {
    const r = await fetch(url(cfg, '/user/completion-percentage'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`completion-percentage ${r.status}: ${text.slice(0, 300)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(typeof d.completionPercentage === 'number', 'completionPercentage');
    assert(d.completionPercentage >= 0 && d.completionPercentage <= 100, '0..100');
    assert(typeof d.totalFields === 'number', 'totalFields');
    assert(Array.isArray(d.missingFields), 'missingFields array');
  });
}

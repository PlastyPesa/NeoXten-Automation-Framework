import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'regression-core';

export async function run(cfg, runner) {
  await runner.test('weekly_rewards_leaderboard_requires_auth', async () => {
    const r = await fetch(url(cfg, '/weekly-rewards/leaderboard'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  if (!cfg.authHeaders) {
    runner.skip(
      'regression_authenticated_bundle',
      'Set PLASTYPESA_USER_JWT for winners wall, reward history, challenges',
    );
    return;
  }

  await runner.test('winners_wall_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/weekly-rewards/winners-wall'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`winners-wall ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(Array.isArray(body?.data), 'data is array');
    for (const row of body.data) {
      assert(typeof row.weekRange === 'string', 'weekRange');
      assert(Array.isArray(row.topWinners), 'topWinners array');
      for (const w of row.topWinners) {
        assert(typeof w.name === 'string', 'winner.name');
        assert(typeof w.points === 'number', 'winner.points');
        assert(typeof w.prize === 'string', 'winner.prize');
      }
    }
  });

  await runner.test('reward_history_weekly_shape', async () => {
    const r = await fetch(
      url(cfg, '/transaction/reward-history?type=weekly&page=1&limit=5'),
      { method: 'GET', headers: cfg.authHeaders },
    );
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`reward-history ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d?.period === 'weekly', 'period weekly');
    assert(d?.summary && typeof d.summary === 'object', 'summary');
    assert(typeof d.summary.totalEntries === 'number', 'totalEntries');
    assert(typeof d.summary.totalPoints === 'number', 'totalPoints');
    assert(Array.isArray(d.history), 'history array');
  });

  await runner.test('challenges_active_shape', async () => {
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
  });

  await runner.test('badges_definitions_shape', async () => {
    const r = await fetch(url(cfg, '/home/badges'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`badges ${r.status}: ${text.slice(0, 300)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(Array.isArray(body?.data), 'data array');
    if (body.data.length > 0) {
      const b = body.data[0];
      assert(typeof b.id === 'string', 'badge.id');
      assert(typeof b.name === 'string', 'badge.name');
    }
  });
}

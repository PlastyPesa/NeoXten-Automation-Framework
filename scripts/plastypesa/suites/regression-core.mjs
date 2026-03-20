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
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('home_leaderboard_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/home/leaderboard?type=weekly'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`home/leaderboard ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(Array.isArray(d.leaderboard), 'leaderboard array');
    assert(d.overallStats && typeof d.overallStats === 'object', 'overallStats');
    assert(typeof d.type === 'string', 'type string');
  });

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

  await runner.test('winners_wall_double_fetch_stable', async () => {
    const u = url(cfg, '/weekly-rewards/winners-wall');
    const [a, b] = await Promise.all([
      fetch(u, { method: 'GET', headers: cfg.authHeaders }),
      fetch(u, { method: 'GET', headers: cfg.authHeaders }),
    ]);
    const ja = await readJson(a);
    const jb = await readJson(b);
    if (a.status !== 200 || b.status !== 200) {
      throw new Error(`winners-wall double ${a.status} / ${b.status}`);
    }
    assert(
      JSON.stringify(ja.body?.data) === JSON.stringify(jb.body?.data),
      'two consecutive winners-wall payloads should match',
    );
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
    assert(d?.pagination && typeof d.pagination === 'object', 'pagination');
    assert(typeof d.pagination.page === 'number', 'pagination.page');
    assert(typeof d.pagination.limit === 'number', 'pagination.limit');
    assert(typeof d.pagination.totalPages === 'number', 'pagination.totalPages');
    assert(Array.isArray(d.history), 'history array');
    if (d.history.length > 0) {
      const h = d.history[0];
      assert(typeof h.title === 'string', 'history.title');
      assert(typeof h.date === 'string', 'history.date');
      assert(typeof h.points === 'number', 'history.points');
      assert(typeof h.source === 'string', 'history.source');
    }
  });

  await runner.test('reward_history_lifetime_shape', async () => {
    const r = await fetch(
      url(cfg, '/transaction/reward-history?type=lifetime&page=1&limit=10'),
      { method: 'GET', headers: cfg.authHeaders },
    );
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`reward-history lifetime ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d?.period === 'lifetime', 'period lifetime');
    assert(typeof d.summary.totalEntries === 'number', 'totalEntries');
    assert(typeof d.summary.totalPoints === 'number', 'totalPoints');
    assert(Array.isArray(d.history), 'history array');
  });

  await runner.test('reward_history_weekly_lifetime_consistency', async () => {
    const [w, l] = await Promise.all([
      fetch(url(cfg, '/transaction/reward-history?type=weekly&page=1&limit=100'), {
        method: 'GET',
        headers: cfg.authHeaders,
      }),
      fetch(url(cfg, '/transaction/reward-history?type=lifetime&page=1&limit=500'), {
        method: 'GET',
        headers: cfg.authHeaders,
      }),
    ]);
    const jw = await readJson(w);
    const jl = await readJson(l);
    if (w.status !== 200 || l.status !== 200) {
      throw new Error(
        `consistency fetch failed weekly=${w.status} lifetime=${l.status}`,
      );
    }
    const sw = jw.body?.data?.summary?.totalPoints ?? 0;
    const sl = jl.body?.data?.summary?.totalPoints ?? 0;
    assert(typeof sw === 'number' && typeof sl === 'number', 'summaries numeric');
    assert(sw <= sl + 0.001, 'weekly totalPoints should not exceed lifetime totalPoints');
  });

  await runner.test('reward_history_weekly_page_points_sum_bounded', async () => {
    const r = await fetch(
      url(cfg, '/transaction/reward-history?type=weekly&page=1&limit=50'),
      { method: 'GET', headers: cfg.authHeaders },
    );
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`reward-history weekly bounded ${r.status}: ${text.slice(0, 400)}`);
    }
    const d = body?.data;
    const total = d?.summary?.totalPoints ?? 0;
    const sum = (d?.history || []).reduce((s, h) => s + (h.points || 0), 0);
    assert(sum <= total + 0.01, 'sum of page history points should not exceed summary totalPoints');
  });

  await runner.test('transaction_list_first_page_shape', async () => {
    const r = await fetch(url(cfg, '/transaction/all'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({
        page: 1,
        limit: 10,
        transactionType: 'all',
      }),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`transaction/all ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(Array.isArray(body?.data), 'data is array');
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

  await runner.test('check_badges_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/home/check-badges'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({}),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`check-badges ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(Array.isArray(d.badges), 'badges array');
    assert(Array.isArray(d.newlyEarned), 'newlyEarned array');
    assert(Array.isArray(d.definitions), 'definitions array');
    if (d.definitions.length > 0) {
      const def = d.definitions[0];
      assert(typeof def.id === 'string', 'def.id');
      assert(typeof def.earned === 'boolean', 'def.earned');
    }
  });
}

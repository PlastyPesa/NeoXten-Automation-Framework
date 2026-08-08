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

  await runner.test('home_active_in_app_banner_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/home/active-in-app-banner'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const text = await r.text();
    if (r.status === 404) {
      console.warn(
        '[regression-core] home/active-in-app-banner 404 — deploy Phase 5 pinned-banner backend, then re-run suite',
      );
      return;
    }
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `home/active-in-app-banner ${r.status}: expected JSON, got ${text.slice(0, 400)}`,
      );
    }
    if (r.status !== 200) {
      throw new Error(`home/active-in-app-banner ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    const b = d.banner;
    if (b === null) {
      return;
    }
    assert(typeof b === 'object', 'banner object or null');
    assert(typeof b.title === 'string', 'banner.title');
    assert(typeof b.message === 'string', 'banner.message');
    assert(typeof b.bannerId === 'string' && b.bannerId.length > 0, 'banner.bannerId');
    assert(b.source === 'pinned', 'banner.source pinned');
    const ib = b.inAppBanner;
    assert(ib && typeof ib === 'object', 'banner.inAppBanner');
    assert(typeof ib.bannerDurationSec === 'number', 'inAppBanner.bannerDurationSec');
    assert(
      ib.bannerScope === 'main_shell' || ib.bannerScope === 'app_wide',
      'inAppBanner.bannerScope',
    );
    assert(
      ib.bannerPosition === 'top' || ib.bannerPosition === 'center' || ib.bannerPosition === 'bottom',
      'inAppBanner.bannerPosition',
    );
    assert(ib.bannerStyle === 'standard' || ib.bannerStyle === 'premium', 'inAppBanner.bannerStyle');
  });

  await runner.test('home_eco_streak_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/home/eco-streak'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`home/eco-streak ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(typeof d.currentStreak === 'number', 'currentStreak number');
    assert(typeof d.maxDays === 'number', 'maxDays number');
    assert(typeof d.bonusPoints === 'number', 'bonusPoints number');
    assert(typeof d.bonusEarned === 'boolean', 'bonusEarned boolean');
    if (d.bonusPending !== undefined) {
      assert(typeof d.bonusPending === 'boolean', 'bonusPending boolean when present');
    }
    assert(typeof d.todayActive === 'boolean', 'todayActive boolean');
    assert(Array.isArray(d.daysCompleted), 'daysCompleted array');
    assert(d.daysCompleted.length === 7, 'daysCompleted length 7');
    for (const x of d.daysCompleted) {
      assert(typeof x === 'boolean', 'each dayCompleted boolean');
    }
    assert(typeof d.weekStart === 'string', 'weekStart string');
  });

  await runner.test('home_eco_streak_claim_returns_auto_message', async () => {
    const r = await fetch(url(cfg, '/home/eco-streak/claim'), {
      method: 'POST',
      headers: { ...cfg.authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { body, text } = await readJson(r);
    if (r.status === 400 && body?.code === 'ECO_STREAK_AUTO') {
      assert(typeof body?.message === 'string', 'message string');
      return;
    }
    if (r.status === 400 && body?.type === 'error' && typeof body?.message === 'string') {
      console.warn(
        '[regression-core] eco-streak/claim pre-auto-deploy response; deploy backend for 400 ECO_STREAK_AUTO only',
      );
      return;
    }
    if (r.status === 200 && body?.type === 'success') {
      console.warn(
        '[regression-core] eco-streak/claim returned legacy success; deploy backend so claim returns 400 ECO_STREAK_AUTO',
      );
      return;
    }
    throw new Error(`eco-streak/claim unexpected ${r.status}: ${text.slice(0, 400)}`);
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
    const rows = d?.history || [];

    // Since every sort goes to human review (2026-08-06), the history also lists
    // submissions that have NOT been awarded yet, at their full potential value.
    // Those rows are deliberately excluded from summary.totalPoints, so a naive
    // sum will exceed the total for any member with something in the queue.
    // What must hold is narrower: the AWARDED rows never exceed the total, and
    // anything above the total is visibly marked as pending.
    const isPending = (h) => /pending review|pending|awaiting/i.test(String(h?.title || ''));
    const awarded = rows.filter((h) => !isPending(h));
    const awardedSum = awarded.reduce((s, h) => s + (h.points || 0), 0);
    assert(
      awardedSum <= total + 0.01,
      `awarded history points (${awardedSum}) should not exceed summary totalPoints (${total})`,
    );

    const pending = rows.filter(isPending);
    const pendingSum = pending.reduce((s, h) => s + (h.points || 0), 0);
    const fullSum = awardedSum + pendingSum;
    if (fullSum > total + 0.01) {
      assert(
        pending.length > 0,
        `history sums to ${fullSum} against a ${total} total with no row marked pending — a member adding up this screen would think points went missing`,
      );
    }
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

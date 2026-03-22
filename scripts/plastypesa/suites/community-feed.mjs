import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'community-feed';

export async function run(cfg, runner) {
  await runner.test('community_feed_requires_auth', async () => {
    const r = await fetch(url(cfg, '/community/feed'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('community_stats_requires_auth', async () => {
    const r = await fetch(url(cfg, '/community/stats'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('community_my_handle_requires_auth', async () => {
    const r = await fetch(url(cfg, '/community/my-handle'), {
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
      'community_authenticated_bundle',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('community_feed_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/community/feed?page=1&limit=10'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`community/feed ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(Array.isArray(d.feed), 'feed is array');
    assert(typeof d.page === 'number', 'page is number');
    assert(typeof d.limit === 'number', 'limit is number');

    for (const item of d.feed) {
      assert(typeof item.ecoHandle === 'string', 'feed item has ecoHandle');
      assert(typeof item.verb === 'string', 'feed item has verb');
      assert(typeof item.icon === 'string', 'feed item has icon');
      assert(typeof item.points === 'number', 'feed item has points');
      assert(typeof item.type === 'string', 'feed item has type');
      assert(item.createdAt != null, 'feed item has createdAt');
    }
  });

  await runner.test('community_stats_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/community/stats'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`community/stats ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(typeof d.totalUsers === 'number', 'totalUsers');
    assert(typeof d.totalPlasticKg === 'number', 'totalPlasticKg');
    assert(typeof d.totalPledges === 'number', 'totalPledges');
    assert(typeof d.totalSortProofs === 'number', 'totalSortProofs');
    assert(typeof d.totalPoints === 'number', 'totalPoints');
    assert(typeof d.treesEquivalent === 'number', 'treesEquivalent');
    assert(typeof d.waterLitresSaved === 'number', 'waterLitresSaved');
    assert(typeof d.co2KgAvoided === 'number', 'co2KgAvoided');
  });

  await runner.test('community_my_handle_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/community/my-handle'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`community/my-handle ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(typeof body?.data?.ecoHandle === 'string', 'ecoHandle is string');
    assert(body.data.ecoHandle.length >= 8, 'ecoHandle min length 8');
  });

  await runner.test('community_feed_pagination_works', async () => {
    const r1 = await fetch(url(cfg, '/community/feed?page=1&limit=5'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body: b1 } = await readJson(r1);
    assert(r1.status === 200, 'page 1 status 200');
    assert(b1?.data?.page === 1, 'page 1 echoed');
    assert(b1?.data?.limit === 5, 'limit 5 echoed');
  });

  await runner.test('community_stats_double_fetch_stable', async () => {
    const u = url(cfg, '/community/stats');
    const [a, b] = await Promise.all([
      fetch(u, { method: 'GET', headers: cfg.authHeaders }),
      fetch(u, { method: 'GET', headers: cfg.authHeaders }),
    ]);
    const ja = await readJson(a);
    const jb = await readJson(b);
    if (a.status !== 200 || b.status !== 200) {
      throw new Error(`community/stats double ${a.status} / ${b.status}`);
    }
    assert(
      JSON.stringify(ja.body?.data) === JSON.stringify(jb.body?.data),
      'two consecutive stats payloads should match',
    );
  });
}

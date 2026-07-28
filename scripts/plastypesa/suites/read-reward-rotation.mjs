import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'read-reward-rotation';

/** BUILD 50 — daily read rotation: max 5 payable articles per UTC day. */
export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'read_reward_authenticated_bundle',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('read_reward_status_caps_at_five', async () => {
    const r = await fetch(url(cfg, '/home/read-reward/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`read-reward/status ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(Number(d.maxPerDay) === 5, `maxPerDay must be 5, got ${d.maxPerDay}`);
    assert(Array.isArray(d.dailyArticles), 'dailyArticles array');
    assert(
      d.dailyArticles.length <= 5,
      `dailyArticles length ${d.dailyArticles.length} exceeds maxPerDay 5`,
    );
    assert(
      (d.todayEarned ?? 0) <= 5,
      `todayEarned ${d.todayEarned} exceeds maxPerDay 5`,
    );
    assert(
      (d.todayRemaining ?? 0) <= 5,
      `todayRemaining ${d.todayRemaining} exceeds maxPerDay 5`,
    );
    for (const row of d.dailyArticles) {
      assert(row.inRotation === true, 'each dailyArticles row must be inRotation');
    }
  });

  // MANDATORY 2026-07-28 — short one-screen articles brick scroll-to-end (0% forever).
  await runner.test('read_reward_no_short_paying_articles', async () => {
    const r = await fetch(url(cfg, '/home/read-reward/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`read-reward/status ${r.status}: ${text.slice(0, 400)}`);
    }
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    const minWords = Number(d.minWords);
    assert(
      minWords >= 250,
      `minWords must be >= 250 (no short paying articles), got ${d.minWords}`,
    );
    assert(Array.isArray(d.dailyArticles), 'dailyArticles array');
    for (const row of d.dailyArticles) {
      const words = Number(row.words) || 0;
      assert(
        words >= minWords,
        `rotation article "${row.title || row.articleId}" has ${words} words < minWords ${minWords}`,
      );
      assert(
        words >= 250,
        `rotation article "${row.title || row.articleId}" has ${words} words — floor is 250`,
      );
    }
  });

  await runner.test('read_reward_next_respects_rotation', async () => {
    const statusRes = await fetch(url(cfg, '/home/read-reward/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body: statusBody } = await readJson(statusRes);
    const status = statusBody?.data;
    if (!status || (status.todayRemaining ?? 0) <= 0) {
      return;
    }

    const nextRes = await fetch(url(cfg, '/home/read-reward/next'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body: nextBody, text } = await readJson(nextRes);
    if (nextRes.status !== 200) {
      throw new Error(`read-reward/next ${nextRes.status}: ${text.slice(0, 400)}`);
    }
    const article = nextBody?.data?.article;
    if (!article) return;

    const nextId = String(article.articleId || article._id || '');
    assert(nextId.length > 0, 'next article id present');
    const rotationIds = (status.rotationArticleIds || status.dailyArticles || []).map((x) =>
      typeof x === 'string' ? x : String(x?.articleId || ''),
    );
    assert(
      rotationIds.includes(nextId),
      `next article ${nextId} must be in today rotation`,
    );
  });
}

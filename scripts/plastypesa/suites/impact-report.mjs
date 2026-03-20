import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'impact-report';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'impact_report_authenticated',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('impact_report_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/home/impact-report'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(
        `Expected 200, got ${r.status}. Body: ${text.slice(0, 400)}`,
      );
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    const ui = d.userImpact;
    assert(ui && typeof ui === 'object', 'userImpact object');
    for (const k of [
      'pledgeCount',
      'scanCount',
      'sortProofCount',
      'quizzesCompleted',
      'articlesRead',
      'tipsViewed',
      'academyCompleted',
      'plasticIQ',
      'estimatedCO2OffsetKg',
      'plasticCollectedKg',
      'estimatedPlasticAvoidedKg',
      'treesSaved',
      'waterSavedL',
      'energySavedKwh',
      'firstName',
      'lastName',
      'createdAt',
    ]) {
      assert(k in ui, `userImpact.${k} present`);
    }
    // API contract: shareText lives on data root (same as mobile), not inside userImpact
    assert(typeof d.shareText === 'string', 'data.shareText string');
    assert(d.shareText.includes('PlastyPesa'), 'shareText mentions PlastyPesa');
    assert(typeof ui.plasticIQ === 'number' && ui.plasticIQ >= 0 && ui.plasticIQ <= 100, 'plasticIQ 0..100');
    for (const n of ['pledgeCount', 'scanCount', 'sortProofCount', 'quizzesCompleted']) {
      assert(typeof ui[n] === 'number' && ui[n] >= 0, `${n} non-negative number`);
    }
    const cc = d.communityContext;
    assert(cc && typeof cc === 'object', 'communityContext object');
    assert(typeof cc.totalPledges === 'number', 'communityContext.totalPledges number');
    assert(typeof cc.totalUsers === 'number', 'communityContext.totalUsers number');
    assert(typeof cc.estimatedPlasticAvoidedKg === 'number', 'community estimatedPlasticAvoidedKg');
    assert(typeof cc.estimatedCO2SavedKg === 'number', 'community estimatedCO2SavedKg');
    const conf = d.config;
    assert(conf && typeof conf === 'object', 'config object');
    assert(typeof conf.logoUrl === 'string', 'config.logoUrl string');
    assert(typeof conf.footerText === 'string', 'config.footerText string');
    assert(typeof conf.certifiedByPlastyPesa === 'boolean', 'config.certifiedByPlastyPesa boolean');
  });

  await runner.test('impact_report_double_fetch_stable', async () => {
    const u = url(cfg, '/home/impact-report');
    const [a, b] = await Promise.all([
      fetch(u, { method: 'GET', headers: cfg.authHeaders }),
      fetch(u, { method: 'GET', headers: cfg.authHeaders }),
    ]);
    const ja = await readJson(a);
    const jb = await readJson(b);
    if (a.status !== 200 || b.status !== 200) {
      throw new Error(`impact-report double ${a.status} / ${b.status}`);
    }
    assert(
      JSON.stringify(ja.body?.data) === JSON.stringify(jb.body?.data),
      'two consecutive impact-report payloads should match',
    );
  });
}

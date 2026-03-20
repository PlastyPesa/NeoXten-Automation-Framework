import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'impact-report';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'impact_report_authenticated',
      'Set PLASTYPESA_USER_JWT (Bearer token for a real user)',
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
      'plasticIQ',
      'shareText',
    ]) {
      assert(k in ui, `userImpact.${k} present`);
    }
    assert(typeof ui.shareText === 'string', 'shareText string');
    const cc = d.communityContext;
    assert(cc && typeof cc === 'object', 'communityContext object');
    assert('totalPledges' in cc, 'communityContext.totalPledges');
    assert('config' in d && typeof d.config === 'object', 'config object');
  });
}

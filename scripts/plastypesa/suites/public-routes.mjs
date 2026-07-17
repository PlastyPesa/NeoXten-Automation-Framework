import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'public-routes';

export async function run(cfg, runner) {
  await runner.test('public_home_winners_returns_success_shape', async () => {
    const r = await fetch(url(cfg, '/home/winners'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    const { body } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`Expected 200, got ${r.status}: ${JSON.stringify(body)}`);
    }
    assert(body?.type === 'success', `type success, got ${body?.type}`);
    assert(Array.isArray(body?.data), 'data must be array');
  });

  // Dispute-ready weekly tie-break rules (never chance). App + landing hydrate from this.
  await runner.test('public_home_ranking_rules_published_tiebreak', async () => {
    const r = await fetch(url(cfg, '/home/ranking-rules'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    const { body } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`Expected 200, got ${r.status}: ${JSON.stringify(body)}`);
    }
    assert(body?.type === 'success', `type success, got ${body?.type}`);
    const data = body?.data;
    assert(data && typeof data === 'object', 'data must be object');
    assert(
      typeof data.version === 'string' && data.version.startsWith('v2-'),
      `version frozen, got ${data.version}`,
    );
    assert(Array.isArray(data.tieBreaks) && data.tieBreaks.length === 4, 'four tie-break steps');
    assert(
      data.tieBreaks[3]?.key === 'lifetime_contribution',
      'final published key is lifetime contribution (not signup date)',
    );
    assert(Array.isArray(data.neverUsed), 'neverUsed list');
    assert(
      data.neverUsed.includes('chance') && data.neverUsed.includes('lottery'),
      'never chance/lottery',
    );
    assert(
      data.neverUsed.includes('quiz_speed') && data.neverUsed.includes('app_open_count'),
      'rejects gameable speed/opens',
    );
    assert(
      data.neverUsed.includes('account_signup_date'),
      'signup date must never break ties',
    );
    assert(
      Number(data.nearMissLifetimePoints) === 50,
      `nearMissLifetimePoints=50, got ${data.nearMissLifetimePoints}`,
    );
    assert(
      typeof data.nearMissNote === 'string' && data.nearMissNote.length > 20,
      'nearMissNote present',
    );
  });
}

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

  await runner.test('public_weekly_challenge_master_returns_200', async () => {
    const r = await fetch(url(cfg, '/home/weekly-challenge'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    const { body } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`Expected 200, got ${r.status}`);
    }
    assert(body?.type === 'success', 'type success');
  });
}

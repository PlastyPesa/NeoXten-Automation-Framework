import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'weekly-challenge';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'weekly_challenge_flow',
      'Set PLASTYPESA_USER_JWT',
    );
    return;
  }

  await runner.test('weekly_challenge_status_shape', async () => {
    const r = await fetch(url(cfg, '/home/weekly-challenge/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`status ${r.status}: ${text.slice(0, 300)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(typeof d.completed === 'boolean', 'completed boolean');
    assert(typeof d.weekStart === 'string' && d.weekStart.length >= 8, 'weekStart string');
  });

  await runner.test('weekly_challenge_complete_idempotent_behavior', async () => {
    const st = await fetch(url(cfg, '/home/weekly-challenge/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const stBody = await readJson(st);
    assert(stBody.body?.type === 'success', 'status pre-check');
    const already = !!stBody.body?.data?.completed;

    const r = await fetch(url(cfg, '/home/weekly-challenge/complete'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({}),
    });
    const { body, text } = await readJson(r);

    if (already) {
      if (r.status !== 409) {
        throw new Error(
          `Already completed: expected 409, got ${r.status}: ${text.slice(0, 300)}`,
        );
      }
      assert(body?.type === 'error', '409 body type error');
      return;
    }

    if (r.status === 404) {
      assert(
        body?.message?.includes('No weekly challenge') ||
          String(body?.message || '').length > 0,
        '404 explains missing master',
      );
      return;
    }

    if (r.status !== 200) {
      throw new Error(`complete ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'success');
    assert(body?.data?.completed === true, 'data.completed');
    assert(typeof body?.data?.pointsAwarded === 'number', 'pointsAwarded number');

    const st2 = await fetch(url(cfg, '/home/weekly-challenge/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const j2 = await readJson(st2);
    if (st2.status !== 200 || !j2.body?.data?.completed) {
      throw new Error('status should show completed after successful complete');
    }
  });
}

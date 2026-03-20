import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'weekly-challenge';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'weekly_challenge_flow',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
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

    const r2 = await fetch(url(cfg, '/home/weekly-challenge/complete'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({}),
    });
    const j3 = await readJson(r2);
    if (r2.status !== 409) {
      throw new Error(
        `Second complete after success: expected 409, got ${r2.status}: ${j3.text?.slice?.(0, 300)}`,
      );
    }
    assert(j3.body?.type === 'error', 'second complete body type error');
  });

  await runner.test('weekly_challenge_complete_idempotent_double_409_when_done', async () => {
    const st = await fetch(url(cfg, '/home/weekly-challenge/status'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const stBody = await readJson(st);
    assert(stBody.body?.type === 'success', 'status');
    if (!stBody.body?.data?.completed) {
      return;
    }
    const a = await fetch(url(cfg, '/home/weekly-challenge/complete'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({}),
    });
    const b = await fetch(url(cfg, '/home/weekly-challenge/complete'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({}),
    });
    const ja = await readJson(a);
    const jb = await readJson(b);
    if (a.status !== 409) {
      throw new Error(`expected 409 first repeat, got ${a.status}: ${ja.text?.slice?.(0, 200)}`);
    }
    if (b.status !== 409) {
      throw new Error(`expected 409 second repeat, got ${b.status}: ${jb.text?.slice?.(0, 200)}`);
    }
  });
}

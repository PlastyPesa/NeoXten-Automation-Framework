import { url } from '../config.mjs';
import { readJson } from '../assert.mjs';

export const id = 'auth-baseline';

export async function run(cfg, runner) {
  await runner.test('feature_presigned_url_requires_auth', async () => {
    const r = await fetch(url(cfg, '/feature/generate-presigned-url'), {
      method: 'POST',
      headers: cfg.headersJson,
      body: JSON.stringify({}),
    });
    const { text } = await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(
        `Expected 401/403, got ${r.status}. Body: ${text.slice(0, 200)}`,
      );
    }
  });

  await runner.test('feature_reward_calc_requires_auth', async () => {
    const r = await fetch(url(cfg, '/feature/calculate-reward-points'), {
      method: 'POST',
      headers: cfg.headersJson,
      body: JSON.stringify({}),
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('auth_login_endpoint_exists', async () => {
    const r = await fetch(url(cfg, '/auth/login'), {
      method: 'POST',
      headers: cfg.headersJson,
      body: JSON.stringify({ email: 'test@test.com', otp: '000000' }),
    });
    if (r.status === 404) throw new Error('Auth login returned 404');
  });

  await runner.test('user_profile_requires_auth', async () => {
    const r = await fetch(url(cfg, '/user/my-profile'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    if (r.status === 200) throw new Error('SECURITY: my-profile 200 without auth');
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('impact_report_requires_auth', async () => {
    const r = await fetch(url(cfg, '/home/impact-report'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    const { text } = await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(
        `Expected 401/403, got ${r.status}. Body: ${text.slice(0, 200)}`,
      );
    }
  });

  await runner.test('weekly_challenge_complete_requires_auth', async () => {
    const r = await fetch(url(cfg, '/home/weekly-challenge/complete'), {
      method: 'POST',
      headers: cfg.headersJson,
      body: JSON.stringify({}),
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('weekly_challenge_status_requires_auth', async () => {
    const r = await fetch(url(cfg, '/home/weekly-challenge/status'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('sort_proof_config_requires_auth', async () => {
    const r = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('sort_proof_submit_requires_auth', async () => {
    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.headersJson,
      body: JSON.stringify({
        image: 'abc',
        streamA: 'PET',
        streamB: 'HDPE',
      }),
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('winners_wall_requires_auth', async () => {
    const r = await fetch(url(cfg, '/weekly-rewards/winners-wall'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('reward_history_requires_auth', async () => {
    const r = await fetch(url(cfg, '/transaction/reward-history'), {
      method: 'GET',
      headers: cfg.headersJson,
    });
    await readJson(r);
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401/403, got ${r.status}`);
    }
  });

  await runner.test('admin_login_endpoint_exists', async () => {
    const r = await fetch(url(cfg, '/auth/admin-login'), {
      method: 'POST',
      headers: cfg.headersJson,
      body: JSON.stringify({ email: 'fake@fake.com', password: 'wrong' }),
    });
    if (r.status === 404) throw new Error('admin-login 404');
  });

  await runner.test('negative_invalid_bearer_token_rejected', async () => {
    const r = await fetch(url(cfg, '/user/my-profile'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer not.a.valid.jwt.token',
      },
    });
    const { text } = await readJson(r);
    if (r.status !== 401) {
      throw new Error(
        `Invalid JWT: expected 401, got ${r.status}. Body: ${text.slice(0, 200)}`,
      );
    }
  });
}

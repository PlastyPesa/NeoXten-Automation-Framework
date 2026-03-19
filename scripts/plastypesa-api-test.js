/**
 * PlastyPesa Backend API Test Suite
 * Tests critical API endpoints for auth enforcement and availability.
 * Run: node scripts/plastypesa-api-test.js
 *
 * Uses Node.js native fetch (Node 20+) to avoid browser CORS restrictions.
 */

const API_BASE = 'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message });
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}

async function run() {
  console.log('\n=== PlastyPesa API Tests ===\n');

  // Feature routes MUST return 403 from jwt.validateJwt when no auth header is sent.
  // Pre-fix: these routes are unprotected and reach the handler (500/502 on invalid input, or 200 on valid).
  // Post-fix: these routes return 403 before reaching the handler.
  await test('feature_presigned_url_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/feature/generate-presigned-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await r.text();
    if (r.status !== 403) {
      throw new Error(`Expected 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  await test('feature_reward_calc_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/feature/calculate-reward-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await r.text();
    if (r.status !== 403) {
      throw new Error(`Expected 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  // Auth endpoints should respond to requests (not 404, not crash).
  // They may return 4xx on invalid credentials — that is correct behavior.
  await test('auth_login_endpoint_exists', async () => {
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', otp: '000000' }),
    });
    if (r.status === 404) throw new Error('Auth login endpoint returned 404 — not found');
  });

  // User profile MUST return 403 without auth (validates jwt middleware works).
  await test('user_profile_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/user/my-profile`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (r.status === 200) throw new Error('SECURITY: my-profile returned 200 without auth');
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401 or 403, got ${r.status}`);
    }
  });

  // Impact Report MUST return 403 without auth (Impact Report MVP).
  await test('impact_report_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/home/impact-report`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await r.text();
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401 or 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  // Weekly Challenge complete MUST return 403 without auth (Weekly Challenge MVP).
  await test('weekly_challenge_complete_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/home/weekly-challenge/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await r.text();
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401 or 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  // Weekly Challenge status MUST return 403 without auth.
  await test('weekly_challenge_status_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/home/weekly-challenge/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await r.text();
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401 or 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  // Home sorting proof (SORT_PROOF MVP)
  await test('sort_proof_config_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/home/sort-proof/config`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await r.text();
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401 or 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  await test('sort_proof_submit_requires_auth', async () => {
    const r = await fetch(`${API_BASE}/home/sort-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'abc', streamA: 'PET', streamB: 'HDPE' }),
    });
    const body = await r.text();
    if (r.status !== 403 && r.status !== 401) {
      throw new Error(`Expected 401 or 403 (auth required), got ${r.status}. Body: ${body.substring(0, 200)}`);
    }
  });

  // Admin login should respond (not 404). 500 is expected for invalid credentials
  // due to pre-existing bug: catch block hardcodes status(500) instead of using error.status.
  await test('admin_login_endpoint_exists', async () => {
    const r = await fetch(`${API_BASE}/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'fake@fake.com', password: 'wrong' }),
    });
    if (r.status === 404) throw new Error('Admin login endpoint returned 404 — not found');
  });

  console.log('\n=== Results ===\n');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  if (failed > 0) {
    console.log('FAILED tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

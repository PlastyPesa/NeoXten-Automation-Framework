/**
 * P-FORCE-UPDATE-MIN-VERSION / P-UPGRADE-REQUIRED-API-UI (2026-07-26).
 *
 * The release gate is the one switch in the system whose failure modes are
 * asymmetric: if it silently stops working the owner loses the ability to pull
 * a bad build, and if it is silently left ON with a floor nobody remembers
 * raising, every user is locked out of earning. This suite watches both edges.
 *
 * Asserted here:
 *   1. `/api/app-release-gate` is reachable WITHOUT auth and publishes the
 *      floor. A blocked build has no way to explain itself otherwise.
 *   2. The gate is currently OFF (or has a floor of 0). This is the guard
 *      against leaving production gated after a test or an incident — if the
 *      owner deliberately raises the floor, this test is expected to fail and
 *      must be acknowledged, not muted.
 *   3. Exempt routes stay reachable while carrying an ancient version header:
 *      auth (so a blocked user can still sign in and see the update screen)
 *      and legal content (users keep the right to read the documents).
 *   4. A request carrying a version header is served normally while the gate
 *      is off — i.e. shipping the headers cannot itself break the app.
 *
 * Note on the 426 path itself: proving it requires flipping production config,
 * so it is proven out-of-band by the backend unit suite (16 tests over the
 * decision + exemption logic) plus a one-off live enable/restore run recorded
 * in the P-FORCE-UPDATE-UI commit. This suite deliberately does not mutate
 * production.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'force-update-gate';

const OLD_BUILD_HEADERS = {
  'X-App-Version-Code': '1',
  'X-App-Platform': 'android',
  'User-Agent': 'Dart/3.5 (dart:io)',
};

export async function run(cfg, runner) {
  let gate = null;

  await runner.test('release_gate_is_public_and_readable', async () => {
    // Deliberately no auth headers: a build that is being refused everywhere
    // else still has to be able to read why.
    const r = await fetch(url(cfg, '/app-release-gate'));
    const { body, text } = await readJson(r);
    assert(r.status === 200, `app-release-gate ${r.status}: ${text.slice(0, 200)}`);
    gate = body?.data ?? null;
    assert(gate !== null, 'app-release-gate must return a data envelope');
    assert(typeof gate.enabled === 'boolean', 'enabled must be a boolean');
    assert(Number.isFinite(gate.android?.minVersionCode),
      'android.minVersionCode must be a number the client can compare against');
  });

  await runner.test('update_link_points_at_a_real_play_listing', async () => {
    // Caught in production 2026-07-27: the default was `com.plastypesa.app`,
    // which reads like the right id and 404s on Play. The blocked user has no
    // other route out of the app, so this link failing is a dead end. Assert
    // the actual applicationId, not merely that it mentions Google Play.
    if (gate === null) throw new Error('gate not read');
    const link = gate.storeUrl?.android ?? '';
    assert(link.includes('id=com.app.plasty_pesa'),
      `update link must target the real Play applicationId, got: ${link}`);
  });

  await runner.test('production_is_not_left_gated', async () => {
    if (gate === null) throw new Error('gate not read');
    const floor = gate.android?.minVersionCode ?? 0;
    const blocking = gate.enabled === true && floor > 0;
    assert(!blocking,
      `release gate is ACTIVE with an Android floor of ${floor}. If this was intentional ` +
      '(pulling a bad build) acknowledge it; if not, production is refusing app traffic.');
  });

  await runner.test('auth_and_legal_stay_reachable_for_an_old_build', async () => {
    // These two exemptions are what stop the gate from being a brick wall: a
    // blocked user must still be able to log in to see the update screen, and
    // must still be able to read the legal documents.
    for (const path of ['/auth/login', '/master/legal-pages?type=privacy']) {
      const r = await fetch(url(cfg, path), { headers: OLD_BUILD_HEADERS });
      assert(r.status !== 426,
        `${path} answered 426 — this route is exempt and must never be gated`);
    }
  });

  await runner.test('shipping_version_headers_does_not_break_normal_calls', async () => {
    if (!cfg.authHeaders) {
      // Unauthenticated variant still proves the headers are accepted and not
      // rejected by CORS/API Gateway.
      const r = await fetch(url(cfg, '/health'), { headers: OLD_BUILD_HEADERS });
      assert(r.status === 200, `health with version headers ${r.status}`);
      return;
    }
    const r = await fetch(url(cfg, '/home/leaderboard?type=weekly&page=1&limit=1'), {
      headers: { ...cfg.authHeaders, ...OLD_BUILD_HEADERS },
    });
    assert(r.status !== 426,
      'gate is off, so a versioned request must be served — got 426');
    assert(r.status === 200, `leaderboard with version headers ${r.status}`);
  });
}

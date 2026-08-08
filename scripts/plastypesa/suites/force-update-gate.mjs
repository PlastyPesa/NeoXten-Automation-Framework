/**
 * P-FORCE-UPDATE-MIN-VERSION — FORCE LATEST FOREVER (owner lock 2026-07-27).
 *
 * The policy inverted on 2026-07-27: ARMED is the steady state, forever.
 * Every user must be on the live Play production build or the app is dead —
 * min = live Play versionCode, blockUnreported:true, no grace. The old
 * `production_is_not_left_gated` backstop asserted the opposite world and is
 * retired; this suite now FAILS if production is ever found disarmed, drifted
 * below live Play, missing blockUnreported, or pointing at a wrong Play id.
 *
 * Asserted here:
 *   1. `/api/app-release-gate` is reachable WITHOUT auth and publishes the
 *      floor. A blocked build has no way to explain itself otherwise.
 *   2. The update link targets the real Play applicationId
 *      (`com.app.plasty_pesa` — `com.plastypesa.app` reads right and 404s).
 *   3. The gate is ARMED: enabled, floor > 0, blockUnreported on. Fixer:
 *      `node scripts/plastypesa/release-gate.mjs sync`.
 *   4. The floor equals the LIVE Play production versionCode (Publisher API,
 *      same service account as monitor:plastypesa). Set
 *      PLASTYPESA_SKIP_PLAY_CHECK=1 only on a machine without the SA file.
 *   5. Live 426 behavior: an old build is refused on a gated route with the
 *      correct storeUrl and a LOCALIZED message (X-Language: ro must not get
 *      English); an unreported app-like client is refused; a build at the
 *      floor passes; browsers without version headers are never gated.
 *   6. Open-wall forever (2026-08-08): `/api/auth` is gated for old builds —
 *      they must not open a session. Legal (`/api/master`) stays reachable so
 *      users can still read the documents they have a right to read.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'force-update-gate';

const OLD_BUILD_HEADERS = {
  'X-App-Version-Code': '1',
  'X-App-Platform': 'android',
  'User-Agent': 'Dart/3.5 (dart:io)',
};

const UNREPORTED_APP_HEADERS = {
  // The pre-heartbeat builds: Flutter UA, no version headers at all.
  'User-Agent': 'Dart/3.3 (dart:io)',
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
};

// Any gated app route works — the middleware answers 426 before auth runs.
const GATED_PATH = '/home/leaderboard?type=weekly&page=1&limit=1';

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

  await runner.test('production_gate_is_armed_forever', async () => {
    // FORCE LATEST FOREVER: disarmed production violates the owner lock. If
    // this fails after an incident disarm, the fix is:
    //   node scripts/plastypesa/release-gate.mjs sync
    if (gate === null) throw new Error('gate not read');
    assert(gate.enabled === true,
      'release gate is DISARMED — owner lock FORCE LATEST FOREVER requires it armed. ' +
      'Fix: node scripts/plastypesa/release-gate.mjs sync');
    const floor = gate.android?.minVersionCode ?? 0;
    assert(floor > 0,
      `android floor is ${floor} — the floor must be the live Play versionCode, never 0`);
    assert(gate.android?.blockUnreported === true,
      'blockUnreported is OFF — pre-heartbeat builds would slip the gate. ' +
      'Fix: node scripts/plastypesa/release-gate.mjs sync');
  });

  await runner.test('gate_floor_equals_live_play_production', async () => {
    if (gate === null) throw new Error('gate not read');
    if (process.env.PLASTYPESA_SKIP_PLAY_CHECK === '1') {
      // Only for machines without the Play service account. On the owner
      // machine this check must run — min ≠ live Play is the drift the owner
      // locked against.
      return;
    }
    const { readLivePlayVersion } = await import('../play-live-version.mjs');
    const live = await readLivePlayVersion();
    const floor = gate.android?.minVersionCode ?? 0;
    assert(floor === live.versionCode,
      `gate floor ${floor} ≠ live Play production ${live.versionCode} (${live.releaseName}). ` +
      'Fix: node scripts/plastypesa/release-gate.mjs sync');
  });

  await runner.test('old_build_is_refused_with_localized_426', async () => {
    // The live proof of the whole feature: a below-floor build gets 426 with
    // the correct store link, and the message respects X-Language so the
    // legacy snackbar path is not English-only (owner lock #7).
    const en = await fetch(url(cfg, GATED_PATH), { headers: OLD_BUILD_HEADERS });
    const enBody = (await readJson(en)).body;
    assert(en.status === 426,
      `old build must be refused on a gated route — got ${en.status}`);
    assert(enBody?.code === 'upgrade_required', 'body must carry code=upgrade_required');
    assert((enBody?.data?.storeUrl ?? '').includes('id=com.app.plasty_pesa'),
      `426 storeUrl must be the real listing, got: ${enBody?.data?.storeUrl}`);

    const ro = await fetch(url(cfg, GATED_PATH), {
      headers: { ...OLD_BUILD_HEADERS, 'X-Language': 'ro' },
    });
    const roBody = (await readJson(ro)).body;
    assert(ro.status === 426, `old build with X-Language:ro must still be refused — got ${ro.status}`);
    assert(typeof roBody?.message === 'string' && roBody.message.includes('Google Play'),
      '426 message must be user-facing copy');
    assert(roBody.message !== enBody.message,
      'X-Language: ro returned the English message — the 426 body is not localized');
  });

  await runner.test('unreported_app_build_is_refused', async () => {
    // blockUnreported is the lever that reaches pre-heartbeat builds. It must
    // actually block an app-like client that sends no version header.
    const r = await fetch(url(cfg, GATED_PATH), { headers: UNREPORTED_APP_HEADERS });
    const { body } = await readJson(r);
    assert(r.status === 426,
      `unreported app client must be refused (blockUnreported) — got ${r.status}`);
    assert(body?.data?.reason === 'version_not_reported',
      `expected reason version_not_reported, got ${body?.data?.reason}`);
  });

  await runner.test('build_at_the_floor_passes_the_gate', async () => {
    if (gate === null) throw new Error('gate not read');
    const floor = gate.android?.minVersionCode ?? 0;
    const headers = {
      'X-App-Version-Code': String(floor),
      'X-App-Platform': 'android',
      'User-Agent': 'Dart/3.5 (dart:io)',
      ...(cfg.authHeaders || {}),
    };
    const r = await fetch(url(cfg, GATED_PATH), { headers });
    assert(r.status !== 426,
      `a build AT the floor (${floor}) must be served — the gate would otherwise refuse the live Play build itself`);
  });

  await runner.test('browsers_are_never_gated', async () => {
    // The admin dashboard and landing site send no version header and never
    // will — blockUnreported must not reach them.
    const r = await fetch(url(cfg, '/health'), { headers: BROWSER_HEADERS });
    assert(r.status === 200, `browser-UA health ${r.status}`);
    const gated = await fetch(url(cfg, GATED_PATH), { headers: BROWSER_HEADERS });
    assert(gated.status !== 426,
      'a browser UA without version headers was gated — staff tooling would be down');
  });

  await runner.test('auth_is_gated_on_open_legal_stays_reachable', async () => {
    // OWNER LOCK 2026-08-08 open wall: old builds must not open a session.
    // Login POST with below-floor headers must be 426 before password logic.
    const login = await fetch(url(cfg, '/auth/login'), {
      method: 'POST',
      headers: {
        ...OLD_BUILD_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'gate-open-wall@example.com', password: 'x' }),
    });
    const loginBody = (await readJson(login)).body;
    assert(login.status === 426,
      `/auth/login must be gated on open for old builds — got ${login.status}`);
    assert(loginBody?.code === 'upgrade_required',
      'login 426 must carry code=upgrade_required');
    assert(typeof loginBody?.message === 'string' && loginBody.message.includes('Google Play'),
      'login 426 must carry a clear Google Play update message for pre-gate UIs');

    // Legal stays exempt — privacy/terms must remain readable.
    const legal = await fetch(url(cfg, '/master/legal-pages?type=privacy'), {
      headers: OLD_BUILD_HEADERS,
    });
    assert(legal.status !== 426,
      `/master/legal-pages answered 426 — legal must stay reachable for an old build`);
  });
}

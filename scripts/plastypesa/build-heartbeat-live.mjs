#!/usr/bin/env node
/**
 * P-BUILD-HEARTBEAT live proof.
 *
 * The mobile client now attaches appVersionCode / appVersionName / appPlatform
 * / installSource to login, 2FA-verify, register and device-token. Those fields
 * are only useful if the DEPLOYED Lambda parses and persists them — a passing
 * unit test on either side proves nothing about the running API.
 *
 * This hits production the way the app does, then reads the value back through
 * an authenticated endpoint, so a silently-undeployed backend fails loudly.
 *
 * Usage:
 *   node scripts/plastypesa/build-heartbeat-live.mjs
 *
 * Env (optional overrides):
 *   PLASTYPESA_API_BASE, PLASTYPESA_TEST_EMAIL, PLASTYPESA_TEST_PASSWORD
 */

const API_BASE =
  process.env.PLASTYPESA_API_BASE ||
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

const EMAIL = process.env.PLASTYPESA_TEST_EMAIL || 'bogdanmircea11987@gmail.com';
const PASSWORD = process.env.PLASTYPESA_TEST_PASSWORD || 'MaryJay11987.';

// Shaped exactly like AppClientMetadata.payload() in the Flutter client.
const HEARTBEAT = {
  appVersionCode: 57,
  appVersionName: '1.0.37',
  appPlatform: 'android',
  installSource: 'play_store',
};

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function post(path, body, token) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function get(path, token) {
  const res = await fetch(`${API_BASE}/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function main() {
  console.log('=== P-BUILD-HEARTBEAT live proof ===');
  console.log(`API: ${API_BASE}`);

  // 1. Login WITH the heartbeat payload. An undeployed / stricter validator
  //    would reject the unknown properties instead of marking them optional.
  const login = await post('auth/login', {
    email: EMAIL,
    password: PASSWORD,
    deviceId: 'neoxten-heartbeat-probe',
    ...HEARTBEAT,
  });

  const token =
    login.json?.data?.token ||
    login.json?.token ||
    login.json?.data?.accessToken ||
    null;

  record(
    'login accepts client build metadata',
    login.status === 200 && Boolean(token),
    `status=${login.status} message=${login.json?.message ?? 'n/a'}`,
  );

  if (!token) {
    console.error('\nNo token returned — cannot verify persistence.');
    process.exit(1);
  }

  // 2. Reject garbage: the whitelist must drop an unknown installSource rather
  //    than storing it. Login must still succeed.
  const garbage = await post('auth/login', {
    email: EMAIL,
    password: PASSWORD,
    deviceId: 'neoxten-heartbeat-probe',
    ...HEARTBEAT,
    installSource: 'definitely-not-a-real-source',
  });
  record(
    'login tolerates an invalid installSource',
    garbage.status === 200,
    `status=${garbage.status}`,
  );

  // 3. Re-send the good payload so the last persisted value is the valid one.
  await post('auth/login', {
    email: EMAIL,
    password: PASSWORD,
    deviceId: 'neoxten-heartbeat-probe',
    ...HEARTBEAT,
  });

  // 4. Read it back. The profile endpoint is what the app itself calls.
  const profile = await get('user/my-profile', token);
  const user = profile.json?.data?.user || profile.json?.data || profile.json?.user || {};
  const seenCode = user.lastAppVersionCode ?? null;
  const seenSource = user.lastInstallSource ?? null;

  if (profile.status !== 200) {
    record('profile read-back', false, `status=${profile.status}`);
  } else if (seenCode === null && seenSource === null) {
    // The profile projection may not expose these admin-only fields; that is
    // not a failure of the heartbeat itself, so say so honestly.
    record(
      'profile read-back exposes heartbeat fields',
      false,
      'lastAppVersionCode/lastInstallSource not present in /user/me projection — ' +
        'verify via admin Daily Check instead',
    );
  } else {
    record(
      'persisted build metadata matches what the client sent',
      seenCode === HEARTBEAT.appVersionCode &&
        seenSource === HEARTBEAT.installSource,
      `lastAppVersionCode=${seenCode} lastInstallSource=${seenSource}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();

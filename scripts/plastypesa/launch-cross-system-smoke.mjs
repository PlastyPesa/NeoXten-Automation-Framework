#!/usr/bin/env node
/**
 * Post-P8 launch certification: safe production cross-system API smoke.
 *
 * This script intentionally avoids destructive actions. It verifies live API
 * contracts that bridge admin, partner, legal, catalog, learning, group, GDPR,
 * and mobile profile surfaces.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import { loadAdminDashboardCredentials } from './credential-registry.mjs';

const FORBIDDEN_B2B_KEYS = ['userId', 'email', '_id', 'phone'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON: status=${response.status} body=${text.slice(0, 240)}`);
  }
  return { body, text };
}

function deepFindForbidden(node, path = '$') {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const hit = deepFindForbidden(node[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_B2B_KEYS.includes(key)) return `${path}.${key}`;
      const hit = deepFindForbidden(node[key], `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

function outputPath() {
  const dir = resolve(process.cwd(), '.neoxten-out');
  mkdirSync(dir, { recursive: true });
  return resolve(dir, `plastypesa-launch-cross-system-${Date.now()}.json`);
}

async function adminLogin(cfg) {
  const credentials = loadAdminDashboardCredentials();
  const response = await fetch(url(cfg, '/auth/admin-login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const { body, text } = await readJson(response);
  assert(response.ok, `admin login failed: ${response.status} ${text.slice(0, 200)}`);
  const token = body?.data?.token || body?.token;
  assert(token, 'admin login did not return token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function test(name, fn, results) {
  try {
    const evidence = await fn();
    results.push({ name, status: 'PASS', evidence });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err?.message || String(err) });
    console.log(`  FAIL  ${name} — ${err?.message || err}`);
  }
}

async function main() {
  bootstrapPlastyPesaEnv();
  const cfg = getConfig();
  const { authHeaders } = await resolvePlastyPesaAuth(cfg);
  assert(authHeaders, 'user auth is required for launch cross-system smoke');
  const adminHeaders = await adminLogin(cfg);
  const results = [];

  await test('legal_master_contains_launch_disclosures', async () => {
    const names = ['privacy-policy', 'terms-of-us', 'gdpr-compliance'];
    const evidence = {};
    for (const name of names) {
      const response = await fetch(url(cfg, `/master?name=${encodeURIComponent(name)}`));
      const { body } = await readJson(response);
      assert(response.ok, `${name} fetch failed`);
      const text = body?.data?.metadata?.[0] || '';
      evidence[name] = {
        length: text.length,
        hasGdpr: /GDPR|export|delete/i.test(text),
        hasB2B: /B2B|aggregate impact/i.test(text),
        hasEcoScan: /Eco Scan|Anthropic|Haiku/i.test(text),
      };
    }
    assert(evidence['privacy-policy'].hasGdpr, 'privacy missing GDPR self-service wording');
    assert(evidence['privacy-policy'].hasB2B, 'privacy missing B2B aggregate wording');
    assert(evidence['privacy-policy'].hasEcoScan, 'privacy missing Eco Scan/AI wording');
    assert(evidence['terms-of-us'].hasB2B, 'terms missing B2B aggregate wording');
    assert(evidence['gdpr-compliance'].hasGdpr, 'GDPR page missing GDPR wording');
    return evidence;
  }, results);

  await test('catalog_and_learning_links_are_live', async () => {
    const catalogResponse = await fetch(url(cfg, '/eco-catalog?lang=en'));
    const { body: catalogBody } = await readJson(catalogResponse);
    assert(catalogResponse.ok, 'eco-catalog failed');
    const materials = catalogBody?.data?.materials || [];
    const requiredLinked = ['PET', 'HDPE', 'PVC', 'LDPE', 'PP', 'PS', 'OTHER_PLASTIC', 'METAL_AL', 'GLASS_CLEAR', 'EWASTE_SMALL', 'BATTERY', 'TEXTILE'];
    const missing = requiredLinked.filter((code) => {
      const row = materials.find((item) => item.code === code);
      return !row || !row.learnModuleId;
    });
    assert(missing.length === 0, `materials missing learnModuleId: ${missing.join(', ')}`);

    const modulesResponse = await fetch(url(cfg, '/home/learning-modules?lang=en'), {
      headers: authHeaders,
    });
    const { body: modulesBody } = await readJson(modulesResponse);
    assert(modulesResponse.ok, 'learning modules failed');
    const modules = modulesBody?.data?.modules || modulesBody?.data || [];
    const gradeCount = modules.filter((item) => item.category === 'grade_education' || item.materialCode).length;
    const circularCount = modules.filter((item) => item.category === 'circular_economy').length;
    assert(gradeCount >= 8, `expected >=8 grade modules, got ${gradeCount}`);
    assert(circularCount >= 6, `expected >=6 circular modules, got ${circularCount}`);
    assert(modules.every((item) => typeof item.isSponsored === 'boolean'), 'isSponsored must be boolean');
    return { linkedMaterials: requiredLinked.length, gradeCount, circularCount };
  }, results);

  await test('b2b_token_lifecycle_and_no_pii_contract', async () => {
    const createResponse = await fetch(url(cfg, '/admin/b2b-tokens'), {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        label: `Launch cert ${Date.now()}`,
        partnerName: 'Launch certification',
        scopes: ['impact:read'],
        notes: 'Temporary launch certification token',
      }),
    });
    const { body: createBody, text: createText } = await readJson(createResponse);
    assert(createResponse.status === 201 || createResponse.status === 200, `token create failed: ${createText}`);
    const token = createBody?.data?.token;
    const id = createBody?.data?.item?.id;
    assert(token && id, 'token create did not return raw token + id');
    try {
      const impactResponse = await fetch(url(cfg, '/b2b/impact'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { body: impactBody, text: impactText } = await readJson(impactResponse);
      assert(impactResponse.ok, `B2B impact failed: ${impactText.slice(0, 200)}`);
      const data = impactBody?.data;
      assert(data?.meta?.minDistinctUsersPerBucket >= 5, 'k-anonymity meta missing');
      const leak = deepFindForbidden(data);
      assert(!leak, `B2B response leaked identifier at ${leak}`);
      return {
        tokenLast4: createBody.data.item.tokenLast4,
        minDistinctUsersPerBucket: data.meta.minDistinctUsersPerBucket,
        buckets: data.buckets?.length || 0,
      };
    } finally {
      const deactivateResponse = await fetch(url(cfg, `/admin/b2b-tokens/${id}/deactivate`), {
        method: 'POST',
        headers: adminHeaders,
      });
      assert(deactivateResponse.ok, `failed to deactivate temporary token ${id}`);
    }
  }, results);

  await test('profile_b2b_opt_out_round_trip_is_reversible', async () => {
    const profileResponse = await fetch(url(cfg, '/user/my-profile'), { headers: authHeaders });
    const { body: profileBody } = await readJson(profileResponse);
    assert(profileResponse.ok, 'profile fetch failed');
    const original = Boolean(profileBody?.data?.notificationPreferences?.b2bAggregateOptOut);
    const flipped = !original;
    const patch = async (value) => {
      const response = await fetch(url(cfg, '/user/notification-preferences'), {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ b2bAggregateOptOut: value }),
      });
      const { body, text } = await readJson(response);
      assert(response.ok, `preference patch failed: ${text.slice(0, 200)}`);
      assert(
        body?.data?.notificationPreferences?.b2bAggregateOptOut === value,
        `preference did not echo ${value}`,
      );
    };
    await patch(flipped);
    await patch(original);
    return { original, testedValue: flipped, restored: original };
  }, results);

  await test('admin_group_challenge_create_and_cancel', async () => {
    const groupsResponse = await fetch(url(cfg, '/admin/groups?limit=10'), {
      headers: adminHeaders,
    });
    const { body: groupsBody, text: groupsText } = await readJson(groupsResponse);
    assert(groupsResponse.ok, `admin groups failed: ${groupsText.slice(0, 200)}`);
    const group = (groupsBody?.data?.items || []).find((item) => item.status === 'active');
    assert(group?.id, 'no active group available for challenge smoke');
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const createResponse = await fetch(url(cfg, `/admin/groups/${group.id}/challenges`), {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: { en: `Launch certification challenge ${Date.now()}` },
        description: { en: 'Temporary certification challenge, cancelled immediately.' },
        materialCodes: ['PET'],
        actionTypeCodes: ['SORT_PROOF'],
        targetCount: 1,
        startAt,
        endAt,
      }),
    });
    const { body: createBody, text: createText } = await readJson(createResponse);
    if (createResponse.status === 409 && createBody?.code === 'ACTIVE_CHALLENGE_EXISTS') {
      return { groupId: group.id, created: false, reason: 'active challenge already exists' };
    }
    assert(createResponse.status === 201, `challenge create failed: ${createResponse.status} ${createText.slice(0, 240)}`);
    const challengeId = createBody?.data?.item?.id;
    assert(challengeId, 'challenge create did not return id');
    const cancelResponse = await fetch(
      url(cfg, `/admin/groups/${group.id}/challenges/${challengeId}/cancel`),
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'Launch certification cleanup' }),
      },
    );
    const { body: cancelBody, text: cancelText } = await readJson(cancelResponse);
    assert(cancelResponse.ok, `challenge cancel failed: ${cancelText.slice(0, 240)}`);
    assert(cancelBody?.data?.item?.status === 'cancelled', 'challenge was not cancelled');
    return { groupId: group.id, challengeId, status: cancelBody.data.item.status };
  }, results);

  await test('group_challenge_shape_and_gdpr_otp_gates', async () => {
    const challengeResponse = await fetch(url(cfg, '/groups/me/challenge'), {
      headers: authHeaders,
    });
    const { body: challengeBody } = await readJson(challengeResponse);
    assert(challengeResponse.ok, 'groups/me/challenge failed');
    assert(typeof challengeBody?.data?.inChallenge === 'boolean', 'inChallenge boolean required');

    const exportRequest = await fetch(url(cfg, '/user/me/gdpr/export-request'), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(exportRequest.ok, `GDPR export request failed: ${exportRequest.status}`);
    const bogusExport = await fetch(url(cfg, '/user/me/gdpr/export'), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: '000000' }),
    });
    assert(bogusExport.status === 400, `bogus export OTP expected 400, got ${bogusExport.status}`);
    const bogusDelete = await fetch(url(cfg, '/user/me/gdpr/delete'), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        otp: '000000',
        confirmEmail: 'not-the-real-email@example.com',
        confirmPhrase: 'DELETE_ACCOUNT_PERMANENTLY',
      }),
    });
    assert(bogusDelete.status === 400, `bogus delete OTP expected 400, got ${bogusDelete.status}`);
    return {
      challengeInChallenge: challengeBody.data.inChallenge,
      exportRequestStatus: exportRequest.status,
      bogusExportStatus: bogusExport.status,
      bogusDeleteStatus: bogusDelete.status,
    };
  }, results);

  const failed = results.filter((entry) => entry.status === 'FAIL');
  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: cfg.apiBase,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
  };
  const path = outputPath();
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[launch-cross-system] Report: ${path}`);
  console.log(`[launch-cross-system] ${report.pass} pass, ${report.fail} fail`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[launch-cross-system]', err);
  process.exit(1);
});

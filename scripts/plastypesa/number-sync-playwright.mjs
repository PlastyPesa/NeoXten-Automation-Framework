#!/usr/bin/env node
/**
 * Phase 3 — Playwright APIRequestContext sync (browser stack, no CORS).
 * Complements Node suite `number-sync`.
 *
 * Run: npm run test:plastypesa-number-sync-pw
 */
import { request } from 'playwright';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';

async function main() {
  bootstrapPlastyPesaEnv();
  const cfg = getConfig();
  const auth = await resolvePlastyPesaAuth(cfg);
  if (!auth.authHeaders?.Authorization) {
    console.error('FAIL: no JWT — set PLASTYPESA_USER_JWT or TEST_EMAIL/PASSWORD');
    process.exit(1);
  }

  const apiBase = cfg.apiBase.replace(/\/$/, '');
  const authHeader = auth.authHeaders.Authorization;
  const ctx = await request.newContext({
    extraHTTPHeaders: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'NeoXten-NumberSync-Playwright/1.0',
    },
  });

  try {
    const [ehRes, pulseRes] = await Promise.all([
      ctx.get(`${apiBase}/home/earn-hub`),
      ctx.get(`${apiBase}/community/pulse`),
    ]);
    const eh = await ehRes.json();
    const pulse = await pulseRes.json();
    const mission = Number(eh?.data?.communityProgress?.communityMembers);
    const members = Number(pulse?.data?.members);
    const milestone = Number(pulse?.data?.milestone?.currentKeMembers);

    const errors = [];
    if (ehRes.status() !== 200) errors.push(`earn-hub ${ehRes.status()}`);
    if (pulseRes.status() !== 200) errors.push(`pulse ${pulseRes.status()}`);
    if (!(Number.isInteger(mission) && Number.isInteger(members))) {
      errors.push(`non-integer mission=${mission} members=${members}`);
    }
    if (mission !== members) {
      errors.push(`mission (${mission}) != members (${members})`);
    }
    if (Number.isInteger(milestone) && milestone !== members) {
      errors.push(`milestone (${milestone}) != members (${members})`);
    }

    const result = { ok: errors.length === 0, errors, mission, members, milestone };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error('FAIL Playwright number-sync');
      process.exit(1);
    }
    console.log('PASS Playwright number-sync');
  } finally {
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

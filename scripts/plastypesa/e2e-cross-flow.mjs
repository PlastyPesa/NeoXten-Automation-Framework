#!/usr/bin/env node
/**
 * Lightweight API checks for PlastyPesa E2E orchestration (same auth as API suite).
 * Verifies mobile-relevant config is reachable with user JWT — complements UI layers.
 */
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';

async function main() {
  bootstrapPlastyPesaEnv();
  const baseCfg = getConfig();
  const auth = await resolvePlastyPesaAuth(baseCfg);
  if (!auth.authHeaders) {
    console.error('[e2e-cross-flow] No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL/PASSWORD');
    return 1;
  }
  const cfg = { ...baseCfg, authHeaders: auth.authHeaders };

  const endpoints = [
    { name: 'sort-proof-config', path: '/home/sort-proof/config' },
    { name: 'user-my-profile', path: '/user/my-profile' },
  ];

  let failed = false;
  for (const { name, path } of endpoints) {
    const u = url(cfg, path);
    try {
      const res = await fetch(u, { headers: { ...cfg.authHeaders } });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      const ok = res.ok && json !== null;
      console.log(
        `[e2e-cross-flow] ${name} ${res.status} ${ok ? 'OK' : 'FAIL'} ${u}`,
      );
      if (!ok) {
        console.error('  body:', text.slice(0, 500));
        failed = true;
      } else if (name === 'sort-proof-config' && json?.data && typeof json.data.enabled !== 'boolean') {
        console.warn('[e2e-cross-flow] sort-proof config: data.enabled missing (non-fatal)');
      }
    } catch (e) {
      console.error(`[e2e-cross-flow] ${name} error:`, e);
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

const code = await main();
process.exit(code);

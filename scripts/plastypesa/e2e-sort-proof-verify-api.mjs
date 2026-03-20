#!/usr/bin/env node
/**
 * After admin E2E wrote `.neoxten/sort-proof-e2e-state.json`, verify
 * GET /home/sort-proof/config matches `expectedEnabled` (same JWT as mobile user).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');

async function main() {
  bootstrapPlastyPesaEnv();
  const statePath = resolve(NEOXTEN_ROOT, '.neoxten/sort-proof-e2e-state.json');
  if (!existsSync(statePath)) {
    console.error('[sort-proof-verify] Missing state file:', statePath);
    return 1;
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const { expectedEnabled } = state;
  if (typeof expectedEnabled !== 'boolean') {
    console.error('[sort-proof-verify] state.expectedEnabled must be boolean');
    return 1;
  }

  const baseCfg = getConfig();
  const auth = await resolvePlastyPesaAuth(baseCfg);
  if (!auth.authHeaders) {
    console.error('[sort-proof-verify] No JWT — set PLASTYPESA_USER_JWT or test login');
    return 1;
  }
  const cfg = { ...baseCfg, authHeaders: auth.authHeaders };

  const u = url(cfg, '/home/sort-proof/config');
  const r = await fetch(u, { headers: { ...cfg.authHeaders } });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error('[sort-proof-verify] Non-JSON:', text.slice(0, 400));
    return 1;
  }
  if (r.status !== 200 || body?.type !== 'success') {
    console.error('[sort-proof-verify] Bad response', r.status, text.slice(0, 400));
    return 1;
  }
  const enabled = body?.data?.enabled;
  if (typeof enabled !== 'boolean') {
    console.error('[sort-proof-verify] data.enabled missing or not boolean');
    return 1;
  }
  if (enabled !== expectedEnabled) {
    console.error(
      `[sort-proof-verify] Mismatch: API enabled=${enabled}, expected=${expectedEnabled}`,
    );
    return 1;
  }
  console.log(`[sort-proof-verify] OK GET sort-proof/config enabled=${enabled}`);
  return 0;
}

main().then((c) => process.exit(c));

#!/usr/bin/env node
/**
 * PlastyPesa Europe browser E2E — resolves JWT like the API suite, injects
 * window.__plastyToken for plastypesa-europe.yaml (avoids hardcoded login / 2FA).
 *
 * Env: PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD
 *      (same as scripts/plastypesa-api-test.js). See scripts/plastypesa/README.md.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { bootstrapPlastyPesaEnv } from './plastypesa/env-bootstrap.mjs';
import { getConfig } from './plastypesa/config.mjs';
import { resolvePlastyPesaAuth } from './plastypesa/auth-bootstrap.mjs';

bootstrapPlastyPesaEnv();
const baseCfg = getConfig();
const auth = await resolvePlastyPesaAuth(baseCfg);
const bearer = auth.authHeaders?.Authorization;
if (!bearer) {
  console.error(
    '\n[plastypesa-europe] No JWT. Set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD.\n',
  );
  process.exit(1);
}
const token = bearer.replace(/^Bearer\s+/i, '');
process.env.NEOXTEN_PLASTYPESA_WINDOW_JWT = token;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const neoRoot = resolve(scriptDir, '..');
const r = spawnSync(
  process.execPath,
  ['dist/cli/index.js', 'run', '--config', 'plastypesa-europe.yaml'],
  { cwd: neoRoot, stdio: 'inherit', env: process.env },
);
process.exit(r.status ?? 1);

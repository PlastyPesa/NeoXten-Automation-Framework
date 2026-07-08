#!/usr/bin/env node
/**
 * Phase 2 staff access — LOCAL admin RBAC verification (API level).
 *
 * Boots the real PlastyPesa backend (lib/lambda/backend/index.js) against an
 * isolated in-memory MongoDB, seeds an admin + review fixtures, then runs the
 * admin-rbac suite over real HTTP. Production is never touched; no live API
 * calls happen before deploy approval.
 *
 * Run: npm run test:plastypesa-admin-rbac
 *
 * Env:
 *   PLASTYPESA_BACKEND_DIR — backend repo root
 *     (default: C:\Users\Bobby\Documents\plastypesa-backend-api)
 *   PLASTYPESA_RBAC_PORT   — local port (default 4181)
 */
import { SuiteRunner, printFailureDetails } from './plastypesa/runner.mjs';
import { startLocalRbacEnv } from './plastypesa/local-rbac-env.mjs';
import * as adminRbac from './plastypesa/suites/admin-rbac.mjs';

async function main() {
  console.log('\n=== PlastyPesa Admin RBAC (local, isolated) ===\n');

  const env = await startLocalRbacEnv();

  let exitCode = 1;
  try {
    const runner = new SuiteRunner(adminRbac.id);
    await adminRbac.run(env, runner);
    const s = runner.summary();

    console.log(
      `\n=== Summary ===\n\n  ${adminRbac.id}: ${s.pass} pass, ${s.fail} fail, ${s.skip} skip\n`,
    );
    printFailureDetails(
      s.results
        .filter((r) => r.status === 'FAIL')
        .map((r) => ({ suite: adminRbac.id, name: r.name, error: r.error })),
    );
    exitCode = s.fail > 0 ? 1 : 0;
  } catch (err) {
    console.error('\nFATAL:', err?.message || err);
    exitCode = 1;
  } finally {
    await env.stop();
  }
  process.exit(exitCode);
}

main();

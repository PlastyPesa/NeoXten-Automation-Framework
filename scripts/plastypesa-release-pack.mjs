#!/usr/bin/env node
/**
 * PlastyPesa API — **release validation pack** (standard pre-deploy gate).
 *
 * - Enables release-pack suite selection
 * - Requires authenticated resolution (JWT or test login from env / `.env`)
 *
 * @see scripts/plastypesa/release-pack-config.mjs
 * @see scripts/plastypesa/README.md
 */
process.env.PLASTYPESA_RELEASE_PACK = '1';
process.env.PLASTYPESA_REQUIRE_AUTHENTICATED = '1';

const { runPlastyPesaApiSuite } = await import('./plastypesa/index.mjs');
const code = await runPlastyPesaApiSuite();
process.exit(code);

#!/usr/bin/env node
/**
 * Runs ONLY the launch-sync API suite (recognition-first launch contract):
 * prizes payload, legal masters wording, landing-data payload, market config.
 * Full suite catalogue: scripts/plastypesa/index.mjs
 */
process.env.PLASTYPESA_SUITES = 'launch-sync';
const { runPlastyPesaApiSuite } = await import('./plastypesa/index.mjs');
process.exit(await runPlastyPesaApiSuite());

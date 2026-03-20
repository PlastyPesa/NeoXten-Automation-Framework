/**
 * Fast CI gate: unauthenticated protection checks only.
 */
import { runPlastyPesaApiSuite } from './plastypesa/index.mjs';

process.env.PLASTYPESA_AUTH_ONLY = '1';
process.exit(await runPlastyPesaApiSuite());

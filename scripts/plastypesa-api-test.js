/**
 * PlastyPesa Backend API — regression & smoke tests (Node fetch).
 *
 * Full modular suite lives in ./plastypesa/
 * Run: node scripts/plastypesa-api-test.js
 *
 * @see scripts/plastypesa/README.md
 */
import { runPlastyPesaApiSuite } from './plastypesa/index.mjs';

const code = await runPlastyPesaApiSuite();
process.exit(code);

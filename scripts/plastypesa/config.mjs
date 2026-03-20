/**
 * PlastyPesa API test configuration (env-driven for CI and local secrets).
 */
import { RELEASE_PACK_SUITE_IDS } from './release-pack-config.mjs';

const DEFAULT_API_BASE =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

/**
 * @typedef {object} PlastyPesaConfig
 * @property {string} apiBase
 * @property {string} userJwt
 * @property {string} testEmail
 * @property {string} testPassword
 * @property {string} testDeviceId
 * @property {boolean} authOnly
 * @property {boolean} sortProofE2E
 * @property {boolean} requireAuthenticated
 * @property {string[]} suiteFilter
 * @property {Record<string,string>} headersJson
 * @property {Record<string,string>|null} authHeaders
 * @property {string} [authSource]
 */

export function getConfig() {
  const apiBase = (
    process.env.PLASTYPESA_API_BASE || DEFAULT_API_BASE
  ).replace(/\/$/, '');
  const userJwt = (process.env.PLASTYPESA_USER_JWT || '').trim();
  const testEmail = (process.env.PLASTYPESA_TEST_EMAIL || '').trim();
  const testPassword = process.env.PLASTYPESA_TEST_PASSWORD || '';
  const testDeviceId = (process.env.PLASTYPESA_TEST_DEVICE_ID || '').trim();
  const authOnly = process.env.PLASTYPESA_AUTH_ONLY === '1';
  const sortProofE2E = process.env.PLASTYPESA_SORT_PROOF_E2E === '1';
  const requireAuthenticated =
    process.env.PLASTYPESA_REQUIRE_AUTHENTICATED === '1';

  const releasePack = process.env.PLASTYPESA_RELEASE_PACK === '1';

  let suiteFilter = (process.env.PLASTYPESA_SUITES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (releasePack && suiteFilter.length === 0) {
    suiteFilter = [...RELEASE_PACK_SUITE_IDS];
  }

  return {
    apiBase,
    userJwt,
    testEmail,
    testPassword,
    testDeviceId,
    authOnly,
    sortProofE2E,
    requireAuthenticated,
    releasePack,
    suiteFilter,
    headersJson: { 'Content-Type': 'application/json' },
    /** Set by resolvePlastyPesaAuth() in index.mjs */
    authHeaders: null,
  };
}

export function url(cfg, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${cfg.apiBase}${p}`;
}

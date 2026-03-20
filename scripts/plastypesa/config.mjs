/**
 * PlastyPesa API test configuration (env-driven for CI and local secrets).
 */
const DEFAULT_API_BASE =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

export function getConfig() {
  const apiBase = (
    process.env.PLASTYPESA_API_BASE || DEFAULT_API_BASE
  ).replace(/\/$/, '');
  const userJwt = (process.env.PLASTYPESA_USER_JWT || '').trim();
  const authOnly = process.env.PLASTYPESA_AUTH_ONLY === '1';
  const sortProofE2E = process.env.PLASTYPESA_SORT_PROOF_E2E === '1';

  const suiteFilter = (process.env.PLASTYPESA_SUITES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    apiBase,
    userJwt,
    authOnly,
    sortProofE2E,
    /** Empty = run all suites */
    suiteFilter,
    headersJson: { 'Content-Type': 'application/json' },
    authHeaders: userJwt
      ? {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userJwt}`,
        }
      : null,
  };
}

export function url(cfg, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${cfg.apiBase}${p}`;
}

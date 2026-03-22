/**
 * PlastyPesa **release pack** — standard pre-deploy gate (high-signal suites only).
 *
 * Keep this list explicit so optional/experimental suites can be added to the full
 * runner without automatically widening the release gate.
 *
 * Run: `node scripts/plastypesa-release-pack.mjs` (sets RELEASE_PACK + REQUIRE_AUTHENTICATED)
 * Or: `PLASTYPESA_RELEASE_PACK=1` with secrets in env / `.env`
 */
export const RELEASE_PACK_SUITE_IDS = [
  'auth-baseline',
  'public-routes',
  'user-profile',
  'impact-report',
  'sort-proof',
  'regression-core',
];

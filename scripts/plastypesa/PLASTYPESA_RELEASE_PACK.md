# PlastyPesa release pack (NeoXten)

**Purpose:** Single, repeatable **pre-deploy gate** for the PlastyPesa API — same high-signal suites every time, with **authentication required**.

## Command

```bash
npm run test:plastypesa-api:release-pack
```

Equivalent:

```bash
node scripts/plastypesa-release-pack.mjs
```

This sets:

- `PLASTYPESA_RELEASE_PACK=1` — use the explicit suite list in `release-pack-config.mjs` (when `PLASTYPESA_SUITES` is unset).
- `PLASTYPESA_REQUIRE_AUTHENTICATED=1` — fail if no JWT can be resolved (env JWT or cached/login).

## What runs (suite ids)

Defined in **`release-pack-config.mjs`**:

1. `auth-baseline` — unauthenticated boundary checks  
2. `public-routes` — public home payloads  
3. `user-profile` — profile + completion %  
4. `impact-report` — impact payload sanity  
5. `sort-proof` — config / validation / disabled behavior (no Anthropic unless `PLASTYPESA_SORT_PROOF_E2E=1`)  
6. `regression-core` — leaderboard, winners wall (incl. stability), reward-history + transaction list consistency, badges  

## CI

Store **`PLASTYPESA_USER_JWT`** or **`PLASTYPESA_TEST_EMAIL`** + **`PLASTYPESA_TEST_PASSWORD`** as protected variables, then run `npm run test:plastypesa-api:release-pack` against the target `PLASTYPESA_API_BASE`.

## Full vs release pack

- **Full run:** `node scripts/plastypesa-api-test.js` — currently the same suite set as the release pack; future **experimental** suites may be full-only.  
- **Release pack:** explicit list + **auth required** via the release-pack entry script.

## Sort-proof Anthropic E2E (not part of default pack)

The release-pack **skips** `sort_proof_live_anthropic_extra_submission` unless **`PLASTYPESA_SORT_PROOF_E2E=1`**.

**Recommended:** run the **staging** procedure in **[README.md — Sort-proof live E2E](README.md#sort-proof-live-e2e-anthropic--pilot--pre-prod)** after release-pack is green: set **`PLASTYPESA_API_BASE`** to staging, authenticate, then run with **`PLASTYPESA_SUITES=sort-proof`** and **`PLASTYPESA_SORT_PROOF_E2E=1`**.

Post-checks (points, reward-history, impact) are **manual** or separate tooling — see README.

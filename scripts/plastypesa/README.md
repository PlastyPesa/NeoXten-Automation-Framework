# PlastyPesa API automated regression (NeoXten)

Durable, **Node.js `fetch`** suite against the PlastyPesa API Gateway (no Playwright required for these checks).

## Run

From the NeoXten repo root:

```bash
node scripts/plastypesa-api-test.js
```

Equivalent:

```bash
node scripts/plastypesa/index.mjs
```

## Suites

| Suite | Purpose |
|--------|---------|
| `auth-baseline` | Protected routes return **401/403** without `Authorization`; auth endpoints respond |
| `public-routes` | Public home routes (`/home/winners`, `/home/weekly-challenge`) **200** + shape |
| `impact-report` | Authenticated **GET /home/impact-report** — `userImpact`, `communityContext`, `config` |
| `weekly-challenge` | Status shape; **complete** idempotent (**409** if already done, **404** if no master) |
| `sort-proof` | Config shape; submit matches **enabled** flag; **400** validation when enabled; optional E2E |
| `regression-core` | Winners wall, reward history, challenges, badges |

## Environment variables

| Variable | Description |
|----------|-------------|
| `PLASTYPESA_API_BASE` | API root (default: prod `…/prod/api`) |
| `PLASTYPESA_USER_JWT` | Bearer JWT for a **real test user** (unlocks authenticated suites) |
| `PLASTYPESA_AUTH_ONLY=1` | Only `auth-baseline` (fast CI gate) |
| `PLASTYPESA_SUITES` | Comma list to run a subset, e.g. `auth-baseline,sort-proof` |
| `PLASTYPESA_SORT_PROOF_E2E=1` | Extra **POST** that calls **Anthropic** (quota/cost; requires feature **on**) |
| `PLASTYPESA_ENV_FILE` | Path to `.env` (default: NeoXten `../../.env` from this folder) — only `PLASTYPESA_*` keys |

Place secrets in NeoXten `.env` (not committed), e.g.:

```env
PLASTYPESA_USER_JWT=eyJhbGciOi...
```

## Manual-only gaps

1. **OTP / password login** to obtain a JWT is not automated here (would need test credentials + stable auth flow). Supply `PLASTYPESA_USER_JWT` from a device session or a future **service test user** + login script.
2. **Realistic photo + Anthropic quality** judgment: optional `PLASTYPESA_SORT_PROOF_E2E` uses a **1×1 PNG** — verifies the pipeline, not real-world sorting photos. Full visual QA remains manual or a future fixture of a real encoded image.
3. **Daily cap (429)** on sort-proof: intentionally not stressed by default (would consume quota / state). Add a dedicated stress suite later if needed.

## Release checklist

1. `PLASTYPESA_AUTH_ONLY=1 node scripts/plastypesa-api-test.js` — must pass in CI.  
2. With staging token: full suite without `SORT_PROOF_E2E`.  
3. Before prod sort-proof launch: enable feature + `PLASTYPESA_SORT_PROOF_E2E=1` once on staging.

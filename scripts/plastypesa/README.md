# PlastyPesa API automated regression (NeoXten)

Durable, **Node.js `fetch`** suite against the PlastyPesa API Gateway (no Playwright required for these checks).

### Orchestrated E2E (API + crossflow + admin Playwright + Flutter device)

See **`PLASTYPESA_E2E.md`**. Entry: `npm run test:plastypesa-e2e` (NeoXten root). Does **not** replace the API release-pack scripts; optional `PLASTYPESA_E2E_API_MODE=release-pack`.

**Sort-proof admin ↔ API ↔ device (single flow):** **`PLASTYPESA_SORT_PROOF_VISIBILITY_E2E.md`** — `npm run test:plastypesa-e2e:sort-proof-visibility`.

### Localization audit (static + browser + ADB device)

See **`PLASTYPESA_LOCALIZATION_AUDIT.md`**. Entry: `npm run test:plastypesa-localization`.

## App health monitor (Play vitals + live version)

```bash
npm run monitor:plastypesa
```

Setup / owner manual steps: **`MONITOR_SETUP.md`**. Writes `.neoxten/plastypesa-monitor-latest.json`.

## Run

From the NeoXten repo root:

```bash
node scripts/plastypesa-api-test.js
```

Equivalent:

```bash
node scripts/plastypesa/index.mjs
```

### Release pack (pre-deploy gate)

```bash
npm run test:plastypesa-api:release-pack
```

Uses the explicit suite list in **`release-pack-config.mjs`** and **requires** a resolved JWT (same auth sources as below). See **`PLASTYPESA_RELEASE_PACK.md`**.

## Authenticated runs (no manual JWT paste)

**Priority order** (see `auth-bootstrap.mjs`):

1. **`PLASTYPESA_USER_JWT`** — inject a Bearer token (CI secret, short-lived OK).
2. **Token cache** — after a successful password login, JWT is stored in **`.neoxten/plastypesa-token-cache.json`** (gitignored) and reused until `exp` is near (skew 120s). Disable with **`PLASTYPESA_TOKEN_CACHE=0`**.
3. **`PLASTYPESA_TEST_EMAIL` + `PLASTYPESA_TEST_PASSWORD`** — `POST /auth/login` (optional **`PLASTYPESA_TEST_DEVICE_ID`**).

If email/password are misconfigured (only one set), the suite **exits with an error** (clear message).  
**`PLASTYPESA_REQUIRE_AUTHENTICATED=1`** — exit non-zero when no JWT could be resolved (release gates).

## Suites

| Suite | Purpose |
|--------|---------|
| `auth-baseline` | Protected routes return **401/403** without `Authorization`; auth endpoints respond |
| `public-routes` | Public home routes (`/home/winners`, `/home/weekly-challenge`) **200** + shape |
| `user-profile` | **GET /user/my-profile**, **GET /user/completion-percentage** — stats + completion shape |
| `impact-report` | **GET /home/impact-report** — extended `userImpact`, `communityContext`, `config`, share text |
| `weekly-challenge` | Status shape; **complete** idempotent (**409** if already done, **404** if no master); double-submit |
| `sort-proof` | Config shape; submit matches **enabled** flag; **400** validation when enabled; optional E2E |
| `challenges-progress` | **GET /challenges/active** (progress fields); **POST /challenges/check-progress** (400 invalid; SORT success shape) |
| `regression-core` | Home leaderboard, winners wall (+ double-fetch stability), reward history + weekly page sum bound, **POST /transaction/all**, badges, **POST /home/check-badges** |

## Environment variables

| Variable | Description |
|----------|-------------|
| `PLASTYPESA_API_BASE` | API root (default: prod `…/prod/api`) |
| `PLASTYPESA_USER_JWT` | Injected Bearer JWT (highest priority) |
| `PLASTYPESA_TEST_EMAIL` / `PLASTYPESA_TEST_PASSWORD` | Password login → token (+ optional cache) |
| `PLASTYPESA_TEST_DEVICE_ID` | Optional field on login body |
| `PLASTYPESA_TOKEN_CACHE` | `0` to disable writing/reading token cache |
| `PLASTYPESA_TOKEN_CACHE_PATH` | Override cache file path |
| `PLASTYPESA_REQUIRE_AUTHENTICATED` | `1` = fail if no JWT after bootstrap |
| `PLASTYPESA_AUTH_ONLY` | `1` = only `auth-baseline` |
| `PLASTYPESA_SUITES` | Comma subset, e.g. `auth-baseline,sort-proof` |
| `PLASTYPESA_SORT_PROOF_E2E` | `1` = extra **POST** calling **Anthropic** (quota/cost; feature must be on) |
| `PLASTYPESA_ENV_FILE` | Path to `.env` (default: NeoXten `../../.env` from this folder) — only `PLASTYPESA_*` keys |

Place secrets in NeoXten `.env` (not committed). See repo **`.env.example`**.

## Sort-proof pilot verification (E2E + post-check chain)

After release-pack is green, run **one** live Anthropic submission and compare **impact**, **reward-history**, and **transaction** list (uses same tiny PNG as the suite).

```bash
npm run verify:plastypesa-sort-proof-pilot
```

Equivalent: `node scripts/plastypesa/verify-sort-proof-pilot.mjs`

- Set **`PLASTYPESA_API_BASE`** to **staging** when available; otherwise use prod with a **test account** only.
- Requires **`PLASTYPESA_USER_JWT`** or email/password login.
- Fails fast if **`GET /home/sort-proof/config`** has **`enabled: false`** (enable in admin first).
- **429** from daily cap: exits **0** with a message — re-run later or raise cap for testing.
- **Rollback / disable** is **not** automated: use admin + **`plastypesa-backend-api/docs/SORT_PROOF_RUNBOOK.md`** (`GET` config → **`POST` returns 403** when off).

## Manual-only gaps

1. **OTP-only accounts** still need **`PLASTYPESA_USER_JWT`** unless the test user has a password set.
2. **Realistic photo + Anthropic quality**: optional `PLASTYPESA_SORT_PROOF_E2E` uses a **1×1 PNG** — verifies the pipeline, not real-world sorting photos.
3. **Daily cap (429)** on sort-proof: not stressed by default.

## Release checklist

1. `PLASTYPESA_AUTH_ONLY=1 node scripts/plastypesa-api-test.js` — fast CI smoke (no secrets).  
2. **Pre-deploy:** `npm run test:plastypesa-api:release-pack` with secrets in env — must pass (includes authenticated business flows).  
3. Optional full exploratory run: `node scripts/plastypesa-api-test.js` with auth (same suite list as release pack until optional suites are added).  
4. Before prod sort-proof pilot: run **`npm run verify:plastypesa-sort-proof-pilot`** (or `PLASTYPESA_SORT_PROOF_E2E=1` + `PLASTYPESA_SUITES=sort-proof`); then device QA and ops runbook.

# PlastyPesa — API regression automation (NeoXten)

## Entry points

| Command | Purpose |
|---------|---------|
| `npm run test:plastypesa-api` | Full suite (public + auth baseline + authenticated tests if `PLASTYPESA_USER_JWT` set) |
| `npm run test:plastypesa-api:auth-only` | Fast gate: JWT protection only |
| `node scripts/plastypesa-api-test.js` | Same as `test:plastypesa-api` |

## Implementation

- `scripts/plastypesa/` — modular suites (`auth-baseline`, `public-routes`, `impact-report`, `weekly-challenge`, `sort-proof`, `regression-core`)
- `scripts/plastypesa/README.md` — env vars, manual gaps, release checklist

## Relation to Playwright YAML

- `plastypesa-api.yaml` — legacy browser-context `evaluate` checks (still valid for CORS parity tests).
- Prefer the **Node suite** for CI and deeper coverage (no dev server required).

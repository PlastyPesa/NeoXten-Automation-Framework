# NeoXten agent contract (API + closure)

Agents should drive the **Operator HTTP API** (default `127.0.0.1:8787`, bearer token if `NEOXTEN_OPERATOR_API_TOKEN` is set). Do not scrape the dashboard HTML as the primary contract.

## Run lifecycle

1. **Execute** a NeoXten run (CLI or CI) so a run directory exists with `run-manifest.json`, `verdict.json`, and artifacts.
2. **Ingest**: `POST /api/runs/ingest` with `{ "runDir": "<absolute path>" }` (optional `manifest` body to override file read).
3. **Poll** `GET /api/runs` until the new row appears (match `neoxtenRunId` to manifest `runId`).

## Read paths

| Endpoint | Purpose |
|----------|---------|
| `GET /api/runs/:id` | Run row + artifact index |
| `GET /api/runs/:id/raw?relpath=...` | Bytes for screenshots, logs, JSON artifacts |
| `GET /api/runs/:id/findings` | Structured `{ findings: Finding[] }` |
| `GET /api/runs/:id/retest-items` | Checklist rows for this run |
| `GET /api/runs/:id/validation-closure` | Aggregated closure object (404 if legacy run has no closure) |
| `GET /api/findings/:id/narrative` | Strict JSON narrative derived only from stored finding fields |
| `GET /api/issues` | Promoted / failure issues |

## Triage and iteration

| Endpoint | Purpose |
|----------|---------|
| `PATCH /api/findings/:id` | Body `{ "promotionState": "dismissed" \| "advisory" \| ... }`, optional `mergePayload` |
| `POST /api/runs/:runId/findings/:findingId/promote` | Creates an **issue** + `explain_bindings` narrative stub |
| `PATCH /api/retest-items/:id` | Body `{ "status": "passed" \| "waived" \| "pending", "waiveReason"?: "..." }` |
| `POST /api/patches` | Body includes `changedFiles?: string[]`, `linkedRunDbId?: string` → auto **retest plan** rows |
| `GET /api/patches/:id/retest-items` | Items attached to a patch proposal |
| `POST /api/baselines/record` | Store approved visual baseline `{ baselineKey, contentSha256, approvedRunDbId? }` |

## Validation closure (when is work “done”?)

Call `GET /api/runs/:id/validation-closure`. Agents **must not** treat `verdict === PASS` alone as completion.

**Do not** treat work as complete when:

- `verdict_ok` is false, or `blocking_findings_count > 0`.
- `pending_required_retests > 0` (all `required` retest items must be `passed` or `waived` with reason).
- `high_confidence_suspicion_present` is true and policy requires triage.
- `open_promoted_issues_blockers > 0` when linked to the change (operator-maintained; default ingest uses `0` until issues are wired).
- `operator_review_satisfied` is false when the project enforces operator sign-off.

**May** treat as complete when all of the above are clear, advisory debt is explicitly accepted (`accepted_debt` + listing in manifest/operator policy), and there are no blocking findings or pending required retests.

If the closure endpoint returns **404**, the run predates closure storage — re-ingest after upgrading the runner, or fall back to manifest JSON field `validationClosure` on `run-manifest.json`.

## Artifacts and sidecar oracles

Runs may include machine-generated sidecars the runner merges into **findings**:

- `a11y-report.json` → `a11y` findings
- `design-token-diff.json` → `design_system` findings with `evidence_strength` inferred per violation (`proven` when expected/actual diff is present, else `likely` or `suggestive`; `suggestive_only` forces suggestive). Proven rows may set `blocks_merge: true` when `NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE=1`.
- `exploration-map.json` when an **exploratory charter** is configured (`exploratoryCharter` in `neoxten.yaml`)

## Polling

Use modest intervals (e.g. 2–5s) for run lists; cache manifest/findings locally by `runId`.

## Optional operator ingest flags

| Variable | Effect |
|----------|--------|
| `NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN=1` | On **passed** runs, open or update triage **issues** (`classification: design_system_auto`) for each **proven** `design_system` finding. |
| `NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE=1` | Manifest assembly sets `blocks_merge: true` on **proven** design-token findings (use sparingly). |

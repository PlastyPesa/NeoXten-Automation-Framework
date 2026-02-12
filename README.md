# NeoXten Automation Framework

Production-ready CLI automation framework for Cursor agents to run, test, measure, detect, fix, and loop until PASS across Tauri, Next.js, and browser extension projects.

## System Doctrine

- [**NeoXten OS**](docs/NEOXTEN_OS.md) — Apple-grade doctrine: evidence-first, bounded async, one-send-one-inference, agent-executes.
- [**Automation Framework Spec**](docs/AUTOMATION_FRAMEWORK_SPEC.md) — CLI contract, artifact structure, agent contract, project types.

## Quick Start

```bash
# Install (Chromium is installed automatically via postinstall)
npm install

# Build
npm run build

# Run smoke test (validates framework)
node dist/cli/index.js run --config neoxten-smoke.yaml
```

## CLI Usage

```
neoxten run [--config ./neoxten.yaml] [--out-dir .neoxten-out] [--loop-until-pass] [--retry]
```

**Exit codes:**
- `0` — PASS (all gates passed)
- `1` — Product failure (reproducible UI/assistant/gate failure)
- `2` — Infrastructure failure (launch failed, driver crash, config error)

## Output

- **Stdout:** Single JSON verdict for agent parsing
- **Artifacts:** `.neoxten-out/<run-id>/` containing:
  - `verdict.json`
  - `playwright-trace.zip`
  - `screenshots/` (fail + final)
  - `console.log`
  - `backend.log` (Tauri)
  - `assistant-metrics.json`
  - `performance.json`

## Project Types

| Type | Strategies | Description |
|------|------------|-------------|
| `web` | — | Connect Playwright to URL (no launch) |
| `tauri` | `harness`, `cdp` | Harness: Vite dev only. CDP: WebView2 remote debugging |
| `nextjs` | — | Spawn dev server, connect Playwright |

## Tauri CDP (Windows)

For full Tauri + assistant testing, the app must expose WebView2 for CDP. Set before launch:
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- `WEBVIEW2_USER_DATA_FOLDER` (unique per run)

The framework's Tauri CDP driver sets these automatically when spawning.

## Agent Contract

Verdict JSON includes:
- `verdict`, `exitCode`, `runId`
- `failingStage`, `failingFlow`, `failingStep`
- `measured` vs `thresholds`
- `artifactPaths`
- `logExcerpts`, `sourceHints`
- `reproducibleCommand`
- `inferenceAccounting` (when assistant + backend logs available)

## Example neoxten.yaml

```yaml
project:
  type: tauri
  root: ../neoxtemus-ai
  tauri:
    strategy: harness  # or cdp for full desktop
    devCwd: ui
    devUrl: http://localhost:1420

flows:
  - name: app_loads
    steps:
      - action: wait
        timeout: 8000
      - action: assert
        type: visible
        selector: ".assistant-view"

assistant:
  enabled: true
  type: in_app

gates:
  startupMaxMs: 90000
  noConsoleErrors: false
```

# NeoXten Automation Framework — Specification

Production-ready CLI automation framework for Cursor agents to run, test, measure, detect, fix, and loop until PASS across Tauri, Next.js, and browser extension projects.

---

## 1. Objective

Enable zero-touch validation: a Cursor agent implements a feature, runs `neoxten run`, receives structured failure diagnostics, fixes code, re-runs, and achieves PASS without human QA.

---

## 2. CLI Contract

### Entry Command

```
neoxten run [--config ./neoxten.yaml] [--out-dir .neoxten-out] [--loop-until-pass] [--retry]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | PASS — all gates passed |
| `1` | Product failure — reproducible UI/assistant/gate failure |
| `2` | Infrastructure failure — launch failed, driver crash, config error |

### Output

- **Stdout:** Single JSON verdict for agent parsing
- **Artifacts:** `.neoxten-out/<run-id>/`

---

## 3. Artifact Structure

| Artifact | Purpose |
|----------|---------|
| `verdict.json` | Canonical run result |
| `playwright-trace.zip` | Browser trace for debugging |
| `screenshots/` | Fail + final state captures |
| `console.log` | Frontend console output |
| `backend.log` | Tauri/process stderr (when applicable) |
| `assistant-metrics.json` | Latency, tokens, reliability data |
| `performance.json` | Startup and resource metrics |

---

## 4. Project Types

| Type | Strategies | Description |
|------|------------|-------------|
| `web` | — | Connect Playwright to URL (no launch) |
| `tauri` | `harness`, `cdp` | Harness: Vite dev only. CDP: WebView2 remote debugging |
| `nextjs` | — | Spawn dev server, connect Playwright |

### Tauri CDP (Windows)

For full Tauri + assistant testing, the app must expose WebView2 for CDP:

- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
- `WEBVIEW2_USER_DATA_FOLDER` (unique per run)

The framework sets these automatically when spawning.

---

## 5. Agent Contract (Verdict JSON)

| Field | Description |
|-------|-------------|
| `verdict` | `PASS` \| `FAIL` |
| `exitCode` | 0 \| 1 \| 2 |
| `runId` | Unique run identifier |
| `failingStage` | `launch` \| `ui_flow` \| `assistant` \| `gate` |
| `failingFlow` | Flow name (when applicable) |
| `failingStep` | Step index (when applicable) |
| `measured` | Actual values vs thresholds |
| `thresholds` | Gate thresholds |
| `artifactPaths` | Paths to all artifacts |
| `logExcerpts` | Relevant log snippets |
| `sourceHints` | Likely source files (best effort) |
| `reproducibleCommand` | Command to re-run |
| `inferenceAccounting` | Backend/llama spawn counts (when available) |

---

## 6. Example Config (neoxten.yaml)

```yaml
project:
  type: tauri
  root: ../neoxtemus-ai
  tauri:
    strategy: harness
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

---

## 7. Quick Start

```bash
npm install
npm run build
node dist/cli/index.js run --config neoxten-smoke.yaml
```

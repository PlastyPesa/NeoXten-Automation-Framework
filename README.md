# NeoXten Automation Framework

Session-based execution environment for automated UI testing, observation, and evidence production.

## Prerequisites

- **Node.js** >= 18
- **Windows 10/11** (primary target; Linux/macOS supported)
- Chromium is installed automatically via Playwright on `npm install`

## Install

```bash
git clone <repo-url> NeoXten-Automation-Framework
cd NeoXten-Automation-Framework
npm install
npm run build
```

## Usage

### Run automation flows (JSON verdict output)

```bash
node dist/cli/index.js run --config path/to/neoxten.yaml
```

### Inspect a running app (structured observation)

```bash
# Launch from config and report what's on screen
node dist/cli/index.js inspect --config path/to/neoxten.yaml

# Connect to an already-running app
node dist/cli/index.js inspect --url http://localhost:1420
```

### Programmatic API

```typescript
import { createSession, connect, loadConfig } from './dist/api/index.js';

const config = loadConfig('./neoxten.yaml');
const session = await createSession(config, './neoxten.yaml');

const snapshot = await session.observe();
console.log(snapshot.buttons, snapshot.visibleText);

const result = await session.act({ type: 'click', selector: 'button.submit' });
console.log(result.success, result.after.visibleText);

await session.close();
```

## Config format

```yaml
project:
  type: tauri          # tauri | nextjs | web
  root: .
  tauri:
    strategy: harness  # harness (frontend only) | cdp (full app)
    devCommand: npm run tauri:dev
    harnessCommand: npm run dev
    devCwd: ui
    devUrl: http://localhost:1420

flows:
  - name: app_loads
    steps:
      - action: wait
        timeout: 5000
      - action: assert
        type: visible
        selector: "[data-testid='main-view']"
        timeout: 10000

gates:
  startupMaxMs: 30000
  noConsoleErrors: true
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | PASS — all flows and gates passed |
| 1 | FAIL — a flow step or gate failed |
| 2 | INFRA FAIL — launch error, config error, or connectivity failure |

## Output structure

```
.neoxten-out/<runId>/
  verdict.json              # structured verdict
  evidence-timeline.json    # full audit trail
  console.log               # framework logs
  screenshots/              # failure + final screenshots
  playwright-trace.zip      # Playwright trace (on failure)
  performance.json          # startup timing
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm run dev` | Watch mode compilation |
| `npm run test:paths` | Path resolution regression test |
| `npm run test:enoent` | ENOENT structured failure test |

## Architecture

```
src/
  observer/      # DOM snapshot, console stream, network monitoring
  session/       # Session class: launch, connect, observe, act
  actions/       # Action types and executor with before/after observation
  evidence/      # Timeline-based evidence accumulation
  drivers/       # Playwright-based UI drivers (web, tauri-harness, tauri-cdp, nextjs)
  adapters/      # Project type adapters (tauri, nextjs, web)
  core/          # Orchestrator, verdict builder, gate evaluator, artifact manager
  config/        # Zod schema validation, YAML loader
  flows/         # Flow executor, spinner/hang detectors
  assistant/     # HTTP and in-app assistant testing
  cli/           # Commander-based CLI (run, inspect)
  api/           # Programmatic entry point
  utils/         # Safe spawn, config paths, retry, run ID
```

## Version

2.0.0 — Stable execution layer baseline.

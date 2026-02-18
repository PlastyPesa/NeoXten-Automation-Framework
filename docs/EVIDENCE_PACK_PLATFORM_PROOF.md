# Evidence Pack Platform — Proof (Apple-Grade)

## Files created/changed

### Specs
- `specs/evidence-pack.schema.json` — meta.json contract (schema_version, pack_id, app_id, created_at)
- `specs/evidence-events.schema.json` — events.ndjson event shape
- `specs/redaction.rules.json` — token patterns + network_strip
- `docs/EVIDENCE_PACK_STANDARD.md` — human-readable summary
- `docs/EVIDENCE_PACK_PLATFORM_PROOF.md` — this file

### Source
- `src/packs/paths.ts` — EvidencePacks root, quarantine, ops/bugs, state DB paths
- `src/packs/validate.ts` — required files + schema_version 2025.1
- `src/packs/redact.ts` — load rules, redactString, redactNdjson, redactJson
- `src/packs/ingest.ts` — ingestZip, ingestFolder (validate, redact, case creation, outputs)
- `src/packs/state.ts` — pack_id -> caseId state
- `src/packs/watch.ts` — chokidar watch, debounce, skip if already ingested
- `src/cli/commands/init.ts` — nx init
- `src/cli/commands/packs.ts` — nx packs ingest, nx packs watch
- `src/cli/commands/bugs.ts` — nx bugs list, open, close
- `src/cli/index.ts` — register nx init, packs, bugs; program name nx
- `src/tools/gen-sample-pack.ts` — emit valid pack zip
- `src/__tests__/packs-ingest.test.ts` — 3 tests (valid ingest, invalid->quarantine, redaction)
- `src/types/adm-zip.d.ts` — AdmZip typings

### Package
- `package.json` — bin "nx", scripts gen-sample-pack, test:packs; deps adm-zip, chokidar

---

## Example: gen-sample-pack -> produced pack path

```
Wrote: C:\Users\Bobby\Documents\NeoXten-Automation-Framework\sample-pack.zip
```

---

## Example: nx packs ingest <that pack> -> case folder path

```
Case: BUG-20260217T224626-neoxtemus-3388beee
Path: C:\Users\Bobby\Documents\NeoXten-Automation-Framework\ops\bugs\cases\BUG-20260217T224626-neoxtemus-3388beee
```

---

## First 20 lines of bug_report.md

```markdown
# Bug Report: BUG-20260217T224626-neoxtemus-3388beee

- **app_id:** neoxtemus
- **screen:** AssistantView
- **last_error:** Sample error for bug_report

## Top 10 events
```ndjson
{"ts":"2026-02-17T22:46:17.383Z","type":"nav","label":"Screen load","data":{}}
{"ts":"2026-02-17T22:46:17.383Z","type":"click","label":"Button","data":{"id":"btn-1"}}
```

## Top 10 logs
...
```

---

## First 20 lines of agent_prompt.md

```markdown
# Mission: Reproduce evidence pack sample-1771368377383

- **Case:** BUG-20260217T224626-neoxtemus-3388beee
- **App:** neoxtemus
- **Screen:** AssistantView

## Hints
1. Last error: Sample error for bug_report
2. Inspect: output/signals.json, output/bug_report.md
3. Events/logs/network (redacted) are in bug_report.md.
```

---

## Redaction test passing (token removed)

Test pack contains a log line with `sk-abc123def456ghi789jkl012xyz`. After ingest:
- Outputs (bug_report.md, logs_excerpt.ndjson) must NOT contain the raw token.
- Outputs must contain `[REDACTED` (redaction placeholder).

```
PASS: redaction removes token pattern from outputs
Result: 3 passed 0 failed
```

---

## Commands summary

- `nx init` — creates ops/bugs/, EvidencePacks root, quarantine
- `nx packs ingest <zip|folder>` — validate, redact, create case, write output/
- `nx packs watch` — watch %LOCALAPPDATA%\NeoXten\EvidencePacks for *.zip, debounce, ingest (no double-ingest same pack_id)
- `nx bugs list` — list case IDs
- `nx bugs open <caseId>` — print agent_prompt.md
- `nx bugs close <caseId>` — move case to ops/bugs/cases/_closed/

State: `.neoxten/packs-ingested.json` (pack_id -> caseId). Invalid packs: `%LOCALAPPDATA%\NeoXten\EvidencePacks\_quarantine\` with `<base>_reason.txt`.

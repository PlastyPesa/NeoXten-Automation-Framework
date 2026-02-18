# Evidence Pack Standard

Local-only, deterministic evidence format for Neoxtemus + Nemyo suite. Redaction by default.

## Required files in every pack

| File | Description |
|------|-------------|
| `meta.json` | Pack metadata: `schema_version`, `pack_id`, `app_id`, `created_at` (required). Optional: `screen`, `summary`. |
| `events.ndjson` | One JSON object per line (NDJSON); each has `ts`, `type`, optional `label`, `data`. |
| `errors.json` | JSON array of error objects (e.g. `{ "message", "stack", "ts" }`). |
| `logs.ndjson` | One log entry per line (NDJSON). |
| `network.ndjson` | One network request/response per line (NDJSON). Query/headers stripped per redaction rules. |
| `ui.json` | Snapshot of UI state (screen, route, etc.). |

## Schema version

Supported: `2025.1`. Packs with other `meta.schema_version` are rejected at ingest.

## Redaction

Applied before writing case outputs (logs, events, errors, network). See `specs/redaction.rules.json`:

- **Token patterns:** API keys, Bearer tokens, passwords, UUIDs replaced with `[REDACTED_*]`.
- **Network:** Query params and headers listed in `network_strip` are removed from stored requests.

## Case output layout (after ingest)

```
ops/bugs/cases/BUG-YYYYMMDD-HHMMSS-<appId>-<shortid>/
  output/
    bug_report.md      # Summary: app_id, screen, last_error, top 10 events/logs/network
    agent_prompt.md    # Mission: reproduce hints + files to inspect
    signals.json       # Structured key signals
    *_excerpt*         # Excerpt files as produced
    attachments/       # Copy of pack attachments/ if present
```

## Quarantine

Invalid packs are moved to `%LOCALAPPDATA%/NeoXten/EvidencePacks/_quarantine/` with a `reason.txt` explaining the failure.

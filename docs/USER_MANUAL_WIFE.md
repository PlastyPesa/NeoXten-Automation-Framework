# NeoXten Automation Framework — User Manual (Wife-Friendly)

## What this does

The framework watches for **Evidence Packs** (zip files) that apps like Neoxtemus or Nemyo create when something goes wrong. When a new pack appears, it is automatically ingested and turned into a **case** (a folder with a bug report and hints for fixing).

You do **not** need to type anything in a terminal. Double-click and optional menu commands only.

---

## First-time setup (Bobby does this once)

1. Install Node.js 18+ from [nodejs.org](https://nodejs.org).
2. Open a terminal in this folder and run:
   - `npm install`
   - `npm run build`
3. Run once: `nx init` — this creates the folders the framework needs.

After that, you can use the launchers below.

---

## Daily use

### Start the watcher (double-click)

- **START.bat** — Double-click to start the Evidence Pack watcher.  
  A window opens and says it’s watching. Leave it open. When Neoxtemus or Nemyo (or any compatible app) writes a pack zip into `%LOCALAPPDATA%\NeoXten\EvidencePacks\`, the framework will ingest it and create a case. Press **Ctrl+C** to stop.

- **START_EXE.bat** — Same as above, but uses the built EXE if it exists (so Node doesn’t need to be in PATH). If there is no EXE, it falls back to Node.

### Optional: check everything is OK

In a terminal in this folder, run:

- `nx doctor` — Checks that folders and environment are set up. If something is wrong, it will say what to do (usually: run `nx init`).

### Optional: look at the latest case

- `nx bugs list` — Lists all case IDs.
- `nx bugs open latest` — Prints the agent prompt for the most recent case (so Bobby or an agent can fix it).
- `nx bugs close latest --note "Fixed by doing X"` — Marks the latest case as closed and moves it to a “closed” area, with a note and timestamp stored in `status.json`.

### Optional: validate a pack without ingesting

- `nx packs validate path\to\pack.zip` — Checks that a zip is a valid Evidence Pack and prints a short report. Does not create a case.

---

## Where things live

- **Packs** (written by apps): `%LOCALAPPDATA%\NeoXten\EvidencePacks\` (e.g. `neoxtemus\`, `nemyo-web\`).
- **Cases** (after ingest): `ops\bugs\cases\BUG-YYYYMMDD-HHMMSS-<app>-<id>\` with `output\bug_report.md`, `output\agent_prompt.md`, etc.
- **Closed cases**: `ops\bugs\cases\_closed\` (each case has a `status.json` with note and closed time).

---

## If something goes wrong

- Run `nx doctor`. If it says “run nx init”, run `nx init` and try again.
- Make sure Node is installed and that you ran `npm install` and `npm run build` at least once.
- If the watcher doesn’t ingest a pack: check that the zip is under `%LOCALAPPDATA%\NeoXten\EvidencePacks\` (or a subfolder). Invalid packs are moved to `_quarantine` with a reason file.

---

## Reference docs

- **Evidence Pack Standard**: `docs/EVIDENCE_PACK_STANDARD.md`
- **Platform proof**: `docs/EVIDENCE_PACK_PLATFORM_PROOF.md`

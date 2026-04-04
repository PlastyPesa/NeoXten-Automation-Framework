#!/usr/bin/env node

import { program } from 'commander';
import { runCommand } from './commands/run.js';
import { inspectCommand } from './commands/inspect.js';
import { gateCommand } from './commands/gate.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { packsIngestCommand, packsWatchCommand, packsValidateCommand } from './commands/packs.js';
import { bugsListCommand, bugsOpenCommand, bugsCloseCommand } from './commands/bugs.js';
import {
  factoryRunCommand, factoryInspectCommand, factoryHistoryCommand,
  consequencesExportCommand, consequencesImportCommand, consequencesStatusCommand,
  manifestExportCommand,
} from './commands/factory.js';
import { operatorIngestCommand, operatorServeCommand } from './commands/operator.js';
import {
  productPathsCommand,
  productReadinessCommand,
  productReadinessSyncCommand,
  productFirstRunStatusCommand,
  productMarkFirstRunCommand,
} from './commands/product.js';

program
  .name('nx')
  .description('NeoXten Automation Framework — observe, act, prove. Evidence Pack CLI: init, packs, bugs.')
  .version('2.1.0');

/* ---- run (backward compatible) ---- */
program
  .command('run')
  .description('Run automation flows and output JSON verdict')
  .option('-c, --config <path>', 'Path to neoxten.yaml', './neoxten.yaml')
  .option('-o, --out-dir <path>', 'Output directory for artifacts', '.neoxten-out')
  .option('--loop-until-pass', 'Exit 1 on FAIL so agent can fix and re-run')
  .option('--max-loops <n>', 'Max retry loops (default 1)', '1')
  .option('--retry', 'Retry once on failure to detect flakiness')
  .action((opts) => runCommand(opts).catch((e) => { console.error(e); process.exit(2); }));

/* ---- inspect (launch and report what's visible) ---- */
program
  .command('inspect')
  .description('Launch or connect to an app and report what is on screen (JSON)')
  .option('-c, --config <path>', 'Path to neoxten.yaml')
  .option('-u, --url <url>', 'Connect to an already-running app at this URL')
  .option('-o, --out-dir <path>', 'Output directory for artifacts', '.neoxten-out')
  .option('-w, --wait <ms>', 'Max ms to wait for page to settle (default 5000)', '5000')
  .action((opts) => inspectCommand(opts).catch((e) => { console.error(e); process.exit(2); }));

/* ---- gate (validation gate: nemyo | neoxtemus) ---- */
program
  .command('gate')
  .description('Run a validation gate (presets: nemyo, neoxtemus)')
  .option('-p, --preset <name>', 'Gate preset to run (nemyo | neoxtemus)', 'nemyo')
  .option('-o, --out-dir <path>', 'Output directory for artifacts', '.neoxten-out')
  .option('--skip-integration', 'Skip flutter_integration steps (use when no device connected)')
  .action((opts) => gateCommand(opts).catch((e) => { console.error(e); process.exit(2); }));

/* ---- Evidence Pack: init ---- */
program
  .command('init')
  .description('Bootstrap ops/bugs and EvidencePacks root')
  .action(() => initCommand());

/* ---- Evidence Pack: doctor ---- */
program
  .command('doctor')
  .description('Check Evidence Pack environment (paths, Node)')
  .action(() => doctorCommand());

/* ---- Evidence Pack: packs ingest | packs watch ---- */
const packs = program.command('packs').description('Evidence Pack ingest and watch');
packs
  .command('ingest <zip|folder>')
  .description('Ingest a pack (zip or folder); creates case under ops/bugs/cases/')
  .action((target: string) => packsIngestCommand(target));
packs
  .command('watch')
  .description('Watch EvidencePacks root for new .zip and ingest automatically')
  .action(() => packsWatchCommand());
packs
  .command('validate <zip>')
  .description('Validate a pack zip (no ingest); print report')
  .action((zip: string) => packsValidateCommand(zip));

/* ---- Evidence Pack: bugs ---- */
const bugs = program.command('bugs').description('Case management');
bugs.command('list').description('List case IDs').action(() => bugsListCommand());
bugs
  .command('open <caseId>')
  .description('Print agent_prompt.md for case (caseId or "latest")')
  .action((caseId: string) => bugsOpenCommand(caseId));
bugs
  .command('close <caseId>')
  .description('Move case to _closed; write status.json (--note optional)')
  .option('-n, --note <text>', 'Note to store in status.json')
  .action((caseId: string, opts: { note?: string }) => bugsCloseCommand(caseId, process.cwd(), opts));

/* ---- Factory: run | inspect | history ---- */
const factory = program.command('factory').description('AI Shipping Factory — deterministic build pipeline');
factory
  .command('run')
  .description('Start a Factory run from a spec YAML')
  .requiredOption('-s, --spec <path>', 'Path to spec YAML file')
  .action((opts: { spec: string }) => factoryRunCommand(opts).catch((e) => { console.error(e); process.exit(2); }));
factory
  .command('inspect <runId>')
  .description('Print run summary (status, gates, duration, artifacts)')
  .action((runId: string) => factoryInspectCommand(runId).catch((e) => { console.error(e); process.exit(2); }));
factory
  .command('history')
  .description('List all past Factory runs')
  .action(() => factoryHistoryCommand().catch((e) => { console.error(e); process.exit(2); }));

/* ---- Factory: consequences export | import | status ---- */
const consequences = factory.command('consequences').description('Consequence memory management');
consequences
  .command('export')
  .description('Export consequence memory to NDJSON file')
  .requiredOption('-o, --out <path>', 'Output file path')
  .action((opts: { out: string }) => consequencesExportCommand(opts).catch((e) => { console.error(e); process.exit(2); }));
consequences
  .command('import <file>')
  .description('Import consequence memory from NDJSON file')
  .action((file: string) => consequencesImportCommand(file).catch((e) => { console.error(e); process.exit(2); }));
consequences
  .command('status')
  .description('Show consequence memory status and integrity')
  .action(() => consequencesStatusCommand().catch((e) => { console.error(e); process.exit(2); }));

/* ---- Factory: manifest export ---- */
factory
  .command('manifest <runId>')
  .description('Export run manifest to a file')
  .option('-o, --out <path>', 'Output file path (default: manifests/RUN-<runId>.json)')
  .action((runId: string, opts: { out?: string }) => manifestExportCommand(runId, opts).catch((e) => { console.error(e); process.exit(2); }));

/* ---- Operator Control Plane ---- */
const operator = program.command('operator').description('Operator Control Plane — ingest runs, serve API');
operator
  .command('ingest')
  .description('Ingest a completed run directory into SQLite (requires run-manifest.json)')
  .argument('<runDir>', 'Path to .neoxten-out/<runId>')
  .option('--home <path>', 'Operator data directory (default: .neoxten-operator or NEOXTEN_OPERATOR_HOME)')
  .option('--archive', 'Copy artifacts into content-addressed blob store')
  .option('--project <slug>', 'Project slug hint for fingerprinting')
  .action((runDir: string, opts: { home?: string; archive?: boolean; project?: string }) =>
    operatorIngestCommand({ runDir, ...opts }).catch((e) => {
      console.error(e);
      process.exit(2);
    }),
  );
operator
  .command('serve')
  .description('Start Control API (Fastify); port from --port, env, or config with auto fallback')
  .option('-p, --port <n>', 'Port (optional; resolves free port near app.json preference)')
  .option('--host <addr>', 'Bind address', '127.0.0.1')
  .option('--home <path>', 'Operator data directory')
  .option('--no-lock', 'Skip service-lock.json and process signal handlers (debug)')
  .action((opts: { port?: string; host?: string; home?: string; noLock?: boolean }) =>
    operatorServeCommand(opts).catch((e) => {
      console.error(e);
      process.exit(2);
    }),
  );

const product = program.command('product').description('Local product runtime — paths, readiness, first-run');
product
  .command('paths')
  .description('Print canonical data/config/operator paths')
  .option('--json', 'Machine-readable output')
  .action((opts: { json?: boolean }) => productPathsCommand(opts));
product
  .command('readiness')
  .description('Check writable dirs, git, node, Playwright cache, registry paths; optional Control API probe')
  .option('--json', 'Machine-readable output')
  .option('--check-service', 'HTTP GET /api/health (needs running operator serve)')
  .option('--service-port <n>', 'Port for --check-service', '8787')
  .action((opts: { json?: boolean; checkService?: boolean; servicePort?: string }) =>
    productReadinessCommand(opts).catch((e) => {
      console.error(e);
      process.exit(2);
    }),
  );
product
  .command('readiness-sync')
  .description('Same as readiness without async service probe (for subprocess callers)')
  .option('--json', 'Machine-readable output')
  .action((opts: { json?: boolean }) => productReadinessSyncCommand(opts));
product
  .command('first-run-status')
  .description('Show first-run marker and app.json operator port prefs')
  .option('--json', 'Machine-readable output')
  .action((opts: { json?: boolean }) => productFirstRunStatusCommand(opts));
product
  .command('mark-first-run')
  .description('Mark guided first-run as complete')
  .option('--json', 'Machine-readable output')
  .option('--version <v>', 'Product version string to record')
  .action((opts: { json?: boolean; version?: string }) => productMarkFirstRunCommand(opts));

program.parse();

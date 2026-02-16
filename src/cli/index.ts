#!/usr/bin/env node

import { program } from 'commander';
import { runCommand } from './commands/run.js';
import { inspectCommand } from './commands/inspect.js';
import { gateCommand } from './commands/gate.js';

program
  .name('neoxten')
  .description('NeoXten Automation Framework — observe, act, prove.')
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

/* ---- gate (Nemyo Gate: one-command validation gate) ---- */
program
  .command('gate')
  .description('Run the full Nemyo validation gate (all configs + widget tests)')
  .option('-p, --preset <name>', 'Gate preset to run', 'nemyo')
  .option('-o, --out-dir <path>', 'Output directory for artifacts', '.neoxten-out')
  .action((opts) => gateCommand(opts).catch((e) => { console.error(e); process.exit(2); }));

program.parse();

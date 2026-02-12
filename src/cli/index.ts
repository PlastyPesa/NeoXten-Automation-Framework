#!/usr/bin/env node

import { program } from 'commander';
import { runCommand } from './commands/run.js';

program
  .name('neoxten')
  .description('NeoXten Automation Framework - run, test, measure, and loop until PASS')
  .version('1.0.0');

program
  .command('run')
  .description('Run automation and output JSON verdict')
  .option('-c, --config <path>', 'Path to neoxten.yaml', './neoxten.yaml')
  .option('-o, --out-dir <path>', 'Output directory for artifacts', '.neoxten-out')
  .option('--loop-until-pass', 'Exit 1 on FAIL so agent can fix and re-run')
  .option('--max-loops <n>', 'Max retry loops (default 1)', '1')
  .option('--retry', 'Retry once on failure to detect flakiness')
  .action((opts) => runCommand(opts).catch((e) => { console.error(e); process.exit(2); }));

program.parse();

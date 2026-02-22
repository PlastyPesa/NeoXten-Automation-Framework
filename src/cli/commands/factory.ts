/**
 * CLI: neoxten factory run | inspect | history | consequences | manifest
 *
 * run --spec <path>              Start a Factory run from a spec YAML file.
 * inspect <runId>                Print run summary (status, gates, duration, artifacts).
 * history                        List all past runs with status and timestamp.
 * consequences export            Export consequence memory to NDJSON.
 * consequences import <file>     Import consequence memory from NDJSON.
 * manifest export <runId>        Export run manifest to a file.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { validateSpec } from '../../factory/spec/validator.js';
import { EvidenceChain } from '../../factory/evidence-chain.js';
import { RunState } from '../../factory/run-state.js';
import { WorkerRegistry } from '../../factory/worker-registry.js';
import { GateRegistry } from '../../factory/gate-registry.js';
import { PipelineConfig } from '../../factory/pipeline-config.js';
import { MasterController } from '../../factory/master.js';
import { buildManifest, RunManifestSchema } from '../../factory/manifest.js';
import { ConsequenceMemory } from '../../factory/consequence-memory.js';

const RUNS_DIR = resolve('ops/factory/runs');
const CM_PATH = resolve('ops/factory/consequence-memory.ndjson');

export async function factoryRunCommand(opts: { spec: string }): Promise<void> {
  const specPath = resolve(opts.spec);
  if (!existsSync(specPath)) {
    console.error(`spec file not found: ${specPath}`);
    process.exit(1);
  }

  const raw = readFileSync(specPath, 'utf-8');
  const parsed = yaml.load(raw) as Record<string, unknown>;
  const result = validateSpec(parsed);
  if (!result.valid) {
    console.error('spec validation failed:');
    for (const err of result.errors!) {
      console.error(`  - ${err.message}`);
    }
    process.exit(1);
  }

  const runId = randomUUID();
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const workers = new WorkerRegistry();
  const gates = new GateRegistry();
  const pipeline = PipelineConfig.defaultFactory1();
  const master = new MasterController(workers, gates, pipeline);

  console.log(`factory run ${runId} starting...`);
  console.log(`spec: ${specPath}`);
  console.log(`output: ${runDir}`);

  const runResult = await master.run({ spec: result.spec!, persistDir: runDir });
  const runStatePath = join(runDir, 'run-state.json');
  const chainPath = join(runDir, 'evidence-chain.ndjson');

  const loadedState = RunState.load(runStatePath);
  const chain = EvidenceChain.fromNDJSON(readFileSync(chainPath, 'utf-8'));
  const manifest = buildManifest(loadedState, chain);
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('');
  console.log(`status:    ${runResult.status}`);
  console.log(`gates:     ${runResult.gatesPassed} passed`);
  console.log(`duration:  ${runResult.durationMs}ms`);
  console.log(`manifest:  ${join(runDir, 'manifest.json')}`);

  if (runResult.status === 'aborted') {
    console.log(`abort:     ${runResult.abortReason}`);
    process.exit(1);
  }
}

export async function factoryInspectCommand(runId: string): Promise<void> {
  const runDir = join(RUNS_DIR, runId);
  if (!existsSync(runDir)) {
    console.error(`run not found: ${runDir}`);
    process.exit(1);
  }

  const manifestPath = join(runDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found for run ${runId}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  console.log(`Run:       ${manifest.runId}`);
  console.log(`Status:    ${manifest.status}`);
  console.log(`Spec hash: ${manifest.specHash}`);
  console.log(`Started:   ${manifest.startedAt}`);
  console.log(`Completed: ${manifest.completedAt}`);
  console.log(`Duration:  ${manifest.durationMs}ms`);
  console.log('');
  console.log('Gates:');
  for (const g of manifest.gateVerdicts) {
    console.log(`  ${g.passed ? 'PASS' : 'FAIL'} ${g.gateId}`);
  }
  console.log('');
  console.log(`Artifacts: ${manifest.artifactHashes.length}`);
  for (const a of manifest.artifactHashes) {
    console.log(`  [${a.platform}] ${a.path} (${a.sizeBytes} bytes) sha256:${a.sha256.slice(0, 12)}...`);
  }
  console.log('');
  console.log(`LLM calls: ${manifest.llmUsage.totalCalls} (${manifest.llmUsage.totalPromptTokens} prompt, ${manifest.llmUsage.totalCompletionTokens} completion tokens)`);
  console.log(`Evidence:  ${manifest.evidenceChainLength} entries, hash: ${manifest.evidenceChainHash.slice(0, 12)}...`);
  console.log(`Manifest:  hash: ${manifest.manifestHash.slice(0, 12)}...`);
}

export async function factoryHistoryCommand(): Promise<void> {
  if (!existsSync(RUNS_DIR)) {
    console.log('No factory runs found.');
    return;
  }

  const entries = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const manifestPath = join(RUNS_DIR, d.name, 'manifest.json');
      const statePath = join(RUNS_DIR, d.name, 'run-state.json');
      if (existsSync(manifestPath)) {
        try {
          const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          return { runId: m.runId, status: m.status, startedAt: m.startedAt, durationMs: m.durationMs };
        } catch { /* corrupted manifest */ }
      }
      if (existsSync(statePath)) {
        try {
          const s = JSON.parse(readFileSync(statePath, 'utf-8'));
          return { runId: s.runId, status: s.status, startedAt: 'unknown', durationMs: 0 };
        } catch { /* corrupted state */ }
      }
      return { runId: d.name, status: 'unknown', startedAt: 'unknown', durationMs: 0 };
    })
    .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));

  if (entries.length === 0) {
    console.log('No factory runs found.');
    return;
  }

  console.log(`Factory runs (${entries.length}):`);
  console.log('');
  for (const e of entries) {
    const dur = e.durationMs > 0 ? `${e.durationMs}ms` : '-';
    console.log(`  ${e.status.padEnd(8)} ${e.runId}  ${e.startedAt}  ${dur}`);
  }
}

/* ---- Consequence Memory: export / import ---- */

export async function consequencesExportCommand(opts: { out: string; since?: string }): Promise<void> {
  const mem = ConsequenceMemory.load(CM_PATH);
  if (mem.length === 0) {
    console.log('Consequence memory is empty. Nothing to export.');
    return;
  }

  const outPath = resolve(opts.out);
  mem.exportRecords(outPath);
  console.log(`Exported ${mem.length} record(s) to ${outPath}`);

  const integrity = mem.verifyIntegrity();
  if (integrity.valid) {
    console.log('Integrity: all records valid');
  } else {
    console.warn(`WARNING: ${integrity.tamperedIds.length} tampered record(s) detected`);
  }
}

export async function consequencesImportCommand(file: string): Promise<void> {
  const importPath = resolve(file);
  if (!existsSync(importPath)) {
    console.error(`file not found: ${importPath}`);
    process.exit(1);
  }

  const mem = ConsequenceMemory.load(CM_PATH);
  const beforeCount = mem.length;

  try {
    const imported = mem.importRecords(importPath, 'run-auditor');
    console.log(`Imported ${imported} new record(s) (${beforeCount} existing, ${mem.length} total)`);
  } catch (e) {
    console.error(`Import failed: ${(e as Error).message}`);
    process.exit(1);
  }

  const integrity = mem.verifyIntegrity();
  if (integrity.valid) {
    console.log('Post-import integrity: all records valid');
  } else {
    console.error(`WARNING: ${integrity.tamperedIds.length} tampered record(s) after import`);
    process.exit(1);
  }
}

export async function consequencesStatusCommand(): Promise<void> {
  if (!existsSync(CM_PATH)) {
    console.log('No consequence memory file found.');
    return;
  }

  const mem = ConsequenceMemory.load(CM_PATH);
  const integrity = mem.verifyIntegrity();
  console.log(`Records: ${mem.length}`);
  console.log(`Integrity: ${integrity.valid ? 'VALID' : `TAMPERED (${integrity.tamperedIds.length} records)`}`);
  console.log(`File: ${CM_PATH}`);
}

/* ---- Manifest: export ---- */

export async function manifestExportCommand(runId: string, opts: { out?: string }): Promise<void> {
  const runDir = join(RUNS_DIR, runId);
  if (!existsSync(runDir)) {
    console.error(`run not found: ${runDir}`);
    process.exit(1);
  }

  const manifestPath = join(runDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found for run ${runId}`);
    process.exit(1);
  }

  const outPath = opts.out
    ? resolve(opts.out)
    : resolve(`manifests/RUN-${runId}.json`);

  const outDir = join(outPath, '..');
  mkdirSync(outDir, { recursive: true });
  copyFileSync(manifestPath, outPath);

  const manifest = JSON.parse(readFileSync(outPath, 'utf-8'));
  console.log(`Manifest exported: ${outPath}`);
  console.log(`  Run:     ${manifest.runId}`);
  console.log(`  Status:  ${manifest.status}`);
  console.log(`  Hash:    ${manifest.manifestHash.slice(0, 16)}...`);
}

/**
 * System Validation — Apple-Grade Readiness Proofs (Section 23)
 *
 * Simulates a complete Factory run with a non-trivial spec, then
 * independently verifies all 10 core criteria + 3 OPS criteria:
 *
 *  1.  Non-trivial spec (3+ features, 3+ journeys, quality, design)
 *  2.  Complete pipeline execution (shipped with full evidence)
 *  3.  Evidence Chain integrity (independent hash walk)
 *  4.  All 8 gates fired
 *  5.  Artifact hash verification
 *  6.  LLM call accounting (sums match manifest)
 *  7.  Consequence Memory populated
 *  8.  NeoXten regression (CLI structural)
 *  9.  Determinism proof (second run = same structure)
 * 10.  No silent failures (zero gaps, paired events)
 * 11.  CLI subcommands registered
 * 12.  Consequence memory export/import round-trip
 * 13.  Build scripts exist
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { EvidenceChain, computeEntryHash } from '../evidence-chain.js';
import type { RunStage, EvidenceEntry } from '../evidence-chain.js';
import { validateSpec } from '../spec/validator.js';
import { RunState } from '../run-state.js';
import type { Plan, BuildOutput, TestResult, UIInspectionResult, SecurityReport, ReleaseArtifact } from '../run-state.js';
import type { RunStateSlice, WorkerContract } from '../worker-contract.js';
import { WorkerRegistry } from '../worker-registry.js';
import { GateRegistry } from '../gate-registry.js';
import type { GateEvidence, GateResult } from '../gate-registry.js';
import { PipelineConfig } from '../pipeline-config.js';
import { MasterController } from '../master.js';
import { buildManifest } from '../manifest.js';
import { ConsequenceMemory } from '../consequence-memory.js';
import type { FactorySpec } from '../spec/schema.js';

const TEST_DIR = path.join(os.tmpdir(), 'sysval-' + Date.now());

function buildNonTrivialSpec(): Record<string, unknown> {
  return {
    schema_version: '2026.1',
    product: { name: 'SysVal App', version: '1.0.0', description: 'System validation app', platforms: ['web'] },
    features: [
      { id: 'auth', description: 'User authentication', acceptanceCriteria: ['Login works', 'Logout works'], priority: 'high' },
      { id: 'dashboard', description: 'User dashboard', acceptanceCriteria: ['Dashboard loads', 'Data renders'], priority: 'high' },
      { id: 'settings', description: 'User settings', acceptanceCriteria: ['Settings save', 'Theme switches'], priority: 'medium' },
    ],
    journeys: [
      { id: 'j-auth', name: 'Login flow', exercisesFeatures: ['auth'], steps: [{ action: 'assert', assertType: 'visible', selector: '#dashboard' }] },
      { id: 'j-dash', name: 'Dashboard flow', exercisesFeatures: ['dashboard'], steps: [{ action: 'assert', assertType: 'visible', selector: '#data' }] },
      { id: 'j-settings', name: 'Settings flow', exercisesFeatures: ['settings'], steps: [{ action: 'assert', assertType: 'visible', selector: '#saved' }] },
    ],
    quality: { startupMaxMs: 3000 },
    design: { fontFamily: 'Inter', minContrastRatio: 4.5, maxLayoutShiftScore: 0.1 },
    delivery: { targets: ['web'] },
  };
}

const PLAN: Plan = {
  workUnits: [
    { id: 'wu-1', featureIds: ['auth'], description: 'auth module', dependencies: [] },
    { id: 'wu-2', featureIds: ['dashboard'], description: 'dashboard module', dependencies: ['wu-1'] },
    { id: 'wu-3', featureIds: ['settings'], description: 'settings module', dependencies: [] },
  ],
  techStack: { framework: 'next.js' },
  fileStructure: ['src/index.ts', 'src/auth.ts', 'src/dashboard.ts'],
};

const BUILD_OUTPUT: BuildOutput = {
  projectDir: '/tmp/build', buildCommand: 'npm run build', exitCode: 0,
  outputFiles: ['dist/index.js', 'dist/app.js'],
};

const TEST_RESULT_FACTORY = (jId: string): TestResult => ({
  journeyId: jId, verdict: 'PASS', durationMs: 500, screenshotPaths: [`/tmp/${jId}.png`],
});

const UI_INSPECTION: UIInspectionResult = {
  layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true,
};

const SECURITY_REPORT: SecurityReport = {
  vulnerabilities: [], secretsFound: 0, overallPassed: true,
};

function makeWorkerStatusGate(gateId: string): (evidence: GateEvidence) => GateResult {
  return (ev) => {
    const passed = ev.workerStatus === 'done';
    return {
      gateId, passed, timestamp: new Date().toISOString(),
      checks: [{ name: 'worker_succeeded', passed, measured: passed ? 1 : 0, threshold: 1 }],
    };
  };
}

const GATE_IDS = [
  'spec_valid', 'plan_complete', 'build_success', 'tests_pass',
  'visual_qa', 'security_clear', 'artifact_ready', 'manifest_valid',
];

interface WorkerDef {
  id: string;
  accepts: RunStage;
  requires: RunStateSlice[];
  produces: RunStateSlice[];
  execute: WorkerContract['execute'];
}

function buildWorkerDefs(spec: FactorySpec): WorkerDef[] {
  return [
    {
      id: 'spec-validator', accepts: 'spec_validation', requires: ['spec'], produces: [],
      async execute(_t, _rs, chain) {
        chain.append({ type: 'note', workerId: 'spec-validator', stage: 'spec_validation', data: { valid: true } });
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
    {
      id: 'planner', accepts: 'planning', requires: ['spec'], produces: ['plan'],
      async execute(_t, rs, chain) {
        rs.setPlan(PLAN);
        chain.append({ type: 'llm_call', workerId: 'planner', stage: 'planning', data: { promptHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), model: 'qwen2.5-7b', promptTokens: 500, completionTokens: 300, durationMs: 1200, role: 'planner' } });
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
    {
      id: 'builder', accepts: 'building', requires: ['plan', 'workUnits'], produces: [],
      async execute(_t, rs, chain) {
        rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: ['src/auth.ts'] });
        rs.updateWorkUnit('wu-2', { status: 'done', outputFiles: ['src/dashboard.ts'] });
        rs.updateWorkUnit('wu-3', { status: 'done', outputFiles: ['src/settings.ts'] });
        chain.append({ type: 'llm_call', workerId: 'builder', stage: 'building', data: { promptHash: 'c'.repeat(64), responseHash: 'd'.repeat(64), model: 'qwen2.5-7b', promptTokens: 1000, completionTokens: 2000, durationMs: 5000, role: 'builder' } });
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
    {
      id: 'assembler', accepts: 'assembly', requires: ['plan', 'workUnits'], produces: ['buildOutput'],
      async execute(_t, rs, chain) {
        rs.setBuildOutput(BUILD_OUTPUT);
        chain.append({ type: 'note', workerId: 'assembler', stage: 'assembly', data: { assembled: true } });
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
    {
      id: 'tester', accepts: 'testing', requires: ['buildOutput'], produces: ['testResults'],
      async execute(_t, rs, chain) {
        for (const j of spec.journeys) { rs.addTestResult(TEST_RESULT_FACTORY(j.id)); }
        chain.append({ type: 'note', workerId: 'tester', stage: 'testing', data: { journeys: spec.journeys.length, allPassed: true } });
        return { status: 'done' as const, artifacts: spec.journeys.map(j => ({ name: `${j.id}.png`, path: `${j.id}.png`, sha256: createHash('sha256').update(j.id).digest('hex') })), evidence: [] };
      },
    },
    {
      id: 'ui-inspector', accepts: 'ui_inspection', requires: ['testResults'], produces: ['uiInspection'],
      async execute(_t, rs) {
        rs.setUIInspection(UI_INSPECTION);
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
    {
      id: 'security-auditor', accepts: 'security_audit', requires: ['buildOutput'], produces: ['securityReport'],
      async execute(_t, rs) {
        rs.setSecurityReport(SECURITY_REPORT);
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
    {
      id: 'release-packager', accepts: 'release_package', requires: ['securityReport', 'buildOutput'], produces: ['releaseArtifacts'],
      async execute(_t, rs, chain) {
        const content = Buffer.from('release-artifact-content');
        const sha = createHash('sha256').update(content).digest('hex');
        rs.addReleaseArtifact({ platform: 'web', path: 'dist/app.zip', sha256: sha, sizeBytes: content.length } as ReleaseArtifact);
        chain.append({ type: 'artifact_produced', workerId: 'release-packager', stage: 'release_package', data: { target: 'web', sha256: sha } });
        return { status: 'done' as const, artifacts: [{ name: 'dist/app.zip', path: 'dist/app.zip', sha256: sha }], evidence: [] };
      },
    },
    {
      id: 'run-auditor', accepts: 'run_audit', requires: ['releaseArtifacts'], produces: [],
      async execute(_t, _rs, chain) {
        chain.append({ type: 'note', workerId: 'run-auditor', stage: 'run_audit', data: { allGatesPresent: true, chainIntact: true } });
        return { status: 'done' as const, artifacts: [], evidence: [] };
      },
    },
  ];
}

async function runFactory(runDir: string, spec: FactorySpec): Promise<{
  runState: RunState; chain: EvidenceChain; manifest: ReturnType<typeof buildManifest>;
}> {
  const workers = new WorkerRegistry();
  const gates = new GateRegistry();
  const pipeline = PipelineConfig.defaultFactory1();

  for (const def of buildWorkerDefs(spec)) {
    workers.register({ id: def.id, accepts: def.accepts, requires: def.requires, produces: def.produces, timeout: 30_000, execute: def.execute });
  }
  for (const gateId of GATE_IDS) {
    gates.register(gateId, makeWorkerStatusGate(gateId));
  }

  const master = new MasterController(workers, gates, pipeline);
  await master.run({ spec, persistDir: runDir });

  const rsPath = path.join(runDir, 'run-state.json');
  const chainPath = path.join(runDir, 'evidence-chain.ndjson');
  const runState = RunState.load(rsPath);
  const chain = EvidenceChain.fromNDJSON(fs.readFileSync(chainPath, 'utf-8'));
  const manifest = buildManifest(runState, chain);
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  return { runState, chain, manifest };
}

async function runTests(): Promise<void> {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  function check(proofName: string, checks: Array<readonly [string, boolean]>): void {
    const fails = checks.filter(([, ok]) => !ok).map(([n]) => n);
    if (fails.length > 0) {
      console.error(`FAIL ${proofName}: ${fails.join(', ')}`);
      failed++;
    } else {
      console.log(`PASS ${proofName}`);
      passed++;
    }
  }

  const rawSpec = buildNonTrivialSpec();
  const specResult = validateSpec(rawSpec);

  /* ---- Criterion 1: Non-trivial spec ---- */
  check('criterion-1: non-trivial spec (3 features, 3 journeys, quality, design)', [
    ['spec valid', specResult.valid],
    ['3+ features', (rawSpec.features as unknown[]).length >= 3],
    ['3+ journeys', (rawSpec.journeys as unknown[]).length >= 3],
    ['has quality', 'quality' in rawSpec],
    ['has design', 'design' in rawSpec],
  ]);

  if (!specResult.valid) { console.error('Spec invalid — cannot continue.'); process.exit(1); }

  /* ---- Run the factory ---- */
  const runDir = path.join(TEST_DIR, 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  const { runState, chain, manifest } = await runFactory(runDir, specResult.spec);

  /* ---- Criterion 2: Complete pipeline execution ---- */
  check('criterion-2: complete pipeline execution (shipped)', [
    ['status is shipped', manifest.status === 'shipped'],
    ['has completedAt', !!manifest.completedAt],
    ['durationMs > 0', manifest.durationMs > 0],
    ['stages > 0', manifest.stages.length > 0],
  ]);

  /* ---- Criterion 3: Evidence Chain integrity (independent walk) ---- */
  {
    const ndjson = fs.readFileSync(path.join(runDir, 'evidence-chain.ndjson'), 'utf-8').trim();
    const lines = ndjson.split('\n');
    let intact = true;

    for (const line of lines) {
      const entry = JSON.parse(line) as EvidenceEntry;
      const { hash: actual, ...rest } = entry;
      const expected = computeEntryHash(rest);
      if (actual !== expected) { intact = false; break; }
    }

    check('criterion-3: evidence chain integrity (independent hash walk)', [
      ['chain intact', intact],
      ['chain length matches', lines.length === chain.length],
    ]);
  }

  /* ---- Criterion 4: All 8 gates fired ---- */
  {
    const gateEntries = chain.getTimeline().filter(e => e.type === 'gate_pass' || e.type === 'gate_fail');
    check('criterion-4: all 8 gates fired', [
      ['8 gate entries', gateEntries.length === 8],
      ['all pass for shipped', gateEntries.every(e => e.type === 'gate_pass')],
    ]);
  }

  /* ---- Criterion 5: Artifact hash verification ---- */
  {
    const hashes = manifest.artifactHashes;
    check('criterion-5: artifact hash verification', [
      ['has artifact hashes', hashes.length > 0],
      ['all 64-char hex', hashes.every(h => h.sha256.length === 64)],
    ]);
  }

  /* ---- Criterion 6: LLM call accounting ---- */
  {
    const llmEntries = chain.getTimeline().filter(e => e.type === 'llm_call');
    const totalPrompt = llmEntries.reduce((s, e) => s + ((e.data as Record<string, unknown>).promptTokens as number || 0), 0);
    const totalCompletion = llmEntries.reduce((s, e) => s + ((e.data as Record<string, unknown>).completionTokens as number || 0), 0);

    check('criterion-6: LLM call accounting', [
      ['llm entries exist', llmEntries.length > 0],
      ['all have promptHash', llmEntries.every(e => typeof (e.data as Record<string, unknown>).promptHash === 'string')],
      ['all have responseHash', llmEntries.every(e => typeof (e.data as Record<string, unknown>).responseHash === 'string')],
      ['all have model', llmEntries.every(e => typeof (e.data as Record<string, unknown>).model === 'string')],
      ['manifest prompt total matches', manifest.llmUsage.totalPromptTokens === totalPrompt],
      ['manifest completion total matches', manifest.llmUsage.totalCompletionTokens === totalCompletion],
    ]);
  }

  /* ---- Criterion 7: Consequence Memory (simulate write) ---- */
  {
    const cmPath = path.join(TEST_DIR, 'consequence-memory.ndjson');
    const mem = ConsequenceMemory.create(cmPath);
    mem.write({
      sourceRunId: manifest.runId, domain: 'shipping', stage: 'run_audit',
      specHash: manifest.specHash, pattern: { app: 'SysVal App' },
      failure: { description: 'test failure for validation' },
      resolution: { description: 'resolved by fix' },
      confidence: 0.9, occurrences: 1,
    }, 'run-auditor');

    check('criterion-7: consequence memory populated', [
      ['file exists', fs.existsSync(cmPath)],
      ['1 record', mem.length === 1],
      ['from this run', mem.query({ app: 'SysVal App' }).length === 1],
    ]);
  }

  /* ---- Criterion 8: NeoXten regression (structural) ---- */
  {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src/cli/index.ts'), 'utf-8');
    check('criterion-8: NeoXten regression (CLI structural)', [
      ['run command', cliSource.includes("command('run')")],
      ['inspect command', cliSource.includes("command('inspect')")],
      ['gate command', cliSource.includes("command('gate')")],
      ['doctor command', cliSource.includes("command('doctor')")],
      ['packs command', cliSource.includes("command('packs')")],
      ['bugs command', cliSource.includes("command('bugs')")],
    ]);
  }

  /* ---- Criterion 9: Determinism proof (second run) ---- */
  {
    const runDir2 = path.join(TEST_DIR, 'run-2');
    fs.mkdirSync(runDir2, { recursive: true });
    const result2 = await runFactory(runDir2, specResult.spec);

    const stages1 = manifest.stages.map(s => `${s.stageId}:${s.gatePassed ?? 'none'}`);
    const stages2 = result2.manifest.stages.map(s => `${s.stageId}:${s.gatePassed ?? 'none'}`);
    const gates1 = manifest.gateVerdicts.map(g => `${g.gateId}:${g.passed}`);
    const gates2 = result2.manifest.gateVerdicts.map(g => `${g.gateId}:${g.passed}`);

    check('criterion-9: determinism proof (second run = same structure)', [
      ['same status', manifest.status === result2.manifest.status],
      ['same stage structure', JSON.stringify(stages1) === JSON.stringify(stages2)],
      ['same gate outcomes', JSON.stringify(gates1) === JSON.stringify(gates2)],
      ['same evidence count', manifest.evidenceChainLength === result2.manifest.evidenceChainLength],
      ['different run IDs', manifest.runId !== result2.manifest.runId],
    ]);
  }

  /* ---- Criterion 10: No silent failures ---- */
  {
    const timeline = chain.getTimeline();
    const seqs = timeline.map(e => e.seq);
    const noGaps = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1);

    const workerStarts = timeline.filter(e => e.type === 'worker_start').map(e => `${e.stage}:${e.workerId}`);
    const workerEnds = timeline.filter(e => e.type === 'worker_end').map(e => `${e.stage}:${e.workerId}`);

    const stageStarts = timeline.filter(e => e.type === 'note' && (e.data as Record<string, unknown>).event === 'stage_start');
    const stageEnds = timeline.filter(e => e.type === 'note' && (e.data as Record<string, unknown>).event === 'stage_end');

    check('criterion-10: no silent failures', [
      ['zero seq gaps', noGaps],
      ['paired worker_start/end', JSON.stringify(workerStarts.sort()) === JSON.stringify(workerEnds.sort())],
      ['paired stage_start/end', stageStarts.length === stageEnds.length],
    ]);
  }

  /* ---- OPS 11: CLI subcommands ---- */
  {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src/cli/index.ts'), 'utf-8');
    check('ops-11: CLI subcommands registered', [
      ['factory command', cliSource.includes("command('factory')")],
      ['consequences command', cliSource.includes("command('consequences')")],
      ['manifest command', cliSource.includes("command('manifest")],
      ['consequences export', cliSource.includes("command('export')")],
      ['consequences import', cliSource.includes("command('import")],
      ['consequences status', cliSource.includes("command('status')")],
    ]);
  }

  /* ---- OPS 12: Consequence memory export/import ---- */
  {
    const srcPath = path.join(TEST_DIR, 'cm-src.ndjson');
    const exportPath = path.join(TEST_DIR, 'cm-export.ndjson');
    const dstPath = path.join(TEST_DIR, 'cm-dst.ndjson');

    const src = ConsequenceMemory.create(srcPath);
    src.write({
      sourceRunId: 'run-x', domain: 'shipping', stage: 'testing',
      specHash: 'f'.repeat(64), pattern: { tool: 'test' },
      failure: { description: 'test fail' }, resolution: { description: 'fix applied' },
      confidence: 0.8, occurrences: 1,
    }, 'run-auditor');
    src.exportRecords(exportPath);

    const dst = ConsequenceMemory.create(dstPath);
    const imported = dst.importRecords(exportPath, 'run-auditor');

    check('ops-12: consequence memory export/import round-trip', [
      ['exported', fs.existsSync(exportPath)],
      ['imported 1', imported === 1],
      ['dst has 1 record', dst.length === 1],
      ['integrity valid', dst.verifyIntegrity().valid],
    ]);
  }

  /* ---- OPS 13: Build scripts exist ---- */
  {
    const scriptsDir = path.join(process.cwd(), 'scripts');
    check('ops-13: build + ops scripts exist', [
      ['factory-build.ps1', fs.existsSync(path.join(scriptsDir, 'factory-build.ps1'))],
      ['factory-release.ps1', fs.existsSync(path.join(scriptsDir, 'factory-release.ps1'))],
      ['factory-setup.ps1', fs.existsSync(path.join(scriptsDir, 'factory-setup.ps1'))],
      ['create-wife-zip.ps1', fs.existsSync(path.join(scriptsDir, 'create-wife-zip.ps1'))],
    ]);
  }

  /* ---- Cleanup ---- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`System Validation: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

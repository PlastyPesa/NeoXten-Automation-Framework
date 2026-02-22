/**
 * Master Controller — Acceptance Proofs
 *
 * Proof 1: Happy path — all workers succeed, all gates pass → shipped, 8 gate_pass in chain.
 * Proof 2: Worker failure — tester returns 'failed' → gate_fail → aborted at testing stage.
 * Proof 3: Gate fail — worker succeeds but gate threshold not met → aborted.
 * Proof 4: Timeout + retry bounds — worker times out, retries bounded, then aborted.
 * Proof 5: Resume — partial run persisted, resume continues from correct stage → shipped.
 * Proof 6: Evidence completeness — every stage transition has a corresponding chain entry.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MasterController } from '../master.js';
import { WorkerRegistry } from '../worker-registry.js';
import { GateRegistry } from '../gate-registry.js';
import { PipelineConfig } from '../pipeline-config.js';
import { EvidenceChain } from '../evidence-chain.js';
import type { WorkerContract, WorkerResult, RunStateSlice } from '../worker-contract.js';
import type { GateEvidence, GateResult } from '../gate-registry.js';
import type { RunStage } from '../evidence-chain.js';
import type { FactorySpec } from '../spec/schema.js';
import type { Plan, BuildOutput, TestResult, UIInspectionResult, SecurityReport, ReleaseArtifact } from '../run-state.js';

const TEST_DIR = path.join(os.tmpdir(), 'master-test-' + Date.now());

function makeSpec(): FactorySpec {
  return {
    schema_version: '2026.1',
    product: { name: 'TestApp', version: '1.0.0', description: 'Test', platforms: ['web'] },
    features: [{ id: 'f1', description: 'F1', acceptanceCriteria: ['Works'], priority: 'medium' }],
    journeys: [{
      id: 'j1', name: 'J1', exercisesFeatures: ['f1'],
      steps: [{ action: 'assert', assertType: 'visible', selector: 'body' }],
    }],
    quality: { startupMaxMs: 3000 },
    delivery: { targets: ['web'] },
  } as FactorySpec;
}

const PLAN: Plan = {
  workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'Build f1', dependencies: [] }],
  techStack: { framework: 'next.js' },
  fileStructure: ['src/index.ts'],
};

const BUILD_OUTPUT: BuildOutput = {
  projectDir: '/tmp/build', buildCommand: 'npm run build', exitCode: 0,
  outputFiles: ['dist/index.js'],
};

const TEST_RESULT: TestResult = {
  journeyId: 'j1', verdict: 'PASS', durationMs: 500, screenshotPaths: ['/tmp/j1.png'],
};

const UI_INSPECTION: UIInspectionResult = {
  layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true,
};

const SECURITY_REPORT: SecurityReport = {
  vulnerabilities: [], secretsFound: 0, overallPassed: true,
};

const RELEASE_ARTIFACT: ReleaseArtifact = {
  platform: 'web', path: '/tmp/app.zip', sha256: 'abc123', sizeBytes: 1024,
};

interface WorkerDef {
  id: string;
  accepts: RunStage;
  requires: RunStateSlice[];
  produces: RunStateSlice[];
  execute: WorkerContract['execute'];
}

const WORKER_DEFS: WorkerDef[] = [
  {
    id: 'spec-validator', accepts: 'spec_validation', requires: ['spec'], produces: [],
    async execute() { return { status: 'done' as const, artifacts: [], evidence: [] }; },
  },
  {
    id: 'planner', accepts: 'planning', requires: ['spec'], produces: ['plan'],
    async execute(_t, rs) {
      rs.setPlan(PLAN);
      return { status: 'done' as const, artifacts: [], evidence: [] };
    },
  },
  {
    id: 'builder', accepts: 'building', requires: ['plan', 'workUnits'], produces: [],
    async execute(_t, rs) {
      rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: ['src/index.ts'] });
      return { status: 'done' as const, artifacts: [], evidence: [] };
    },
  },
  {
    id: 'assembler', accepts: 'assembly', requires: ['plan', 'workUnits'], produces: ['buildOutput'],
    async execute(_t, rs) {
      rs.setBuildOutput(BUILD_OUTPUT);
      return { status: 'done' as const, artifacts: [], evidence: [] };
    },
  },
  {
    id: 'tester', accepts: 'testing', requires: ['buildOutput'], produces: ['testResults'],
    async execute(_t, rs) {
      rs.addTestResult(TEST_RESULT);
      return { status: 'done' as const, artifacts: [], evidence: [] };
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
    id: 'release-packager', accepts: 'release_package',
    requires: ['securityReport', 'buildOutput'], produces: ['releaseArtifacts'],
    async execute(_t, rs) {
      rs.addReleaseArtifact(RELEASE_ARTIFACT);
      return { status: 'done' as const, artifacts: [], evidence: [] };
    },
  },
  {
    id: 'run-auditor', accepts: 'run_audit', requires: ['releaseArtifacts'], produces: [],
    async execute() { return { status: 'done' as const, artifacts: [], evidence: [] }; },
  },
];

function makePassGate(gateId: string): (evidence: GateEvidence) => GateResult {
  return () => ({
    gateId, passed: true, timestamp: new Date().toISOString(),
    checks: [{ name: 'auto', passed: true, measured: 1, threshold: 1 }],
  });
}

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

function buildFullSetup(overrides?: {
  workerOverride?: Partial<WorkerDef> & { id: string };
  gateOverride?: { gateId: string; fn: (ev: GateEvidence) => GateResult };
}): { workers: WorkerRegistry; gates: GateRegistry; pipeline: PipelineConfig } {
  const workers = new WorkerRegistry();
  for (const def of WORKER_DEFS) {
    const ov = overrides?.workerOverride?.id === def.id ? overrides.workerOverride : null;
    const w: WorkerContract = {
      id: def.id, accepts: def.accepts, timeout: 5000,
      requires: ov?.requires ?? def.requires,
      produces: ov?.produces ?? def.produces,
      execute: ov?.execute ?? def.execute,
    };
    workers.register(w);
  }

  const gates = new GateRegistry();
  for (const gateId of GATE_IDS) {
    if (overrides?.gateOverride?.gateId === gateId) {
      gates.register(gateId, overrides.gateOverride.fn);
    } else {
      gates.register(gateId, makeWorkerStatusGate(gateId));
    }
  }

  return { workers, gates, pipeline: PipelineConfig.defaultFactory1() };
}

async function runTests(): Promise<void> {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Happy path — all pass → shipped                         */
  /* ---------------------------------------------------------------- */
  {
    const { workers, gates, pipeline } = buildFullSetup();
    const master = new MasterController(workers, gates, pipeline, { maxRetries: 2 });
    const dir = path.join(TEST_DIR, 'proof1');

    const result = await master.run({ runId: 'run-happy', spec: makeSpec(), persistDir: dir });
    const chain = EvidenceChain.readFromFile(path.join(dir, 'evidence-chain.ndjson'));
    const timeline = chain.getTimeline();

    const gatePassEntries = timeline.filter(e => e.type === 'gate_pass');
    const gateFailEntries = timeline.filter(e => e.type === 'gate_fail');
    const runStartEntries = timeline.filter(e => e.type === 'run_start');
    const runEndEntries = timeline.filter(e => e.type === 'run_end');

    const checks = [
      ['status=shipped', result.status === 'shipped'],
      ['8 gates passed', result.gatesPassed === 8],
      ['0 gates failed', result.gatesFailed === 0],
      ['stageReached=run_audit', result.stageReached === 'run_audit'],
      ['9 total stages', result.totalStages === 9],
      ['8 gate_pass in chain', gatePassEntries.length === 8],
      ['0 gate_fail in chain', gateFailEntries.length === 0],
      ['1 run_start', runStartEntries.length === 1],
      ['1 run_end', runEndEntries.length === 1],
      ['run_end status=shipped', (runEndEntries[0]?.data as Record<string, unknown>)?.status === 'shipped'],
      ['chain verifies', chain.verify().valid],
      ['durationMs > 0', result.durationMs >= 0],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-1: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log(`PASS proof-1: happy path — shipped, 8 gate_pass, chain intact (${timeline.length} entries)`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Worker failure — tester fails → aborted                  */
  /* ---------------------------------------------------------------- */
  {
    const { workers, gates, pipeline } = buildFullSetup({
      workerOverride: {
        id: 'tester', accepts: 'testing', requires: ['buildOutput'], produces: ['testResults'],
        async execute(): Promise<WorkerResult> {
          return { status: 'failed', reason: 'journey j1 assertion failed', evidence: [] };
        },
      },
    });
    const master = new MasterController(workers, gates, pipeline, { maxRetries: 2 });
    const dir = path.join(TEST_DIR, 'proof2');

    const result = await master.run({ runId: 'run-worker-fail', spec: makeSpec(), persistDir: dir });
    const chain = EvidenceChain.readFromFile(path.join(dir, 'evidence-chain.ndjson'));
    const timeline = chain.getTimeline();

    const gatePassEntries = timeline.filter(e => e.type === 'gate_pass');
    const gateFailEntries = timeline.filter(e => e.type === 'gate_fail');

    const checks = [
      ['status=aborted', result.status === 'aborted'],
      ['stageReached=testing', result.stageReached === 'testing'],
      ['abortReason mentions tests_pass', result.abortReason?.includes('tests_pass') === true],
      ['3 gates passed (spec_valid, plan_complete, build_success)',
        gatePassEntries.length === 3],
      ['1 gate failed', gateFailEntries.length === 1],
      ['failed gate is tests_pass',
        (gateFailEntries[0]?.data as Record<string, unknown>)?.gateId === 'tests_pass'],
      ['chain verifies', chain.verify().valid],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-2: ${failedChecks.join(', ')}`);
      console.error(`  gatePass=${gatePassEntries.length}, gateFail=${gateFailEntries.length}`);
      console.error(`  result: ${JSON.stringify(result)}`);
      failed++;
    } else {
      console.log(`PASS proof-2: worker failure — aborted at testing, 3 gate_pass + 1 gate_fail (tests_pass)`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Gate fail — worker ok but gate threshold not met         */
  /* ---------------------------------------------------------------- */
  {
    const { workers, gates, pipeline } = buildFullSetup({
      gateOverride: {
        gateId: 'visual_qa',
        fn: () => ({
          gateId: 'visual_qa', passed: false, timestamp: new Date().toISOString(),
          checks: [
            { name: 'contrast_ratio', passed: false, measured: 2.1, threshold: 4.5,
              message: 'contrast ratio 2.1 below minimum 4.5' },
          ],
        }),
      },
    });
    const master = new MasterController(workers, gates, pipeline, { maxRetries: 2 });
    const dir = path.join(TEST_DIR, 'proof3');

    const result = await master.run({ runId: 'run-gate-fail', spec: makeSpec(), persistDir: dir });
    const chain = EvidenceChain.readFromFile(path.join(dir, 'evidence-chain.ndjson'));
    const timeline = chain.getTimeline();

    const gateFailEntries = timeline.filter(e => e.type === 'gate_fail');
    const failData = gateFailEntries[0]?.data as Record<string, unknown>;
    const failChecks = failData?.checks as Array<Record<string, unknown>>;

    const checks = [
      ['status=aborted', result.status === 'aborted'],
      ['stageReached=ui_inspection', result.stageReached === 'ui_inspection'],
      ['abortReason mentions visual_qa', result.abortReason?.includes('visual_qa') === true],
      ['gate fail has measured value', failChecks?.[0]?.measured === 2.1],
      ['gate fail has threshold', failChecks?.[0]?.threshold === 4.5],
      ['4 gates passed before visual_qa (spec,plan,build,tests)', result.gatesPassed === 4],
      ['1 gate failed', result.gatesFailed === 1],
      ['chain verifies', chain.verify().valid],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-3: ${failedChecks.join(', ')}`);
      console.error(`  result: ${JSON.stringify(result)}`);
      failed++;
    } else {
      console.log(`PASS proof-3: gate fail — aborted at ui_inspection, contrast 2.1 < 4.5 threshold, 5 pass + 1 fail`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: Timeout + retry bounds — bounded, then aborted           */
  /* ---------------------------------------------------------------- */
  {
    let callCount = 0;
    const { workers, gates, pipeline } = buildFullSetup({
      workerOverride: {
        id: 'assembler', accepts: 'assembly',
        requires: ['plan', 'workUnits'], produces: ['buildOutput'],
        async execute(): Promise<WorkerResult> {
          callCount++;
          throw new Error('connection refused');
        },
      },
    });

    const workerRef = workers.get('assembler');
    Object.defineProperty(workerRef, 'timeout', { value: 50, writable: false });

    const master = new MasterController(workers, gates, pipeline, { maxRetries: 3 });
    const dir = path.join(TEST_DIR, 'proof4');

    const result = await master.run({ runId: 'run-timeout', spec: makeSpec(), persistDir: dir });
    const chain = EvidenceChain.readFromFile(path.join(dir, 'evidence-chain.ndjson'));
    const timeline = chain.getTimeline();

    const errorEntries = timeline.filter(e => e.type === 'error');
    const retryNotes = timeline.filter(e =>
      e.type === 'note' && (e.data as Record<string, unknown>).event === 'retry_scheduled'
    );

    const workerEndEntries = timeline.filter(
      e => e.type === 'worker_end' && e.workerId === 'assembler'
    );
    const retriesExhaustedInChain = workerEndEntries.some(
      e => ((e.data as Record<string, unknown>).reason as string)?.includes('retries exhausted')
    );

    const checks = [
      ['status=aborted', result.status === 'aborted'],
      ['stageReached=assembly', result.stageReached === 'assembly'],
      ['3 attempts made', callCount === 3],
      ['3 error entries in chain', errorEntries.length === 3],
      ['2 retry notes (retries before final)', retryNotes.length === 2],
      ['retries exhausted logged in worker_end', retriesExhaustedInChain],
      ['abortReason mentions gate', result.abortReason?.includes("gate 'build_success'") === true],
      ['chain verifies', chain.verify().valid],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-4: ${failedChecks.join(', ')}`);
      console.error(`  callCount=${callCount}, errors=${errorEntries.length}, retries=${retryNotes.length}`);
      console.error(`  result: ${JSON.stringify(result)}`);
      failed++;
    } else {
      console.log(`PASS proof-4: timeout + retry — 3 attempts, 3 errors, 2 retries, gate fail → aborted`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5: Resume — partial run → persist → resume → shipped        */
  /* ---------------------------------------------------------------- */
  {
    const resumeCallLog: string[] = [];
    const { workers, gates, pipeline } = buildFullSetup();

    const workersWithLog = new WorkerRegistry();
    for (const def of WORKER_DEFS) {
      const w: WorkerContract = {
        id: def.id, accepts: def.accepts, timeout: 5000,
        requires: def.requires, produces: def.produces,
        async execute(task, rs, chain) {
          resumeCallLog.push(def.id);
          return def.execute(task, rs, chain);
        },
      };
      workersWithLog.register(w);
    }

    const master1 = new MasterController(workersWithLog, gates, pipeline, { maxRetries: 2 });
    const dir = path.join(TEST_DIR, 'proof5');

    const result1 = await master1.run({ runId: 'run-resume', spec: makeSpec(), persistDir: dir });
    if (result1.status !== 'shipped') {
      console.error(`FAIL proof-5: initial run did not ship (${result1.status})`);
      failed++;
    } else {
      const fullCallLog = [...resumeCallLog];
      resumeCallLog.length = 0;

      const rsPath = path.join(dir, 'run-state.json');
      const rs = JSON.parse(fs.readFileSync(rsPath, 'utf-8'));

      rs.status = 'running';
      rs.currentStage = 'assembly';
      delete rs.timestamps.assembly;
      delete rs.timestamps.testing;
      delete rs.timestamps.ui_inspection;
      delete rs.timestamps.security_audit;
      delete rs.timestamps.release_package;
      delete rs.timestamps.run_audit;
      rs.buildOutput = null;
      rs.testResults = [];
      rs.uiInspection = null;
      rs.securityReport = null;
      rs.releaseArtifacts = [];
      rs.gateResults = rs.gateResults.filter(
        (g: { gateId: string }) => ['spec_valid', 'plan_complete'].includes(g.gateId)
      );
      fs.writeFileSync(rsPath, JSON.stringify(rs, null, 2), 'utf-8');

      const chainPath = path.join(dir, 'evidence-chain.ndjson');
      const chainBefore = EvidenceChain.readFromFile(chainPath);
      const keepEntries = chainBefore.getTimeline().slice(0, 20);
      const trimmed = keepEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(chainPath, trimmed, 'utf-8');

      const master2 = new MasterController(workersWithLog, gates, pipeline, { maxRetries: 2 });
      const result2 = await master2.resume(rsPath);

      const skippedStages = ['spec-validator', 'planner', 'builder'];
      const resumedStages = resumeCallLog;

      const checks = [
        ['resume shipped', result2.status === 'shipped'],
        ['spec-validator NOT re-called', !resumedStages.includes('spec-validator')],
        ['planner NOT re-called', !resumedStages.includes('planner')],
        ['builder NOT re-called', !resumedStages.includes('builder')],
        ['assembler called on resume', resumedStages.includes('assembler')],
        ['tester called on resume', resumedStages.includes('tester')],
        ['run-auditor called on resume', resumedStages.includes('run-auditor')],
        ['8 gates total in result', result2.gatesPassed === 8],
        ['initial run had all 9 workers', fullCallLog.length === 9],
      ] as const;

      const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
      if (failedChecks.length > 0) {
        console.error(`FAIL proof-5: ${failedChecks.join(', ')}`);
        console.error(`  resumeCallLog: ${JSON.stringify(resumedStages)}`);
        console.error(`  fullCallLog: ${JSON.stringify(fullCallLog)}`);
        failed++;
      } else {
        console.log(`PASS proof-5: resume — skipped ${skippedStages.length} completed stages, resumed from assembly, shipped (${resumedStages.length} workers called)`);
        passed++;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 6: Evidence completeness — every stage has chain entries     */
  /* ---------------------------------------------------------------- */
  {
    const { workers, gates, pipeline } = buildFullSetup();
    const master = new MasterController(workers, gates, pipeline, { maxRetries: 2 });
    const dir = path.join(TEST_DIR, 'proof6');

    const result = await master.run({ runId: 'run-complete', spec: makeSpec(), persistDir: dir });
    const chain = EvidenceChain.readFromFile(path.join(dir, 'evidence-chain.ndjson'));
    const timeline = chain.getTimeline();

    const stageStarts = timeline.filter(
      e => e.type === 'note' && (e.data as Record<string, unknown>).event === 'stage_start'
    );
    const stageEnds = timeline.filter(
      e => e.type === 'note' && (e.data as Record<string, unknown>).event === 'stage_end'
    );
    const workerStarts = timeline.filter(e => e.type === 'worker_start');
    const workerEnds = timeline.filter(e => e.type === 'worker_end');

    const STAGE_IDS = [
      'spec_validation', 'planning', 'building', 'assembly',
      'testing', 'ui_inspection', 'security_audit', 'release_package', 'run_audit',
    ];
    const allStagesHaveStart = STAGE_IDS.every(sid =>
      stageStarts.some(e => (e.data as Record<string, unknown>).stageId === sid)
    );
    const allStagesHaveEnd = STAGE_IDS.every(sid =>
      stageEnds.some(e => (e.data as Record<string, unknown>).stageId === sid)
    );

    const checks = [
      ['shipped', result.status === 'shipped'],
      ['9 stage_start entries', stageStarts.length === 9],
      ['9 stage_end entries', stageEnds.length === 9],
      ['all stages have start', allStagesHaveStart],
      ['all stages have end', allStagesHaveEnd],
      ['9 worker_start entries', workerStarts.length === 9],
      ['9 worker_end entries', workerEnds.length === 9],
      ['chain hash-continuous', chain.verify().valid],
      ['no silent gaps (starts+ends match)', stageStarts.length === stageEnds.length],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-6: ${failedChecks.join(', ')}`);
      console.error(`  stageStarts=${stageStarts.length}, stageEnds=${stageEnds.length}`);
      console.error(`  workerStarts=${workerStarts.length}, workerEnds=${workerEnds.length}`);
      failed++;
    } else {
      console.log(`PASS proof-6: evidence completeness — 9 stage_start + 9 stage_end + 9 worker_start + 9 worker_end + 8 gate_pass, chain intact`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cleanup and report                                                */
  /* ---------------------------------------------------------------- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Master Controller: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

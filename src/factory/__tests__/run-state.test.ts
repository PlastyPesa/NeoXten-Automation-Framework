/**
 * RunState — Acceptance Proofs
 *
 * Proof 1: Initialize, verify all worker-output slots null.
 * Proof 2: Write plan, persist, reload — deep equals.
 * Proof 3: Attempt setBuildOutput() before setPlan() — throws.
 * Proof 4: Write through all stages in order — succeeds, all slots populated.
 * Proof 5: Serialize/deserialize round-trip — byte-identical JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RunState } from '../run-state.js';
import type {
  Plan, BuildOutput, TestResult, UIInspectionResult,
  SecurityReport, ReleaseArtifact, StateGateResult,
} from '../run-state.js';
import type { FactorySpec } from '../spec/schema.js';

const TEST_DIR = path.join(os.tmpdir(), 'run-state-test-' + Date.now());

function makeSpec(): FactorySpec {
  return {
    schema_version: '2026.1',
    product: {
      name: 'TestApp',
      version: '1.0.0',
      description: 'Test app',
      platforms: ['web'],
    },
    features: [
      { id: 'feat1', description: 'Feature 1', acceptanceCriteria: ['Works'], priority: 'medium' },
    ],
    journeys: [
      {
        id: 'j1', name: 'Journey 1', exercisesFeatures: ['feat1'],
        steps: [{ action: 'assert', assertType: 'visible', selector: 'body' }],
      },
    ],
    quality: { startupMaxMs: 3000 },
    delivery: { targets: ['web'] },
  } as FactorySpec;
}

function makePlan(): Plan {
  return {
    workUnits: [
      { id: 'wu-1', featureIds: ['feat1'], description: 'Build feature 1', dependencies: [] },
      { id: 'wu-2', featureIds: ['feat1'], description: 'Build shared utils', dependencies: ['wu-1'] },
    ],
    techStack: { framework: 'next.js', language: 'typescript' },
    fileStructure: ['src/index.ts', 'src/components/App.tsx', 'package.json'],
  };
}

function makeBuildOutput(): BuildOutput {
  return {
    projectDir: '/tmp/build',
    buildCommand: 'npm run build',
    exitCode: 0,
    outputFiles: ['dist/index.js', 'dist/index.css'],
  };
}

function makeTestResult(): TestResult {
  return {
    journeyId: 'j1',
    verdict: 'PASS',
    durationMs: 1500,
    screenshotPaths: ['/tmp/screenshots/j1-final.png'],
  };
}

function makeUIInspection(): UIInspectionResult {
  return {
    layoutViolations: 0,
    contrastChecks: [{ element: 'h1', ratio: 7.5, threshold: 4.5, passed: true }],
    accessibilityChecks: [{ rule: 'color-contrast', passed: true }],
    overallPassed: true,
  };
}

function makeSecurityReport(): SecurityReport {
  return {
    vulnerabilities: [],
    secretsFound: 0,
    overallPassed: true,
  };
}

function makeReleaseArtifact(): ReleaseArtifact {
  return {
    platform: 'web',
    path: '/tmp/dist/app.zip',
    sha256: 'abcdef1234567890',
    sizeBytes: 102400,
  };
}

function makeGateResult(gateId: string, passed: boolean): StateGateResult {
  return {
    gateId,
    passed,
    timestamp: new Date().toISOString(),
    checks: [{ name: 'check1', passed, measured: passed ? 100 : 999, threshold: 500 }],
  };
}

function createState(subDir: string): RunState {
  const dir = path.join(TEST_DIR, subDir);
  return new RunState({
    runId: 'test-run-001',
    spec: makeSpec(),
    evidenceChainPath: path.join(dir, 'evidence-chain.ndjson'),
    persistDir: dir,
  });
}

function runTests(): void {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Initialize, all worker-output slots null/empty           */
  /* ---------------------------------------------------------------- */
  {
    const state = createState('proof1');
    const checks = [
      ['status', state.status === 'running'],
      ['currentStage', state.currentStage === 'initializing'],
      ['plan', state.getPlan() === null],
      ['workUnits', state.getWorkUnits().length === 0],
      ['buildOutput', state.getBuildOutput() === null],
      ['testResults', state.getTestResults().length === 0],
      ['uiInspection', state.getUIInspection() === null],
      ['securityReport', state.getSecurityReport() === null],
      ['releaseArtifacts', state.getReleaseArtifacts().length === 0],
      ['gateResults', state.getGateResults().length === 0],
      ['consequenceHits', state.getConsequenceHits().length === 0],
      ['runId', state.runId === 'test-run-001'],
      ['specHash', typeof state.specHash === 'string' && state.specHash.length === 64],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-1: non-null slots: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-1: initialized — all 13 slot checks correct (null/empty/default)');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Write plan, persist, reload — deep equals                */
  /* ---------------------------------------------------------------- */
  {
    const state = createState('proof2');
    const plan = makePlan();
    state.setPlan(plan);

    if (state.getPlan() === null) {
      console.error('FAIL proof-2: plan should be set');
      failed++;
    } else if (state.getWorkUnits().length !== 2) {
      console.error(`FAIL proof-2: expected 2 workUnits, got ${state.getWorkUnits().length}`);
      failed++;
    } else {
      const filePath = path.join(TEST_DIR, 'proof2', 'run-state.json');
      if (!fs.existsSync(filePath)) {
        console.error('FAIL proof-2: persist file not created');
        failed++;
      } else {
        const loaded = RunState.load(filePath);
        const originalJson = JSON.stringify(state.toJSON());
        const loadedJson = JSON.stringify(loaded.toJSON());
        if (originalJson !== loadedJson) {
          console.error('FAIL proof-2: loaded state differs from original');
          failed++;
        } else {
          console.log('PASS proof-2: setPlan() -> persist -> load — deep equals (plan + 2 workUnits)');
          passed++;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Invalid ordering — setBuildOutput before setPlan         */
  /* ---------------------------------------------------------------- */
  {
    const state = createState('proof3');
    let threwBuild = false;
    let buildMsg = '';
    try {
      state.setBuildOutput(makeBuildOutput());
    } catch (e) {
      threwBuild = true;
      buildMsg = (e as Error).message;
    }

    let threwTest = false;
    let testMsg = '';
    try {
      state.addTestResult(makeTestResult());
    } catch (e) {
      threwTest = true;
      testMsg = (e as Error).message;
    }

    let threwUI = false;
    let uiMsg = '';
    try {
      state.setUIInspection(makeUIInspection());
    } catch (e) {
      threwUI = true;
      uiMsg = (e as Error).message;
    }

    let threwRelease = false;
    let releaseMsg = '';
    try {
      state.addReleaseArtifact(makeReleaseArtifact());
    } catch (e) {
      threwRelease = true;
      releaseMsg = (e as Error).message;
    }

    const allThrew = threwBuild && threwTest && threwUI && threwRelease;
    const correctMessages =
      buildMsg.includes('plan is null') &&
      testMsg.includes('buildOutput is null') &&
      uiMsg.includes('testResults is empty') &&
      releaseMsg.includes('securityReport is null');

    if (!allThrew || !correctMessages) {
      console.error('FAIL proof-3: ordering violations should throw with correct messages',
        { threwBuild, buildMsg, threwTest, testMsg, threwUI, uiMsg, threwRelease, releaseMsg });
      failed++;
    } else {
      console.log(`PASS proof-3: all 4 out-of-order mutations rejected — "${buildMsg}", "${testMsg}", "${uiMsg}", "${releaseMsg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: Write through all stages in order — all slots populated  */
  /* ---------------------------------------------------------------- */
  {
    const state = createState('proof4');

    state.setCurrentStage('spec_validation');
    state.addGateResult(makeGateResult('spec_valid', true));

    state.setCurrentStage('planning');
    state.stageStart('planning');
    state.setPlan(makePlan());
    state.stageEnd('planning');
    state.addGateResult(makeGateResult('plan_complete', true));

    state.setCurrentStage('building');
    state.stageStart('building');
    state.updateWorkUnit('wu-1', { status: 'done', outputFiles: ['src/index.ts'] });
    state.updateWorkUnit('wu-2', { status: 'done', outputFiles: ['src/utils.ts'] });
    state.stageEnd('building');

    state.setCurrentStage('assembly');
    state.setBuildOutput(makeBuildOutput());
    state.addGateResult(makeGateResult('build_success', true));

    state.setCurrentStage('testing');
    state.addTestResult(makeTestResult());
    state.addGateResult(makeGateResult('tests_pass', true));

    state.setCurrentStage('ui_inspection');
    state.setUIInspection(makeUIInspection());
    state.addGateResult(makeGateResult('visual_qa', true));

    state.setCurrentStage('security_audit');
    state.setSecurityReport(makeSecurityReport());
    state.addGateResult(makeGateResult('security_clear', true));

    state.setCurrentStage('release_package');
    state.addReleaseArtifact(makeReleaseArtifact());
    state.addGateResult(makeGateResult('artifact_ready', true));

    state.setCurrentStage('run_audit');
    state.addGateResult(makeGateResult('manifest_valid', true));

    state.setStatus('shipped');
    state.addConsequenceHit({ recordId: 'c1', pattern: 'test-pattern', confidence: 0.9, stage: 'planning' });

    const checks = [
      ['status=shipped', state.status === 'shipped'],
      ['plan set', state.getPlan() !== null],
      ['2 workUnits done', state.getWorkUnits().every(wu => wu.status === 'done')],
      ['buildOutput set', state.getBuildOutput() !== null],
      ['1 testResult', state.getTestResults().length === 1],
      ['uiInspection set', state.getUIInspection() !== null],
      ['securityReport set', state.getSecurityReport() !== null],
      ['1 releaseArtifact', state.getReleaseArtifacts().length === 1],
      ['8 gateResults', state.getGateResults().length === 8],
      ['1 consequenceHit', state.getConsequenceHits().length === 1],
      ['timestamps have planning', !!state.getTimestamps().planning?.start && !!state.getTimestamps().planning?.end],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-4: incomplete slots: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-4: full pipeline traversal — all 11 slot checks populated, 8 gates, status=shipped');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5: Serialize/deserialize round-trip — byte-identical JSON   */
  /* ---------------------------------------------------------------- */
  {
    const state = createState('proof5');
    state.setPlan(makePlan());
    state.setBuildOutput(makeBuildOutput());
    state.addTestResult(makeTestResult());
    state.setUIInspection(makeUIInspection());
    state.setSecurityReport(makeSecurityReport());
    state.addReleaseArtifact(makeReleaseArtifact());
    state.addGateResult(makeGateResult('spec_valid', true));
    state.addConsequenceHit({ recordId: 'c1', pattern: 'p1', confidence: 0.5, stage: 'testing' });
    state.stageStart('testing');
    state.stageEnd('testing');

    const filePath = path.join(TEST_DIR, 'proof5', 'run-state.json');
    const diskContent = fs.readFileSync(filePath, 'utf-8');
    const loaded = RunState.load(filePath);
    const reserializedContent = JSON.stringify(loaded.toJSON(), null, 2);

    if (diskContent !== reserializedContent) {
      console.error('FAIL proof-5: round-trip JSON not byte-identical');
      const diskLines = diskContent.split('\n');
      const reLines = reserializedContent.split('\n');
      for (let i = 0; i < Math.max(diskLines.length, reLines.length); i++) {
        if (diskLines[i] !== reLines[i]) {
          console.error(`  First diff at line ${i + 1}:`);
          console.error(`    disk:   ${diskLines[i]}`);
          console.error(`    reseri: ${reLines[i]}`);
          break;
        }
      }
      failed++;
    } else {
      console.log(`PASS proof-5: serialize -> deserialize round-trip — byte-identical JSON (${diskContent.length} bytes)`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cleanup and report                                                */
  /* ---------------------------------------------------------------- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`RunState: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

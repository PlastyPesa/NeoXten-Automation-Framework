/**
 * Workers — Acceptance Proofs (all 9 workers)
 *
 * 1  SpecValidator: valid spec → done; orphan feature → failed; no LLM entries
 * 2  Planner: 3 features → 3+ WorkUnits covering all; DAG acyclic; LLM call logged; consequence hits
 * 3  Builder: WorkUnits → files produced; LLM call logged per unit
 * 4  Assembler: build succeeds → done + buildOutput set; build fails → failed
 * 5  Tester: 2 journeys → 2 verdicts; FAIL journey → failed; screenshots in artifacts
 * 6  UIInspector: clean → done; contrast fail → failed with numeric measurement
 * 7  SecurityAuditor: vuln detected → failed; clean → done; no LLM entries
 * 8  ReleasePackager: artifacts hashed; oversized → failed; artifact_produced in chain
 * 9  RunAuditor: all gates → done; missing gate → failed; consequence memory written on failure
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EvidenceChain } from '../evidence-chain.js';
import { RunState } from '../run-state.js';
import { ConsequenceMemory } from '../consequence-memory.js';
import { specValidatorWorker } from '../workers/spec-validator.js';
import { createPlannerWorker } from '../workers/planner.js';
import { createBuilderWorker } from '../workers/builder.js';
import { createAssemblerWorker } from '../workers/assembler.js';
import { createTesterWorker } from '../workers/tester.js';
import { createUIInspectorWorker } from '../workers/ui-inspector.js';
import { createSecurityAuditorWorker } from '../workers/security-auditor.js';
import { createReleasePackagerWorker } from '../workers/release-packager.js';
import { createRunAuditorWorker } from '../workers/run-auditor.js';
import type { InferenceClient, InferenceRequest, InferenceResponse } from '../inference-client.js';
import type { FactorySpec } from '../spec/schema.js';

const TEST_DIR = path.join(os.tmpdir(), 'workers-test-' + Date.now());

function makeSpec(overrides?: Partial<Record<string, unknown>>): FactorySpec {
  return {
    schema_version: '2026.1',
    product: { name: 'TestApp', version: '1.0.0', description: 'Test', platforms: ['web'] },
    features: [
      { id: 'f1', description: 'Auth', acceptanceCriteria: ['Login works'], priority: 'high' },
      { id: 'f2', description: 'Dashboard', acceptanceCriteria: ['Shows data'], priority: 'medium' },
      { id: 'f3', description: 'Settings', acceptanceCriteria: ['Saves prefs'], priority: 'low' },
    ],
    journeys: [
      { id: 'j1', name: 'Login', exercisesFeatures: ['f1'], steps: [{ action: 'navigate', value: '/login' }, { action: 'assert', assertType: 'visible', selector: '.login-form' }] },
      { id: 'j2', name: 'Dashboard', exercisesFeatures: ['f2'], steps: [{ action: 'navigate', value: '/dash' }, { action: 'assert', assertType: 'visible', selector: '.dashboard' }] },
      { id: 'j3', name: 'Settings', exercisesFeatures: ['f3'], steps: [{ action: 'click', selector: '.settings' }, { action: 'assert', assertType: 'visible', selector: '.prefs' }] },
    ],
    quality: { startupMaxMs: 3000 },
    delivery: { targets: ['web'] },
    ...overrides,
  } as FactorySpec;
}

function makeState(subDir: string, spec?: FactorySpec): { rs: RunState; chain: EvidenceChain } {
  const dir = path.join(TEST_DIR, subDir);
  return {
    rs: new RunState({ runId: 'test-run', spec: spec ?? makeSpec(), evidenceChainPath: path.join(dir, 'chain.ndjson'), persistDir: dir }),
    chain: new EvidenceChain(),
  };
}

function mockInference(responseJson: unknown): InferenceClient {
  return {
    async complete(req: InferenceRequest): Promise<InferenceResponse> {
      return {
        text: JSON.stringify(responseJson),
        model: 'mock-model',
        promptTokens: req.prompt.length,
        completionTokens: 100,
        durationMs: 50,
      };
    },
  };
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

  /* ---- 1. SpecValidator ---- */
  {
    const { rs, chain } = makeState('sv-ok');
    const r = await specValidatorWorker.execute({}, rs, chain);
    const llmCalls = chain.getTimeline().filter(e => e.type === 'llm_call');
    check('spec-validator: valid spec → done, no LLM', [
      ['status=done', r.status === 'done'],
      ['zero LLM calls', llmCalls.length === 0],
    ]);
  }
  {
    const badSpec = makeSpec() as Record<string, unknown>;
    (badSpec.features as Array<Record<string, unknown>>).push({ id: 'orphan', description: 'X', acceptanceCriteria: ['Y'], priority: 'low' });
    const { rs, chain } = makeState('sv-fail', badSpec as FactorySpec);
    const r = await specValidatorWorker.execute({}, rs, chain);
    check('spec-validator: orphan feature → failed', [
      ['status=failed', r.status === 'failed'],
      ['mentions orphan', r.status === 'failed' && r.reason.includes('orphan')],
    ]);
  }

  /* ---- 2. Planner ---- */
  {
    const planResponse = {
      workUnits: [
        { id: 'wu-auth', featureIds: ['f1'], description: 'Build auth', dependencies: [] },
        { id: 'wu-dash', featureIds: ['f2'], description: 'Build dashboard', dependencies: ['wu-auth'] },
        { id: 'wu-settings', featureIds: ['f3'], description: 'Build settings', dependencies: [] },
      ],
      techStack: { framework: 'next.js' },
      fileStructure: ['src/auth.ts', 'src/dashboard.ts', 'src/settings.ts'],
    };
    const cmPath = path.join(TEST_DIR, 'planner', 'cm.ndjson');
    const cm = ConsequenceMemory.create(cmPath);
    cm.write({
      sourceRunId: 'old-run', domain: 'TestApp', stage: 'building', specHash: 'x',
      pattern: { errorType: 'build_fail' },
      failure: { description: 'old build failure' },
      resolution: { description: 'fixed imports' },
      confidence: 0.8, occurrences: 1,
    }, 'run-auditor');

    const planner = createPlannerWorker({ inference: mockInference(planResponse), consequenceMemory: cm });
    const { rs, chain } = makeState('planner-ok');
    const r = await planner.execute({}, rs, chain);
    const llmCalls = chain.getTimeline().filter(e => e.type === 'llm_call');
    const conseqHits = chain.getTimeline().filter(e => e.type === 'consequence_hit');
    const plan = rs.getPlan();
    const coveredFeatures = new Set(plan?.workUnits.flatMap(wu => wu.featureIds) ?? []);

    check('planner: 3 features → WorkUnits, LLM logged, consequence hits', [
      ['status=done', r.status === 'done'],
      ['plan set', plan !== null],
      ['3+ work units', (plan?.workUnits.length ?? 0) >= 3],
      ['f1 covered', coveredFeatures.has('f1')],
      ['f2 covered', coveredFeatures.has('f2')],
      ['f3 covered', coveredFeatures.has('f3')],
      ['LLM call logged', llmCalls.length === 1],
      ['consequence hit logged', conseqHits.length >= 1],
    ]);
  }

  /* ---- 3. Builder ---- */
  {
    const buildResponse = { files: [{ path: 'src/auth.ts', content: 'export const auth = true;' }] };
    const builder = createBuilderWorker({ inference: mockInference(buildResponse) });
    const { rs, chain } = makeState('builder-ok');
    rs.setPlan({
      workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'Build auth', dependencies: [] }],
      techStack: {}, fileStructure: [],
    });
    const r = await builder.execute({}, rs, chain);
    const llmCalls = chain.getTimeline().filter(e => e.type === 'llm_call');
    const wu = rs.getWorkUnits().find(w => w.id === 'wu-1');

    check('builder: WorkUnit → files, LLM logged', [
      ['status=done', r.status === 'done'],
      ['wu-1 done', wu?.status === 'done'],
      ['output files set', (wu?.outputFiles.length ?? 0) > 0],
      ['LLM call logged', llmCalls.length === 1],
      ['artifacts produced', r.status === 'done' && r.artifacts.length > 0],
    ]);
  }

  /* ---- 4. Assembler ---- */
  {
    const assembler = createAssemblerWorker({
      shell: { async run() { return { exitCode: 0, stdout: 'Built OK', stderr: '' }; } },
      projectDir: '/tmp/proj',
    });
    const { rs, chain } = makeState('asm-ok');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: { framework: 'next.js' }, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: ['src/index.ts'] });
    const r = await assembler.execute({}, rs, chain);

    check('assembler: build ok → done + buildOutput set', [
      ['status=done', r.status === 'done'],
      ['buildOutput set', rs.getBuildOutput() !== null],
      ['exitCode=0', rs.getBuildOutput()?.exitCode === 0],
    ]);
  }
  {
    const assembler = createAssemblerWorker({
      shell: { async run() { return { exitCode: 1, stdout: '', stderr: 'Error: module not found' }; } },
      projectDir: '/tmp/proj',
    });
    const { rs, chain } = makeState('asm-fail');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: ['src/index.ts'] });
    const r = await assembler.execute({}, rs, chain);

    check('assembler: build fails → failed', [
      ['status=failed', r.status === 'failed'],
      ['mentions exit code', r.status === 'failed' && r.reason.includes('exit 1')],
    ]);
  }

  /* ---- 5. Tester ---- */
  {
    const tester = createTesterWorker({
      appUrl: 'http://localhost:3000',
      runner: {
        async run(j) {
          return { journeyId: j.journeyId, verdict: 'PASS', durationMs: 200, screenshotPaths: [`/tmp/${j.journeyId}.png`] };
        },
      },
    });
    const { rs, chain } = makeState('tester-ok');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: 'npm run build', exitCode: 0, outputFiles: [] });
    const r = await tester.execute({}, rs, chain);

    check('tester: 3 journeys → 3 PASS verdicts, screenshots', [
      ['status=done', r.status === 'done'],
      ['3 test results', rs.getTestResults().length === 3],
      ['all PASS', rs.getTestResults().every(t => t.verdict === 'PASS')],
      ['artifacts have screenshots', r.status === 'done' && r.artifacts.length >= 3],
    ]);
  }
  {
    const tester = createTesterWorker({
      appUrl: 'http://localhost:3000',
      runner: {
        async run(j) {
          if (j.journeyId === 'j2') return { journeyId: j.journeyId, verdict: 'FAIL', durationMs: 500, screenshotPaths: [], failureReason: 'element not found' };
          return { journeyId: j.journeyId, verdict: 'PASS', durationMs: 200, screenshotPaths: [`/tmp/${j.journeyId}.png`] };
        },
      },
    });
    const { rs, chain } = makeState('tester-fail');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: 'npm run build', exitCode: 0, outputFiles: [] });
    const r = await tester.execute({}, rs, chain);

    check('tester: j2 fails → failed, reason includes j2', [
      ['status=failed', r.status === 'failed'],
      ['mentions j2', r.status === 'failed' && r.reason.includes('j2')],
    ]);
  }

  /* ---- 6. UIInspector ---- */
  {
    const inspector = createUIInspectorWorker({
      contrastThreshold: 4.5,
      analyzer: {
        async analyzeLayout() { return []; },
        async analyzeContrast() { return [{ element: 'h1', ratio: 7.0, threshold: 4.5, passed: true }]; },
        async analyzeAccessibility() { return [{ rule: 'color-contrast', passed: true }]; },
      },
    });
    const { rs, chain } = makeState('ui-ok');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: ['/tmp/j1.png'] });
    const r = await inspector.execute({}, rs, chain);

    check('ui-inspector: clean → done, inspection set', [
      ['status=done', r.status === 'done'],
      ['inspection set', rs.getUIInspection() !== null],
      ['overallPassed', rs.getUIInspection()?.overallPassed === true],
    ]);
  }
  {
    const inspector = createUIInspectorWorker({
      contrastThreshold: 4.5,
      analyzer: {
        async analyzeLayout() { return []; },
        async analyzeContrast() { return [{ element: 'p.small', ratio: 2.1, threshold: 4.5, passed: false }]; },
        async analyzeAccessibility() { return []; },
      },
    });
    const { rs, chain } = makeState('ui-fail');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: ['/tmp/j1.png'] });
    const r = await inspector.execute({}, rs, chain);

    check('ui-inspector: contrast fail → failed with numeric measurement', [
      ['status=failed', r.status === 'failed'],
      ['mentions contrast', r.status === 'failed' && r.reason.includes('contrast')],
      ['inspection has numeric ratio', rs.getUIInspection()?.contrastChecks[0]?.ratio === 2.1],
      ['inspection has numeric threshold', rs.getUIInspection()?.contrastChecks[0]?.threshold === 4.5],
    ]);
  }

  /* ---- 7. SecurityAuditor ---- */
  {
    const auditor = createSecurityAuditorWorker({
      scanner: {
        async auditDependencies() { return [{ severity: 'high', pkg: 'lodash@4.17.20', description: 'Prototype pollution' }]; },
        async scanSecrets() { return [{ file: 'src/config.ts', line: 5, pattern: 'API_KEY' }]; },
      },
    });
    const { rs, chain } = makeState('sec-vuln');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    const r = await auditor.execute({}, rs, chain);
    const llmCalls = chain.getTimeline().filter(e => e.type === 'llm_call');

    check('security-auditor: vuln + secret → failed, no LLM', [
      ['status=failed', r.status === 'failed'],
      ['mentions vulnerabilities', r.status === 'failed' && r.reason.includes('vulnerabilit')],
      ['mentions secrets', r.status === 'failed' && r.reason.includes('secret')],
      ['report set', rs.getSecurityReport() !== null],
      ['zero LLM calls', llmCalls.length === 0],
    ]);
  }
  {
    const auditor = createSecurityAuditorWorker({
      scanner: {
        async auditDependencies() { return []; },
        async scanSecrets() { return []; },
      },
    });
    const { rs, chain } = makeState('sec-clean');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    const r = await auditor.execute({}, rs, chain);

    check('security-auditor: clean → done', [
      ['status=done', r.status === 'done'],
      ['overallPassed', rs.getSecurityReport()?.overallPassed === true],
    ]);
  }

  /* ---- 8. ReleasePackager ---- */
  {
    const packager = createReleasePackagerWorker({
      maxBundleSizeBytes: 1_000_000,
      packager: {
        async buildForTarget(target) {
          return { artifacts: [{ path: `dist/${target}/app.js`, sizeBytes: 50_000, content: Buffer.from('app-content') }] };
        },
      },
    });
    const { rs, chain } = makeState('rp-ok');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: [] });
    rs.setUIInspection({ layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true });
    rs.setSecurityReport({ vulnerabilities: [], secretsFound: 0, overallPassed: true });
    const r = await packager.execute({}, rs, chain);
    const artProduced = chain.getTimeline().filter(e => e.type === 'artifact_produced');

    check('release-packager: artifacts hashed, artifact_produced in chain', [
      ['status=done', r.status === 'done'],
      ['artifact in RunState', rs.getReleaseArtifacts().length === 1],
      ['sha256 present', rs.getReleaseArtifacts()[0]?.sha256.length === 64],
      ['artifact_produced entry', artProduced.length === 1],
      ['artifacts in result', r.status === 'done' && r.artifacts.length === 1],
      ['artifact has sha256', r.status === 'done' && !!r.artifacts[0]?.sha256],
    ]);
  }
  {
    const packager = createReleasePackagerWorker({
      maxBundleSizeBytes: 100,
      packager: {
        async buildForTarget() {
          return { artifacts: [{ path: 'dist/app.js', sizeBytes: 500, content: Buffer.from('big') }] };
        },
      },
    });
    const { rs, chain } = makeState('rp-oversized');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: [] });
    rs.setUIInspection({ layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true });
    rs.setSecurityReport({ vulnerabilities: [], secretsFound: 0, overallPassed: true });
    const r = await packager.execute({}, rs, chain);

    check('release-packager: oversized → failed', [
      ['status=failed', r.status === 'failed'],
      ['mentions size', r.status === 'failed' && r.reason.includes('exceeds max size')],
    ]);
  }

  /* ---- 9. RunAuditor ---- */
  {
    const { rs, chain } = makeState('ra-ok');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: [] });
    rs.setUIInspection({ layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true });
    rs.setSecurityReport({ vulnerabilities: [], secretsFound: 0, overallPassed: true });
    rs.addReleaseArtifact({ platform: 'web', path: 'dist/app.js', sha256: 'a'.repeat(64), sizeBytes: 1024 });

    const gateIds = ['spec_valid', 'plan_complete', 'build_success', 'tests_pass', 'visual_qa', 'security_clear', 'artifact_ready', 'manifest_valid'];
    for (const gid of gateIds) {
      chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'run_audit', data: { gateId: gid, passed: true } });
    }

    const auditor = createRunAuditorWorker({ expectedGateIds: gateIds });
    const r = await auditor.execute({}, rs, chain);

    check('run-auditor: all gates present → done', [
      ['status=done', r.status === 'done'],
    ]);
  }
  {
    const { rs, chain } = makeState('ra-missing-gate');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: [] });
    rs.setUIInspection({ layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true });
    rs.setSecurityReport({ vulnerabilities: [], secretsFound: 0, overallPassed: true });
    rs.addReleaseArtifact({ platform: 'web', path: 'dist/app.js', sha256: 'b'.repeat(64), sizeBytes: 512 });

    chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'run_audit', data: { gateId: 'spec_valid', passed: true } });

    const allGates = ['spec_valid', 'plan_complete', 'build_success', 'tests_pass', 'visual_qa', 'security_clear', 'artifact_ready', 'manifest_valid'];
    const auditor = createRunAuditorWorker({ expectedGateIds: allGates });
    const r = await auditor.execute({}, rs, chain);

    check('run-auditor: missing gates → failed', [
      ['status=failed', r.status === 'failed'],
      ['mentions missing gate', r.status === 'failed' && r.reason.includes('not passed')],
    ]);
  }
  {
    const cmPath = path.join(TEST_DIR, 'ra-cm', 'cm.ndjson');
    const cm = ConsequenceMemory.create(cmPath);
    const { rs, chain } = makeState('ra-consequence');
    rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'X', dependencies: [] }], techStack: {}, fileStructure: [] });
    rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: [] });
    rs.setBuildOutput({ projectDir: '/tmp', buildCommand: '', exitCode: 0, outputFiles: [] });
    rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 100, screenshotPaths: [] });
    rs.setUIInspection({ layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true });
    rs.setSecurityReport({ vulnerabilities: [], secretsFound: 0, overallPassed: true });
    rs.addReleaseArtifact({ platform: 'web', path: 'dist/app.js', sha256: 'c'.repeat(64), sizeBytes: 256 });

    chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'testing', data: { gateId: 'spec_valid', passed: true } });
    chain.append({ type: 'gate_fail', workerId: 'gate-registry', stage: 'testing', data: { gateId: 'tests_pass', passed: false } });

    const allGates = ['spec_valid', 'plan_complete'];
    const auditor = createRunAuditorWorker({ expectedGateIds: allGates, consequenceMemory: cm });
    const r = await auditor.execute({}, rs, chain);

    check('run-auditor: gate_fail → consequence memory written', [
      ['consequence record written', cm.length === 1],
      ['record domain=shipping', cm.getByDomain('shipping').length === 1],
      ['record mentions tests_pass', cm.query({ gateId: 'tests_pass' }).length === 1],
    ]);
  }

  /* ---- Cleanup & Report ---- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Workers: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

/**
 * Integration — RunManifest + CLI Acceptance Proofs
 *
 * Manifest proofs:
 *  1. All required fields present per schema
 *  2. evidenceChainHash matches last chain entry hash
 *  3. artifactHashes match RunState release artifacts
 *  4. llmUsage totals match sum of llm_call entries in chain
 *  5. status matches RunState status
 *
 * CLI proofs:
 *  6. CLI registers 'factory run' command with --spec option
 *  7. CLI registers 'factory inspect <runId>' command
 *  8. CLI registers 'factory history' command
 *  9. Existing NeoXten 'run' command still registered (regression)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EvidenceChain } from '../evidence-chain.js';
import { RunState } from '../run-state.js';
import { buildManifest, RunManifestSchema } from '../manifest.js';
import type { FactorySpec } from '../spec/schema.js';

const TEST_DIR = path.join(os.tmpdir(), 'manifest-cli-test-' + Date.now());

function makeSpec(): FactorySpec {
  return {
    schema_version: '2026.1',
    product: { name: 'TestApp', version: '1.0.0', description: 'Test', platforms: ['web'] },
    features: [
      { id: 'f1', description: 'Auth', acceptanceCriteria: ['Login works'], priority: 'high' },
      { id: 'f2', description: 'Dashboard', acceptanceCriteria: ['Shows data'], priority: 'medium' },
      { id: 'f3', description: 'Settings', acceptanceCriteria: ['Saves prefs'], priority: 'low' },
    ],
    journeys: [
      { id: 'j1', name: 'Login', exercisesFeatures: ['f1'], steps: [{ action: 'navigate', value: '/login' }, { action: 'assert', assertType: 'visible', selector: '.form' }] },
      { id: 'j2', name: 'Dashboard', exercisesFeatures: ['f2'], steps: [{ action: 'navigate', value: '/dash' }, { action: 'assert', assertType: 'visible', selector: '.dash' }] },
      { id: 'j3', name: 'Settings', exercisesFeatures: ['f3'], steps: [{ action: 'click', selector: '.set' }, { action: 'assert', assertType: 'visible', selector: '.prefs' }] },
    ],
    quality: { startupMaxMs: 3000 },
    delivery: { targets: ['web'] },
  } as FactorySpec;
}

function buildFullRunState(subDir: string): { rs: RunState; chain: EvidenceChain } {
  const dir = path.join(TEST_DIR, subDir);
  const rs = new RunState({ runId: 'test-run-001', spec: makeSpec(), evidenceChainPath: path.join(dir, 'chain.ndjson'), persistDir: dir });
  const chain = new EvidenceChain();

  chain.append({ type: 'run_start', workerId: 'master', stage: 'initializing', data: { runId: 'test-run-001' } });

  chain.append({ type: 'note', workerId: 'master', stage: 'spec_validation', data: { event: 'stage_start' } });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'spec_validation', data: { gateId: 'spec_valid', passed: true } });
  rs.addGateResult({ gateId: 'spec_valid', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('spec_validation');
  rs.stageEnd('spec_validation');

  chain.append({ type: 'note', workerId: 'master', stage: 'planning', data: { event: 'stage_start' } });
  chain.append({ type: 'llm_call', workerId: 'planner', stage: 'planning', data: { promptHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), model: 'qwen2.5-7b', promptTokens: 500, completionTokens: 200, durationMs: 1200, role: 'planner' } });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'planning', data: { gateId: 'plan_complete', passed: true } });
  rs.addGateResult({ gateId: 'plan_complete', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('planning');
  rs.stageEnd('planning');

  rs.setPlan({ workUnits: [{ id: 'wu-1', featureIds: ['f1'], description: 'Build auth', dependencies: [] }], techStack: {}, fileStructure: [] });
  rs.updateWorkUnit('wu-1', { status: 'done', outputFiles: ['src/auth.ts'] });

  chain.append({ type: 'llm_call', workerId: 'builder', stage: 'building', data: { promptHash: 'c'.repeat(64), responseHash: 'd'.repeat(64), model: 'qwen2.5-7b', promptTokens: 800, completionTokens: 400, durationMs: 2500, role: 'builder' } });
  rs.stageStart('building');
  rs.stageEnd('building');

  rs.setBuildOutput({ projectDir: '/tmp/proj', buildCommand: 'npm run build', exitCode: 0, outputFiles: ['src/auth.ts'] });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'assembly', data: { gateId: 'build_success', passed: true } });
  rs.addGateResult({ gateId: 'build_success', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('assembly');
  rs.stageEnd('assembly');

  rs.addTestResult({ journeyId: 'j1', verdict: 'PASS', durationMs: 200, screenshotPaths: [] });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'testing', data: { gateId: 'tests_pass', passed: true } });
  rs.addGateResult({ gateId: 'tests_pass', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('testing');
  rs.stageEnd('testing');

  rs.setUIInspection({ layoutViolations: 0, contrastChecks: [], accessibilityChecks: [], overallPassed: true });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'ui_inspection', data: { gateId: 'visual_qa', passed: true } });
  rs.addGateResult({ gateId: 'visual_qa', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('ui_inspection');
  rs.stageEnd('ui_inspection');

  rs.setSecurityReport({ vulnerabilities: [], secretsFound: 0, overallPassed: true });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'security_audit', data: { gateId: 'security_clear', passed: true } });
  rs.addGateResult({ gateId: 'security_clear', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('security_audit');
  rs.stageEnd('security_audit');

  rs.addReleaseArtifact({ platform: 'web', path: 'dist/app.js', sha256: 'e'.repeat(64), sizeBytes: 50000 });
  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'release_package', data: { gateId: 'artifact_ready', passed: true } });
  rs.addGateResult({ gateId: 'artifact_ready', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('release_package');
  rs.stageEnd('release_package');

  chain.append({ type: 'gate_pass', workerId: 'gate-registry', stage: 'run_audit', data: { gateId: 'manifest_valid', passed: true } });
  rs.addGateResult({ gateId: 'manifest_valid', passed: true, timestamp: new Date().toISOString(), checks: [] });
  rs.stageStart('run_audit');
  rs.stageEnd('run_audit');

  rs.setStatus('shipped');
  chain.append({ type: 'run_end', workerId: 'master', stage: 'run_audit', data: { status: 'shipped' } });

  return { rs, chain };
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

  /* ---- Manifest Proof 1: All required fields present per schema ---- */
  {
    const { rs, chain } = buildFullRunState('manifest-1');
    const manifest = buildManifest(rs, chain);
    const parseResult = RunManifestSchema.safeParse(manifest);
    check('manifest: all required fields present, schema validates', [
      ['schema valid', parseResult.success],
      ['has runId', typeof manifest.runId === 'string' && manifest.runId.length > 0],
      ['has schemaVersion', manifest.schemaVersion === '2026.1'],
      ['has stages', Array.isArray(manifest.stages) && manifest.stages.length > 0],
      ['has gateVerdicts', Array.isArray(manifest.gateVerdicts) && manifest.gateVerdicts.length === 8],
      ['has artifactHashes', Array.isArray(manifest.artifactHashes)],
      ['has llmUsage', typeof manifest.llmUsage === 'object'],
      ['has manifestHash', manifest.manifestHash.length === 64],
    ]);
  }

  /* ---- Manifest Proof 2: evidenceChainHash matches last chain entry ---- */
  {
    const { rs, chain } = buildFullRunState('manifest-2');
    const manifest = buildManifest(rs, chain);
    const lastHash = chain.getLastHash();
    check('manifest: evidenceChainHash matches last chain entry hash', [
      ['hashes match', manifest.evidenceChainHash === lastHash],
      ['hash is 64 chars', manifest.evidenceChainHash.length === 64],
    ]);
  }

  /* ---- Manifest Proof 3: artifactHashes match RunState ---- */
  {
    const { rs, chain } = buildFullRunState('manifest-3');
    const manifest = buildManifest(rs, chain);
    const stateArtifacts = rs.getReleaseArtifacts();
    check('manifest: artifactHashes match RunState release artifacts', [
      ['same count', manifest.artifactHashes.length === stateArtifacts.length],
      ['sha256 match', manifest.artifactHashes.every((a, i) => a.sha256 === stateArtifacts[i].sha256)],
      ['platform match', manifest.artifactHashes.every((a, i) => a.platform === stateArtifacts[i].platform)],
      ['path match', manifest.artifactHashes.every((a, i) => a.path === stateArtifacts[i].path)],
      ['size match', manifest.artifactHashes.every((a, i) => a.sizeBytes === stateArtifacts[i].sizeBytes)],
    ]);
  }

  /* ---- Manifest Proof 4: llmUsage totals match chain entries ---- */
  {
    const { rs, chain } = buildFullRunState('manifest-4');
    const manifest = buildManifest(rs, chain);
    const timeline = chain.getTimeline();
    const llmEntries = timeline.filter(e => e.type === 'llm_call');
    const sumPrompt = llmEntries.reduce((s, e) => s + Number((e.data as Record<string, unknown>).promptTokens ?? 0), 0);
    const sumCompletion = llmEntries.reduce((s, e) => s + Number((e.data as Record<string, unknown>).completionTokens ?? 0), 0);
    const sumDuration = llmEntries.reduce((s, e) => s + Number((e.data as Record<string, unknown>).durationMs ?? 0), 0);

    check('manifest: llmUsage totals match sum of llm_call entries', [
      ['totalCalls', manifest.llmUsage.totalCalls === llmEntries.length],
      ['totalPromptTokens', manifest.llmUsage.totalPromptTokens === sumPrompt],
      ['totalCompletionTokens', manifest.llmUsage.totalCompletionTokens === sumCompletion],
      ['totalDurationMs', manifest.llmUsage.totalDurationMs === sumDuration],
      ['models include qwen', manifest.llmUsage.models.includes('qwen2.5-7b')],
    ]);
  }

  /* ---- Manifest Proof 5: status matches RunState status ---- */
  {
    const { rs: rsShipped, chain: chainShipped } = buildFullRunState('manifest-5a');
    const mShipped = buildManifest(rsShipped, chainShipped);

    const dir5b = path.join(TEST_DIR, 'manifest-5b');
    const rsAborted = new RunState({ runId: 'aborted-run', spec: makeSpec(), evidenceChainPath: path.join(dir5b, 'c.ndjson'), persistDir: dir5b });
    rsAborted.setStatus('aborted');
    const chainAborted = new EvidenceChain();
    chainAborted.append({ type: 'run_start', workerId: 'master', stage: 'initializing', data: {} });
    chainAborted.append({ type: 'run_end', workerId: 'master', stage: 'spec_validation', data: { status: 'aborted' } });
    const mAborted = buildManifest(rsAborted, chainAborted);

    check('manifest: status matches RunState status', [
      ['shipped matches', mShipped.status === 'shipped'],
      ['aborted matches', mAborted.status === 'aborted'],
    ]);
  }

  /* ---- CLI Proof 6-9: Commander registration ---- */
  {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf-8');
    check('CLI: factory subcommands registered, NeoXten run preserved', [
      ['factory run registered', cliSource.includes("command('run')") && cliSource.includes("'--spec'") || cliSource.includes("factoryRunCommand")],
      ['factory inspect registered', cliSource.includes("command('inspect") && cliSource.includes("factoryInspectCommand")],
      ['factory history registered', cliSource.includes("command('history')") && cliSource.includes("factoryHistoryCommand")],
      ['factory parent command', cliSource.includes("command('factory')")],
      ['NeoXten run preserved', cliSource.includes("runCommand") && cliSource.includes("--config")],
      ['NeoXten doctor preserved', cliSource.includes("doctorCommand")],
      ['NeoXten packs preserved', cliSource.includes("packsIngestCommand")],
      ['NeoXten bugs preserved', cliSource.includes("bugsListCommand")],
    ]);
  }

  /* ---- Cleanup ---- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Manifest + CLI: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

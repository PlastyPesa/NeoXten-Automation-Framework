/**
 * Pipeline Config — Acceptance Proofs
 *
 * Proof 1: Load valid 9-stage Factory 1 pipeline — topological order matches expected.
 * Proof 2: Cycle detection — A depends on B depends on A → rejected with cycle path.
 * Proof 3: Insert stage after "planning" — execution order updates, new stage between planning and building.
 * Proof 4: Unknown stage dependency reference — rejected.
 * Proof 5: Cross-validation — missing worker IDs and unsupported gates reported.
 * Proof 6: Missing required slice — stage requires slice no prior stage produces → rejected.
 * Proof 7: Evidence serialization — toEvidence() produces complete, JSON-serializable snapshot.
 */

import { PipelineConfig } from '../pipeline-config.js';
import { EvidenceChain } from '../evidence-chain.js';

const EXPECTED_ORDER = [
  'spec_validation', 'planning', 'building', 'assembly',
  'testing', 'ui_inspection', 'security_audit', 'release_package', 'run_audit',
];

function runTests(): void {
  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Valid 9-stage pipeline — topological order correct        */
  /* ---------------------------------------------------------------- */
  {
    const pipeline = PipelineConfig.defaultFactory1();
    const order = pipeline.getExecutionOrder();
    const orderIds = order.map(s => s.id);

    const checks = [
      ['stageCount', pipeline.stageCount() === 9],
      ['order length', order.length === 9],
      ['order matches', JSON.stringify(orderIds) === JSON.stringify(EXPECTED_ORDER)],
      ['spec_validation has no deps', pipeline.getStage('spec_validation').dependsOn.length === 0],
      ['planning depends on spec_validation', pipeline.getStage('planning').dependsOn.includes('spec_validation')],
      ['building is parallel', pipeline.getStage('building').parallel === true],
      ['building has no gate', pipeline.getStage('building').gate === null],
      ['assembly gate', pipeline.getStage('assembly').gate === 'build_success'],
      ['run_audit gate', pipeline.getStage('run_audit').gate === 'manifest_valid'],
      ['planning produces plan', pipeline.getStage('planning').produces.includes('plan')],
      ['planning produces workUnits', pipeline.getStage('planning').produces.includes('workUnits')],
      ['testing requires buildOutput', pipeline.getStage('testing').requires.includes('buildOutput')],
      ['testing produces testResults', pipeline.getStage('testing').produces.includes('testResults')],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-1: ${failedChecks.join(', ')}`);
      console.error(`  actual order: ${JSON.stringify(orderIds)}`);
      failed++;
    } else {
      console.log(`PASS proof-1: 9-stage Factory 1 pipeline — topological order correct, 13 checks (deps, gates, slices)`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Cycle detection                                          */
  /* ---------------------------------------------------------------- */
  {
    let threw = false;
    let msg = '';
    try {
      PipelineConfig.create({
        stages: [
          { id: 'A', worker: 'w1', dependsOn: ['B'], requires: ['spec'], produces: [] },
          { id: 'B', worker: 'w2', dependsOn: ['C'], requires: ['spec'], produces: [] },
          { id: 'C', worker: 'w3', dependsOn: ['A'], requires: ['spec'], produces: [] },
        ],
      });
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    const hasCycleMsg = msg.includes('cycle detected:');
    const mentionsAll = msg.includes('A') && msg.includes('B') && msg.includes('C');

    if (!threw || !hasCycleMsg || !mentionsAll) {
      console.error(`FAIL proof-2: threw=${threw}, msg="${msg}"`);
      failed++;
    } else {
      console.log(`PASS proof-2: cycle detected — "${msg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Insert stage after "planning"                            */
  /* ---------------------------------------------------------------- */
  {
    const pipeline = PipelineConfig.defaultFactory1();
    pipeline.insertStage(
      { id: 'code_review', worker: 'code-reviewer', gate: 'review_pass', requires: ['plan'], produces: [] },
      'planning',
    );

    const order = pipeline.getExecutionOrder();
    const orderIds = order.map(s => s.id);
    const planIdx = orderIds.indexOf('planning');
    const reviewIdx = orderIds.indexOf('code_review');
    const buildIdx = orderIds.indexOf('building');

    const newStage = pipeline.getStage('code_review');
    const buildStage = pipeline.getStage('building');

    const checks = [
      ['10 stages', pipeline.stageCount() === 10],
      ['code_review exists', reviewIdx !== -1],
      ['after planning', reviewIdx > planIdx],
      ['before building', reviewIdx < buildIdx],
      ['code_review depends on planning', newStage.dependsOn.includes('planning')],
      ['building now depends on code_review', buildStage.dependsOn.includes('code_review')],
      ['building no longer depends on planning', !buildStage.dependsOn.includes('planning')],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-3: ${failedChecks.join(', ')}`);
      console.error(`  order: ${JSON.stringify(orderIds)}`);
      console.error(`  building.dependsOn: ${JSON.stringify(buildStage.dependsOn)}`);
      failed++;
    } else {
      console.log(`PASS proof-3: insertStage("code_review", after "planning") — 10 stages, order: ...planning → code_review → building...`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: Unknown stage dependency                                 */
  /* ---------------------------------------------------------------- */
  {
    let threw = false;
    let msg = '';
    try {
      PipelineConfig.create({
        stages: [
          { id: 'alpha', worker: 'w1', dependsOn: ['nonexistent'], requires: ['spec'], produces: [] },
        ],
      });
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    if (!threw || !msg.includes("unknown stage dependency: 'nonexistent'")) {
      console.error(`FAIL proof-4: threw=${threw}, msg="${msg}"`);
      failed++;
    } else {
      console.log(`PASS proof-4: unknown dependency rejected — "${msg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5: Cross-validation — missing workers + unsupported gates   */
  /* ---------------------------------------------------------------- */
  {
    const pipeline = PipelineConfig.defaultFactory1();
    const errors = pipeline.crossValidate({
      knownWorkers: ['spec-validator', 'planner'],
      knownGates: ['spec_valid'],
    });

    const workerErrors = errors.filter(e => e.type === 'unknown_worker');
    const gateErrors = errors.filter(e => e.type === 'unknown_gate');

    const checks = [
      ['has worker errors', workerErrors.length === 7],
      ['has gate errors', gateErrors.length === 7],
      ['builder missing', workerErrors.some(e => e.message.includes("'builder'"))],
      ['tester missing', workerErrors.some(e => e.message.includes("'tester'"))],
      ['plan_complete gate missing', gateErrors.some(e => e.message.includes("'plan_complete'"))],
      ['tests_pass gate missing', gateErrors.some(e => e.message.includes("'tests_pass'"))],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-5: ${failedChecks.join(', ')}`);
      console.error(`  workerErrors: ${workerErrors.length}, gateErrors: ${gateErrors.length}`);
      failed++;
    } else {
      console.log(`PASS proof-5: cross-validation — 7 unknown workers, 7 unknown gates detected`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 6: Missing required slice — rejected                        */
  /* ---------------------------------------------------------------- */
  {
    let threw = false;
    let msg = '';
    try {
      PipelineConfig.create({
        stages: [
          { id: 'first', worker: 'w1', dependsOn: [], requires: ['spec'], produces: [] },
          { id: 'second', worker: 'w2', dependsOn: ['first'], requires: ['buildOutput'], produces: [] },
        ],
      });
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    if (!threw || !msg.includes("stage 'second' requires slice 'buildOutput' but no prior stage produces it")) {
      console.error(`FAIL proof-6: threw=${threw}, msg="${msg}"`);
      failed++;
    } else {
      console.log(`PASS proof-6: missing slice rejected — "${msg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 7: Evidence serialization — complete + chain-appendable     */
  /* ---------------------------------------------------------------- */
  {
    const pipeline = PipelineConfig.defaultFactory1();
    const evidence = pipeline.toEvidence();
    const chain = new EvidenceChain();

    chain.append({
      type: 'note',
      workerId: 'master',
      stage: 'initializing',
      data: { pipelineConfig: evidence },
    });

    const entry = chain.getEntry(0);
    const entryData = entry?.data as Record<string, unknown>;
    const config = entryData.pipelineConfig as Record<string, unknown>;
    const stages = config.stages as Array<Record<string, unknown>>;

    const jsonRoundTrip = JSON.parse(JSON.stringify(evidence));

    const checks = [
      ['stageCount', config.stageCount === 9],
      ['stages array', Array.isArray(stages) && stages.length === 9],
      ['first stage id', stages[0].id === 'spec_validation'],
      ['last stage id', stages[8].id === 'run_audit'],
      ['chain entry exists', entry !== undefined],
      ['chain entry type', entry?.type === 'note'],
      ['JSON round-trip', JSON.stringify(evidence) === JSON.stringify(jsonRoundTrip)],
      ['chain verifies', chain.verify().valid],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-7: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log(`PASS proof-7: toEvidence() → Evidence Chain append — 8 checks (stageCount, stages, round-trip, chain integrity)`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Report                                                            */
  /* ---------------------------------------------------------------- */
  console.log('');
  console.log(`Pipeline Config: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

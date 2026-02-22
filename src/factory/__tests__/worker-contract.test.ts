/**
 * Worker Contract + Registry — Acceptance Proofs
 *
 * Proof 1: Mock worker implementing WorkerContract compiles and satisfies interface.
 * Proof 2: Register in WorkerRegistry — get(id) returns it.
 * Proof 3: Register duplicate id — throws "worker 'X' already registered".
 * Proof 4: Dispatch with all required slices present — execute runs, result collected.
 * Proof 5: Dispatch with missing required slice — throws "missing required RunState slice: X".
 * Proof 6: Dispatch with timeout shorter than execution — rejects with timeout error.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkerRegistry } from '../worker-registry.js';
import { EvidenceChain } from '../evidence-chain.js';
import { RunState } from '../run-state.js';
import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { FactorySpec } from '../spec/schema.js';

const TEST_DIR = path.join(os.tmpdir(), 'worker-contract-test-' + Date.now());

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

function createRunState(subDir: string): RunState {
  const dir = path.join(TEST_DIR, subDir);
  return new RunState({
    runId: 'test-run-001',
    spec: makeSpec(),
    evidenceChainPath: path.join(dir, 'evidence.ndjson'),
    persistDir: dir,
  });
}

function createMockWorker(overrides?: Partial<WorkerContract>): WorkerContract {
  return {
    id: 'mock-planner',
    accepts: 'planning',
    requires: ['spec'],
    produces: ['plan'],
    timeout: 5000,
    async execute(_task, _runState, _chain): Promise<WorkerResult> {
      return {
        status: 'done',
        artifacts: [{ name: 'plan.json', path: '/tmp/plan.json' }],
        evidence: ['entry-hash-1'],
      };
    },
    ...overrides,
  };
}

async function runTests(): Promise<void> {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Mock worker satisfies WorkerContract interface           */
  /* ---------------------------------------------------------------- */
  {
    const worker = createMockWorker();
    const checks = [
      ['id is string', typeof worker.id === 'string' && worker.id.length > 0],
      ['accepts is RunStage', worker.accepts === 'planning'],
      ['requires is array', Array.isArray(worker.requires) && worker.requires.length > 0],
      ['produces is array', Array.isArray(worker.produces) && worker.produces.length > 0],
      ['timeout is number', typeof worker.timeout === 'number' && worker.timeout > 0],
      ['execute is function', typeof worker.execute === 'function'],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-1: interface mismatch: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-1: mock worker satisfies WorkerContract — 6 field checks correct');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Register, then get(id) returns same worker               */
  /* ---------------------------------------------------------------- */
  {
    const registry = new WorkerRegistry();
    const worker = createMockWorker();
    registry.register(worker);
    const retrieved = registry.get('mock-planner');
    const same = retrieved === worker;
    const listed = registry.list().includes('mock-planner');
    const has = registry.has('mock-planner');

    if (!same || !listed || !has) {
      console.error(`FAIL proof-2: get=${same}, listed=${listed}, has=${has}`);
      failed++;
    } else {
      console.log('PASS proof-2: register -> get(id) returns same instance, list() includes id, has() true');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Duplicate registration throws                            */
  /* ---------------------------------------------------------------- */
  {
    const registry = new WorkerRegistry();
    registry.register(createMockWorker());
    let threw = false;
    let msg = '';
    try {
      registry.register(createMockWorker());
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    if (!threw || !msg.includes("worker 'mock-planner' already registered")) {
      console.error(`FAIL proof-3: threw=${threw}, msg="${msg}"`);
      failed++;
    } else {
      console.log(`PASS proof-3: duplicate registration rejected — "${msg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: Dispatch with all requires present — execute runs        */
  /* ---------------------------------------------------------------- */
  {
    const registry = new WorkerRegistry();
    let executeCalled = false;

    const worker = createMockWorker({
      requires: ['spec'],
      async execute(_task, _runState, _chain): Promise<WorkerResult> {
        executeCalled = true;
        return {
          status: 'done',
          artifacts: [{ name: 'plan.json', path: '/tmp/plan.json' }],
          evidence: ['e1'],
        };
      },
    });
    registry.register(worker);

    const runState = createRunState('proof4');
    const chain = new EvidenceChain();
    const result = await registry.dispatch('mock-planner', {}, runState, chain);

    if (!executeCalled) {
      console.error('FAIL proof-4: execute was not called');
      failed++;
    } else if (result.status !== 'done') {
      console.error(`FAIL proof-4: expected status=done, got ${result.status}`);
      failed++;
    } else {
      console.log(`PASS proof-4: dispatch with 'spec' present — execute called, result.status=done, 1 artifact`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5: Dispatch with missing slice — throws                     */
  /* ---------------------------------------------------------------- */
  {
    const registry = new WorkerRegistry();
    const worker = createMockWorker({
      id: 'mock-tester',
      accepts: 'testing',
      requires: ['buildOutput'],
    });
    registry.register(worker);

    const runState = createRunState('proof5');
    const chain = new EvidenceChain();

    let threw = false;
    let msg = '';
    try {
      await registry.dispatch('mock-tester', {}, runState, chain);
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    if (!threw || !msg.includes('missing required RunState slice: buildOutput')) {
      console.error(`FAIL proof-5: threw=${threw}, msg="${msg}"`);
      failed++;
    } else {
      console.log(`PASS proof-5: dispatch with missing 'buildOutput' rejected — "${msg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 6: Dispatch with timeout — rejects with timeout error       */
  /* ---------------------------------------------------------------- */
  {
    const registry = new WorkerRegistry();
    const worker = createMockWorker({
      id: 'slow-worker',
      accepts: 'planning',
      requires: ['spec'],
      timeout: 50,
      async execute(): Promise<WorkerResult> {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { status: 'done', artifacts: [], evidence: [] };
      },
    });
    registry.register(worker);

    const runState = createRunState('proof6');
    const chain = new EvidenceChain();

    let threw = false;
    let msg = '';
    try {
      await registry.dispatch('slow-worker', {}, runState, chain);
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    if (!threw || !msg.includes('worker slow-worker timed out after 50ms')) {
      console.error(`FAIL proof-6: threw=${threw}, msg="${msg}"`);
      failed++;
    } else {
      console.log(`PASS proof-6: timeout enforced — "${msg}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cleanup and report                                                */
  /* ---------------------------------------------------------------- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Worker Contract + Registry: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

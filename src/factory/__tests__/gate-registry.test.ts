/**
 * Gate Registry — Acceptance Proofs
 *
 * Proof 1: Register gate, evaluate with passing evidence — returns { passed: true },
 *          gate_pass entry appended to Evidence Chain.
 * Proof 2: Evaluate with failing evidence — returns { passed: false },
 *          gate_fail entry appended to Evidence Chain.
 * Proof 3: Register duplicate gateId — throws.
 * Proof 4: API surface audit — only register, evaluate, getRegistered exist.
 *          No override, skip, force, bypass, or setResult.
 */

import { GateRegistry } from '../gate-registry.js';
import { EvidenceChain } from '../evidence-chain.js';
import type { GateEvidence, GateResult } from '../gate-registry.js';

function makePassingGate(gateId: string): (evidence: GateEvidence) => GateResult {
  return (evidence) => {
    const score = evidence.score as number;
    const threshold = evidence.threshold as number;
    return {
      gateId,
      passed: score >= threshold,
      checks: [{
        name: 'score_check',
        passed: score >= threshold,
        measured: score,
        threshold,
      }],
      timestamp: new Date().toISOString(),
    };
  };
}

function runTests(): void {
  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Passing evidence — gate_pass in chain                    */
  /* ---------------------------------------------------------------- */
  {
    const registry = new GateRegistry();
    const chain = new EvidenceChain();

    registry.register('test_gate', makePassingGate('test_gate'));

    const result = registry.evaluate(
      'test_gate',
      { score: 95, threshold: 80 },
      chain,
      'testing',
    );

    const chainEntry = chain.getEntry(0);
    const checks = [
      ['result.passed', result.passed === true],
      ['result.gateId', result.gateId === 'test_gate'],
      ['result.checks.length', result.checks.length === 1],
      ['result.checks[0].passed', result.checks[0].passed === true],
      ['result.checks[0].measured', result.checks[0].measured === 95],
      ['result.checks[0].threshold', result.checks[0].threshold === 80],
      ['result.timestamp exists', typeof result.timestamp === 'string' && result.timestamp.length > 0],
      ['chain length', chain.length === 1],
      ['chain entry type', chainEntry?.type === 'gate_pass'],
      ['chain entry workerId', chainEntry?.workerId === 'gate-registry'],
      ['chain entry stage', chainEntry?.stage === 'testing'],
      ['chain entry data.gateId', (chainEntry?.data as Record<string, unknown>)?.gateId === 'test_gate'],
      ['chain entry data.passed', (chainEntry?.data as Record<string, unknown>)?.passed === true],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-1: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-1: passing evidence — result.passed=true, gate_pass in chain, 13 checks correct');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Failing evidence — gate_fail in chain                    */
  /* ---------------------------------------------------------------- */
  {
    const registry = new GateRegistry();
    const chain = new EvidenceChain();

    registry.register('quality_gate', makePassingGate('quality_gate'));

    const result = registry.evaluate(
      'quality_gate',
      { score: 50, threshold: 80 },
      chain,
      'testing',
    );

    const chainEntry = chain.getEntry(0);
    const checks = [
      ['result.passed', result.passed === false],
      ['result.gateId', result.gateId === 'quality_gate'],
      ['result.checks[0].passed', result.checks[0].passed === false],
      ['result.checks[0].measured', result.checks[0].measured === 50],
      ['result.checks[0].threshold', result.checks[0].threshold === 80],
      ['chain entry type', chainEntry?.type === 'gate_fail'],
      ['chain entry data.passed', (chainEntry?.data as Record<string, unknown>)?.passed === false],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-2: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-2: failing evidence — result.passed=false, gate_fail in chain, 7 checks correct');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Duplicate registration throws                            */
  /* ---------------------------------------------------------------- */
  {
    const registry = new GateRegistry();
    registry.register('dup_gate', makePassingGate('dup_gate'));

    let threw = false;
    let msg = '';
    try {
      registry.register('dup_gate', makePassingGate('dup_gate'));
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }

    let threwUnreg = false;
    let unregMsg = '';
    try {
      registry.evaluate('nonexistent', {}, new EvidenceChain(), 'initializing');
    } catch (e) {
      threwUnreg = true;
      unregMsg = (e as Error).message;
    }

    const regListCorrect = registry.getRegistered().length === 1 &&
                           registry.getRegistered()[0] === 'dup_gate';

    if (!threw || !msg.includes("gate 'dup_gate' already registered")) {
      console.error(`FAIL proof-3 (duplicate): threw=${threw}, msg="${msg}"`);
      failed++;
    } else if (!threwUnreg || !unregMsg.includes("gate 'nonexistent' not registered")) {
      console.error(`FAIL proof-3 (unregistered): threw=${threwUnreg}, msg="${unregMsg}"`);
      failed++;
    } else if (!regListCorrect) {
      console.error(`FAIL proof-3 (getRegistered): ${JSON.stringify(registry.getRegistered())}`);
      failed++;
    } else {
      console.log(`PASS proof-3: duplicate rejected — "${msg}", unregistered rejected — "${unregMsg}", getRegistered correct`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: API surface audit — no forbidden methods                 */
  /* ---------------------------------------------------------------- */
  {
    const registry = new GateRegistry();
    const instanceMethods = new Set<string>();

    let proto: object | null = Object.getPrototypeOf(registry) as object;
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name !== 'constructor') {
          instanceMethods.add(name);
        }
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }

    const allowedMethods = new Set(['register', 'evaluate', 'getRegistered']);
    const forbidden = ['override', 'skip', 'force', 'bypass', 'setResult',
                       'remove', 'delete', 'clear', 'reset', 'update', 'replace'];
    const foundForbidden = forbidden.filter(f =>
      Array.from(instanceMethods).some(m => m.toLowerCase().includes(f))
    );
    const unexpectedMethods = Array.from(instanceMethods).filter(m => !allowedMethods.has(m));

    if (foundForbidden.length > 0) {
      console.error(`FAIL proof-4: forbidden methods found: ${foundForbidden.join(', ')}`);
      failed++;
    } else if (unexpectedMethods.length > 0) {
      console.error(`FAIL proof-4: unexpected methods: ${unexpectedMethods.join(', ')}`);
      failed++;
    } else {
      const sortedMethods = Array.from(instanceMethods).sort();
      console.log(`PASS proof-4: API surface audit — public methods: [${sortedMethods.join(', ')}] — no forbidden methods (checked: ${forbidden.join(', ')})`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Report                                                            */
  /* ---------------------------------------------------------------- */
  console.log('');
  console.log(`Gate Registry: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

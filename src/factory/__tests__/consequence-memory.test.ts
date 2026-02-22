/**
 * Consequence Memory — Acceptance Proofs
 *
 * Proof 1: Write as run-auditor — persisted to NDJSON, hash valid, retrievable.
 * Proof 2: Write as builder — rejected with "only run-auditor can write".
 * Proof 3: Query with matching pattern — correct record returned.
 * Proof 4: Query with non-matching pattern — empty array.
 * Proof 5: Decay confidence — decreases, record persists at 0, auditor-only.
 * Proof 6: Domain scoping — getByDomain returns only matching domain records.
 * Proof 7: Load from NDJSON — in-memory index matches file contents.
 * Proof 8: Export/import round-trip — exported records importable, duplicates skipped.
 * Proof 9: Tamper detection — modified record hash rejected on import + verifyIntegrity.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConsequenceMemory, verifyRecordHash } from '../consequence-memory.js';
import type { ConsequenceRecordInput } from '../consequence-memory.js';

const TEST_DIR = path.join(os.tmpdir(), 'consequence-memory-test-' + Date.now());

function makeInput(overrides?: Partial<ConsequenceRecordInput>): ConsequenceRecordInput {
  return {
    sourceRunId: 'run-001',
    domain: 'shipping',
    stage: 'testing',
    specHash: 'abc123',
    pattern: { errorType: 'assertion_failed', selector: '.login-btn' },
    failure: { description: 'Login button not visible after 3s', gateId: 'tests_pass' },
    resolution: { description: 'Added explicit wait for DOM load', appliedInRunId: 'run-002' },
    confidence: 0.9,
    occurrences: 1,
    ...overrides,
  };
}

function runTests(): void {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Write as run-auditor — persisted, hash valid             */
  /* ---------------------------------------------------------------- */
  {
    const filePath = path.join(TEST_DIR, 'proof1', 'memory.ndjson');
    const mem = ConsequenceMemory.create(filePath);
    const record = mem.write(makeInput(), 'run-auditor');

    const checks = [
      ['id is UUID', typeof record.id === 'string' && record.id.length === 36],
      ['createdAt is ISO', typeof record.createdAt === 'string' && record.createdAt.includes('T')],
      ['hash is SHA-256', typeof record.hash === 'string' && record.hash.length === 64],
      ['hash verifies', verifyRecordHash(record)],
      ['domain', record.domain === 'shipping'],
      ['stage', record.stage === 'testing'],
      ['specHash', record.specHash === 'abc123'],
      ['confidence', record.confidence === 0.9],
      ['file exists', fs.existsSync(filePath)],
      ['length=1', mem.length === 1],
      ['retrievable by id', mem.getById(record.id)?.id === record.id],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-1: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-1: write as run-auditor — persisted, hash valid, 11 field checks correct');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Write as non-auditor — rejected                          */
  /* ---------------------------------------------------------------- */
  {
    const mem = ConsequenceMemory.create(path.join(TEST_DIR, 'proof2', 'memory.ndjson'));
    const callers = ['builder', 'planner', 'tester', 'master', ''];
    const results: Array<{ caller: string; threw: boolean; msg: string }> = [];

    for (const caller of callers) {
      try {
        mem.write(makeInput(), caller);
        results.push({ caller, threw: false, msg: '' });
      } catch (e) {
        results.push({ caller, threw: true, msg: (e as Error).message });
      }
    }

    const allThrew = results.every(r => r.threw);
    const allCorrectMsg = results.every(r => r.msg.includes('only run-auditor'));
    const memEmpty = mem.length === 0;

    if (!allThrew || !allCorrectMsg || !memEmpty) {
      console.error(`FAIL proof-2: allThrew=${allThrew}, allCorrectMsg=${allCorrectMsg}, memEmpty=${memEmpty}`);
      failed++;
    } else {
      console.log(`PASS proof-2: write rejected for ${callers.length} non-auditor callers — memory remains empty`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Query with matching pattern                              */
  /* ---------------------------------------------------------------- */
  {
    const mem = ConsequenceMemory.create(path.join(TEST_DIR, 'proof3', 'memory.ndjson'));
    mem.write(makeInput({ pattern: { errorType: 'assertion_failed', selector: '.login-btn' } }), 'run-auditor');
    mem.write(makeInput({ pattern: { errorType: 'timeout', selector: '.submit-btn' } }), 'run-auditor');
    mem.write(makeInput({ pattern: { errorType: 'assertion_failed', selector: '.nav-menu' } }), 'run-auditor');

    const exact = mem.query({ errorType: 'assertion_failed', selector: '.login-btn' });
    const partial = mem.query({ errorType: 'assertion_failed' });
    const timeout = mem.query({ errorType: 'timeout' });

    const checks = [
      ['exact match returns 1', exact.length === 1],
      ['exact match correct selector', (exact[0]?.pattern as Record<string, unknown>)?.selector === '.login-btn'],
      ['partial match returns 2', partial.length === 2],
      ['timeout match returns 1', timeout.length === 1],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-3: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-3: query — exact=1, partial(errorType)=2, timeout=1');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: Query with non-matching pattern — empty                  */
  /* ---------------------------------------------------------------- */
  {
    const mem = ConsequenceMemory.create(path.join(TEST_DIR, 'proof4', 'memory.ndjson'));
    mem.write(makeInput({ pattern: { errorType: 'assertion_failed' } }), 'run-auditor');

    const noMatch = mem.query({ errorType: 'segfault' });
    const wrongKey = mem.query({ nonexistentKey: 'value' });
    const wrongDomain = mem.query({ errorType: 'assertion_failed' }, 'nonexistent-domain');

    const checks = [
      ['no match', noMatch.length === 0],
      ['wrong key', wrongKey.length === 0],
      ['wrong domain', wrongDomain.length === 0],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-4: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-4: non-matching queries — all return empty arrays');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5: Decay confidence — decreases, persists at 0, auditor-only*/
  /* ---------------------------------------------------------------- */
  {
    const mem = ConsequenceMemory.create(path.join(TEST_DIR, 'proof5', 'memory.ndjson'));
    const record = mem.write(makeInput({ confidence: 0.8 }), 'run-auditor');

    const after1 = mem.decayConfidence(record.id, 0.3, 'run-auditor');
    const after2 = mem.decayConfidence(record.id, 0.3, 'run-auditor');
    const after3 = mem.decayConfidence(record.id, 0.5, 'run-auditor');

    let nonAuditorThrew = false;
    let nonAuditorMsg = '';
    try {
      mem.decayConfidence(record.id, 0.1, 'builder');
    } catch (e) {
      nonAuditorThrew = true;
      nonAuditorMsg = (e as Error).message;
    }

    const checks = [
      ['after1 confidence ~0.5', Math.abs(after1.confidence - 0.5) < 0.001],
      ['after2 confidence ~0.2', Math.abs(after2.confidence - 0.2) < 0.001],
      ['after3 confidence 0 (floored)', after3.confidence === 0],
      ['record still exists', mem.getById(record.id) !== undefined],
      ['hash updated', after3.hash !== record.hash],
      ['hash still valid', verifyRecordHash(after3)],
      ['non-auditor rejected', nonAuditorThrew],
      ['correct error msg', nonAuditorMsg.includes('only run-auditor')],
      ['length still 1', mem.length === 1],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-5: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-5: decay — 0.8→0.5→0.2→0 (floored), hash recomputed, auditor-only enforced');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 6: Domain scoping                                           */
  /* ---------------------------------------------------------------- */
  {
    const mem = ConsequenceMemory.create(path.join(TEST_DIR, 'proof6', 'memory.ndjson'));
    mem.write(makeInput({ domain: 'shipping', stage: 'testing', specHash: 'hash-a' }), 'run-auditor');
    mem.write(makeInput({ domain: 'shipping', stage: 'building', specHash: 'hash-a' }), 'run-auditor');
    mem.write(makeInput({ domain: 'security', stage: 'security_audit', specHash: 'hash-b' }), 'run-auditor');
    mem.write(makeInput({ domain: 'assets', stage: 'release_package', specHash: 'hash-c' }), 'run-auditor');

    const shipping = mem.getByDomain('shipping');
    const security = mem.getByDomain('security');
    const assets = mem.getByDomain('assets');
    const empty = mem.getByDomain('nonexistent');

    const shippingStages = shipping.map(r => r.stage).sort();
    const securitySpecs = security.map(r => r.specHash);

    const checks = [
      ['shipping count', shipping.length === 2],
      ['shipping stages', JSON.stringify(shippingStages) === JSON.stringify(['building', 'testing'])],
      ['security count', security.length === 1],
      ['security specHash', securitySpecs[0] === 'hash-b'],
      ['assets count', assets.length === 1],
      ['empty domain', empty.length === 0],
      ['total records', mem.length === 4],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-6: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-6: domain scoping — shipping=2, security=1, assets=1, nonexistent=0');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 7: Load from NDJSON — in-memory matches file                */
  /* ---------------------------------------------------------------- */
  {
    const filePath = path.join(TEST_DIR, 'proof7', 'memory.ndjson');
    const mem1 = ConsequenceMemory.create(filePath);
    const r1 = mem1.write(makeInput({ domain: 'shipping' }), 'run-auditor');
    const r2 = mem1.write(makeInput({ domain: 'security' }), 'run-auditor');

    const mem2 = ConsequenceMemory.load(filePath);
    const loaded1 = mem2.getById(r1.id);
    const loaded2 = mem2.getById(r2.id);

    const checks = [
      ['loaded length', mem2.length === 2],
      ['record 1 exists', loaded1 !== undefined],
      ['record 1 domain', loaded1?.domain === 'shipping'],
      ['record 1 hash match', loaded1?.hash === r1.hash],
      ['record 2 exists', loaded2 !== undefined],
      ['record 2 domain', loaded2?.domain === 'security'],
      ['record 2 hash match', loaded2?.hash === r2.hash],
      ['integrity valid', mem2.verifyIntegrity().valid],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-7: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-7: load from NDJSON — 2 records recovered, hashes match, integrity valid');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 8: Export/import round-trip                                  */
  /* ---------------------------------------------------------------- */
  {
    const srcPath = path.join(TEST_DIR, 'proof8', 'source.ndjson');
    const exportPath = path.join(TEST_DIR, 'proof8', 'export.ndjson');
    const destPath = path.join(TEST_DIR, 'proof8', 'dest.ndjson');

    const src = ConsequenceMemory.create(srcPath);
    src.write(makeInput({ domain: 'shipping', pattern: { type: 'A' } }), 'run-auditor');
    src.write(makeInput({ domain: 'security', pattern: { type: 'B' } }), 'run-auditor');

    src.exportRecords(exportPath);

    const dest = ConsequenceMemory.create(destPath);
    const importCount = dest.importRecords(exportPath, 'run-auditor');
    const dupCount = dest.importRecords(exportPath, 'run-auditor');

    const srcContent = fs.readFileSync(srcPath, 'utf-8');
    const destContent = fs.readFileSync(destPath, 'utf-8');

    let nonAuditorThrew = false;
    try {
      dest.importRecords(exportPath, 'planner');
    } catch (e) {
      nonAuditorThrew = true;
    }

    const checks = [
      ['imported 2', importCount === 2],
      ['duplicates skipped', dupCount === 0],
      ['dest length', dest.length === 2],
      ['NDJSON content matches', srcContent === destContent],
      ['dest integrity', dest.verifyIntegrity().valid],
      ['non-auditor import rejected', nonAuditorThrew],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-8: ${failedChecks.join(', ')}`);
      failed++;
    } else {
      console.log('PASS proof-8: export/import round-trip — 2 imported, 0 duplicates, NDJSON byte-equal, auditor-only');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 9: Tamper detection                                         */
  /* ---------------------------------------------------------------- */
  {
    const srcPath = path.join(TEST_DIR, 'proof9', 'source.ndjson');
    const tamperedPath = path.join(TEST_DIR, 'proof9', 'tampered.ndjson');
    const destPath = path.join(TEST_DIR, 'proof9', 'dest.ndjson');

    const src = ConsequenceMemory.create(srcPath);
    const record = src.write(makeInput(), 'run-auditor');
    src.exportRecords(tamperedPath);

    const lines = fs.readFileSync(tamperedPath, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[0]);
    tampered.confidence = 0.1;
    fs.writeFileSync(tamperedPath, JSON.stringify(tampered) + '\n', 'utf-8');

    let importThrew = false;
    let importMsg = '';
    const dest = ConsequenceMemory.create(destPath);
    try {
      dest.importRecords(tamperedPath, 'run-auditor');
    } catch (e) {
      importThrew = true;
      importMsg = (e as Error).message;
    }

    const mem = ConsequenceMemory.create(path.join(TEST_DIR, 'proof9', 'verify.ndjson'));
    const good = mem.write(makeInput(), 'run-auditor');
    const integrity1 = mem.verifyIntegrity();

    const verifyPath = path.join(TEST_DIR, 'proof9', 'verify.ndjson');
    const verifyLines = fs.readFileSync(verifyPath, 'utf-8').trim().split('\n');
    const verifyParsed = JSON.parse(verifyLines[0]);
    verifyParsed.failure.description = 'TAMPERED DESCRIPTION';
    fs.writeFileSync(verifyPath, JSON.stringify(verifyParsed) + '\n', 'utf-8');
    const mem2 = ConsequenceMemory.load(verifyPath);
    const integrity2 = mem2.verifyIntegrity();

    const checks = [
      ['import rejects tampered', importThrew],
      ['import error mentions tampered', importMsg.includes('tampered record detected')],
      ['import error includes id', importMsg.includes(record.id)],
      ['dest remains empty', dest.length === 0],
      ['verifyIntegrity passes for untampered', integrity1.valid],
      ['verifyIntegrity catches tampered', !integrity2.valid],
      ['tampered ID reported', integrity2.tamperedIds.length === 1],
    ] as const;

    const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
    if (failedChecks.length > 0) {
      console.error(`FAIL proof-9: ${failedChecks.join(', ')}`);
      console.error(`  importThrew=${importThrew}, msg="${importMsg}"`);
      console.error(`  integrity1=${JSON.stringify(integrity1)}, integrity2=${JSON.stringify(integrity2)}`);
      failed++;
    } else {
      console.log('PASS proof-9: tamper detection — import rejects modified record, verifyIntegrity catches file tampering');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cleanup and report                                                */
  /* ---------------------------------------------------------------- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Consequence Memory: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

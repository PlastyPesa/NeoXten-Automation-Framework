/**
 * Evidence Chain — Acceptance Proofs
 *
 * Proof 1: Append 100 mixed-type entries, verify() returns true.
 * Proof 2: Tamper with entry 50 in NDJSON, verify() detects it.
 * Proof 3: Serialize to NDJSON, deserialize, verify identical chain.
 * Proof 4: Public API has no update/delete/set/splice methods.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EvidenceChain, computeEntryHash } from '../evidence-chain.js';
import type { EntryType, RunStage, EvidenceEntryInput } from '../evidence-chain.js';

const TEST_DIR = path.join(os.tmpdir(), 'evidence-chain-test-' + Date.now());

const ENTRY_TYPES: EntryType[] = [
  'run_start', 'worker_start', 'worker_end', 'gate_pass', 'gate_fail',
  'artifact_produced', 'llm_call', 'error', 'note', 'consequence_hit', 'run_end',
];

const STAGES: RunStage[] = [
  'initializing', 'spec_validation', 'planning', 'building', 'assembly',
  'testing', 'ui_inspection', 'security_audit', 'release_package', 'run_audit',
];

function makeInput(i: number): EvidenceEntryInput {
  return {
    type: ENTRY_TYPES[i % ENTRY_TYPES.length],
    workerId: `worker-${i % 5}`,
    stage: STAGES[i % STAGES.length],
    data: { index: i, value: `data-${i}`, nested: { key: `nested-${i}` } },
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
  };
}

function runTests(): void {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Append 100 entries, verify chain integrity               */
  /* ---------------------------------------------------------------- */
  {
    const chain = new EvidenceChain();
    for (let i = 0; i < 100; i++) {
      const entry = chain.append(makeInput(i));
      if (entry.seq !== i) {
        console.error(`FAIL proof-1: entry seq should be ${i}, got ${entry.seq}`);
        failed++;
        break;
      }
    }

    if (chain.length !== 100) {
      console.error(`FAIL proof-1: chain length should be 100, got ${chain.length}`);
      failed++;
    } else {
      const result = chain.verify();
      if (!result.valid) {
        console.error(`FAIL proof-1: verify returned invalid at seq ${result.brokenAtSeq}: ${result.error}`);
        failed++;
      } else {
        const first = chain.getEntry(0);
        const last = chain.getEntry(99);
        if (first?.prevHash !== null) {
          console.error('FAIL proof-1: first entry prevHash should be null');
          failed++;
        } else if (last?.hash !== chain.getLastHash()) {
          console.error('FAIL proof-1: getLastHash mismatch');
          failed++;
        } else {
          console.log('PASS proof-1: 100 mixed-type entries appended, verify() valid, hashes consistent');
          passed++;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Tamper with entry 50 in NDJSON, detect corruption        */
  /* ---------------------------------------------------------------- */
  {
    const chain = new EvidenceChain();
    for (let i = 0; i < 100; i++) chain.append(makeInput(i));

    const ndjsonPath = path.join(TEST_DIR, 'tamper-test.ndjson');
    chain.writeToFile(ndjsonPath);

    const lines = fs.readFileSync(ndjsonPath, 'utf-8').trim().split('\n');
    const entry50 = JSON.parse(lines[50]);
    entry50.data.value = 'TAMPERED';
    lines[50] = JSON.stringify(entry50);
    fs.writeFileSync(ndjsonPath, lines.join('\n') + '\n', 'utf-8');

    const tampered = EvidenceChain.readFromFile(ndjsonPath);
    const result = tampered.verify();

    if (result.valid) {
      console.error('FAIL proof-2: tampered chain should be invalid');
      failed++;
    } else if (result.brokenAtSeq !== 50) {
      console.error(`FAIL proof-2: expected brokenAtSeq=50, got ${result.brokenAtSeq}`);
      failed++;
    } else {
      console.log(`PASS proof-2: tamper detected at seq ${result.brokenAtSeq} — "${result.error}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Serialize -> deserialize round-trip, identical chain     */
  /* ---------------------------------------------------------------- */
  {
    const chain = new EvidenceChain();
    for (let i = 0; i < 100; i++) chain.append(makeInput(i));

    const ndjsonPath = path.join(TEST_DIR, 'roundtrip-test.ndjson');
    chain.writeToFile(ndjsonPath);

    const restored = EvidenceChain.readFromFile(ndjsonPath);
    const verifyResult = restored.verify();

    if (!verifyResult.valid) {
      console.error(`FAIL proof-3: restored chain invalid at seq ${verifyResult.brokenAtSeq}`);
      failed++;
    } else if (restored.length !== chain.length) {
      console.error(`FAIL proof-3: length mismatch ${restored.length} vs ${chain.length}`);
      failed++;
    } else {
      let mismatch = false;
      for (let i = 0; i < chain.length; i++) {
        const original = chain.getEntry(i)!;
        const loaded = restored.getEntry(i)!;
        if (original.hash !== loaded.hash || original.seq !== loaded.seq) {
          console.error(`FAIL proof-3: entry ${i} differs after round-trip`);
          mismatch = true;
          break;
        }
      }
      if (!mismatch) {
        const originalNDJSON = chain.toNDJSON();
        const restoredNDJSON = restored.toNDJSON();
        if (originalNDJSON !== restoredNDJSON) {
          console.error('FAIL proof-3: NDJSON output differs after round-trip');
          failed++;
        } else {
          console.log('PASS proof-3: serialize -> deserialize round-trip, all entries identical, NDJSON byte-equal');
          passed++;
        }
      } else {
        failed++;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: No update/delete/set/splice on public interface          */
  /* ---------------------------------------------------------------- */
  {
    const forbidden = ['update', 'delete', 'set', 'splice', 'remove', 'replace', 'modify', 'overwrite'];
    const proto = Object.getOwnPropertyNames(EvidenceChain.prototype);
    const violations = forbidden.filter(name => proto.includes(name));

    if (violations.length > 0) {
      console.error(`FAIL proof-4: forbidden methods found on prototype: ${violations.join(', ')}`);
      failed++;
    } else {
      const allowed = proto.filter(n => n !== 'constructor').sort();
      console.log(`PASS proof-4: no mutation methods on public API. Methods: [${allowed.join(', ')}]`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5 (bonus): computeEntryHash is deterministic                */
  /* ---------------------------------------------------------------- */
  {
    const chain = new EvidenceChain();
    const entry = chain.append(makeInput(0));
    const { hash: _, ...partial } = entry;
    const recomputed = computeEntryHash(partial);
    if (recomputed !== entry.hash) {
      console.error(`FAIL proof-5: recomputed hash differs from stored hash`);
      failed++;
    } else {
      console.log('PASS proof-5: exported computeEntryHash reproduces chain hashes (external verifier proof)');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 6 (bonus): empty chain                                      */
  /* ---------------------------------------------------------------- */
  {
    const empty = new EvidenceChain();
    const result = empty.verify();
    if (!result.valid || result.length !== 0) {
      console.error('FAIL proof-6: empty chain should verify as valid with length 0');
      failed++;
    } else if (empty.getLastHash() !== null) {
      console.error('FAIL proof-6: empty chain getLastHash should be null');
      failed++;
    } else if (empty.toNDJSON() !== '') {
      console.error('FAIL proof-6: empty chain NDJSON should be empty string');
      failed++;
    } else {
      console.log('PASS proof-6: empty chain verifies, getLastHash() null, NDJSON empty');
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cleanup and report                                                */
  /* ---------------------------------------------------------------- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Evidence Chain: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

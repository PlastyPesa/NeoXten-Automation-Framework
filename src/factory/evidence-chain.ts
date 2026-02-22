/**
 * Evidence Chain — append-only, hash-linked event log.
 *
 * Core Factory primitive. Every event in a Run is recorded as a chain entry.
 * Each entry's SHA-256 hash includes the previous entry's hash, forming a
 * tamper-evident sequence. Serialized as NDJSON (one JSON object per line).
 *
 * Public API is deliberately limited: append, verify, query, serialize.
 * No method exists to modify or delete past entries.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type EntryType =
  | 'run_start'
  | 'worker_start'
  | 'worker_end'
  | 'gate_pass'
  | 'gate_fail'
  | 'artifact_produced'
  | 'llm_call'
  | 'error'
  | 'note'
  | 'consequence_hit'
  | 'run_end';

export type RunStage =
  | 'initializing'
  | 'spec_validation'
  | 'planning'
  | 'building'
  | 'assembly'
  | 'testing'
  | 'ui_inspection'
  | 'security_audit'
  | 'release_package'
  | 'run_audit';

export interface EvidenceEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: EntryType;
  readonly workerId: string;
  readonly stage: RunStage;
  readonly data: Readonly<Record<string, unknown>>;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface EvidenceEntryInput {
  type: EntryType;
  workerId: string;
  stage: RunStage;
  data: Record<string, unknown>;
  timestamp?: string;
}

export interface VerifyResult {
  valid: boolean;
  length: number;
  brokenAtSeq?: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Deterministic hashing                                              */
/* ------------------------------------------------------------------ */

/**
 * Stable JSON serialization with recursively sorted object keys.
 * Guarantees identical output regardless of property insertion order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key: string, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Compute SHA-256 hash of an evidence entry (excluding the hash field itself).
 * Exported so external verifiers can reimplement independently.
 */
export function computeEntryHash(entry: Omit<EvidenceEntry, 'hash'>): string {
  const payload = stableStringify({
    data: entry.data,
    prevHash: entry.prevHash,
    seq: entry.seq,
    stage: entry.stage,
    timestamp: entry.timestamp,
    type: entry.type,
    workerId: entry.workerId,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

/* ------------------------------------------------------------------ */
/*  EvidenceChain                                                      */
/* ------------------------------------------------------------------ */

export class EvidenceChain {
  private readonly entries: EvidenceEntry[] = [];

  /** Number of entries in the chain. */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Append a new entry to the chain.
   * Computes prevHash from the previous entry and SHA-256 hash of the new entry.
   * Returns the frozen, immutable entry.
   */
  append(input: EvidenceEntryInput): EvidenceEntry {
    const seq = this.entries.length;
    const prevHash = seq > 0 ? this.entries[seq - 1].hash : null;
    const timestamp = input.timestamp ?? new Date().toISOString();

    const partial = {
      seq,
      timestamp,
      type: input.type,
      workerId: input.workerId,
      stage: input.stage,
      data: input.data,
      prevHash,
    };

    const hash = computeEntryHash(partial);
    const entry: EvidenceEntry = Object.freeze({ ...partial, hash });
    this.entries.push(entry);
    return entry;
  }

  /**
   * Walk the entire chain and verify hash continuity.
   * Returns { valid: true } if intact, or { valid: false, brokenAtSeq } on tampering.
   */
  verify(): VerifyResult {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      const expectedPrevHash = i === 0 ? null : this.entries[i - 1].hash;
      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          length: this.entries.length,
          brokenAtSeq: i,
          error: `Entry ${i} prevHash mismatch`,
        };
      }

      const expectedHash = computeEntryHash({
        seq: entry.seq,
        timestamp: entry.timestamp,
        type: entry.type,
        workerId: entry.workerId,
        stage: entry.stage,
        data: entry.data,
        prevHash: entry.prevHash,
      });
      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          length: this.entries.length,
          brokenAtSeq: i,
          error: `Entry ${i} hash mismatch`,
        };
      }
    }

    return { valid: true, length: this.entries.length };
  }

  /** Retrieve a single entry by sequence number. */
  getEntry(seq: number): EvidenceEntry | undefined {
    if (seq < 0 || seq >= this.entries.length) return undefined;
    return this.entries[seq];
  }

  /** Hash of the final entry, or null if chain is empty. */
  getLastHash(): string | null {
    if (this.entries.length === 0) return null;
    return this.entries[this.entries.length - 1].hash;
  }

  /** Read-only view of the full timeline. */
  getTimeline(): ReadonlyArray<Readonly<EvidenceEntry>> {
    return this.entries;
  }

  /** Serialize the entire chain to NDJSON string. */
  toNDJSON(): string {
    if (this.entries.length === 0) return '';
    return this.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  }

  /** Reconstruct a chain from an NDJSON string. */
  static fromNDJSON(content: string): EvidenceChain {
    const chain = new EvidenceChain();
    const trimmed = content.trim();
    if (trimmed.length === 0) return chain;

    for (const line of trimmed.split('\n')) {
      chain.entries.push(Object.freeze(JSON.parse(line) as EvidenceEntry));
    }
    return chain;
  }

  /** Write chain to an NDJSON file. */
  writeToFile(filePath: string): void {
    writeFileSync(filePath, this.toNDJSON(), 'utf-8');
  }

  /** Read chain from an NDJSON file. */
  static readFromFile(filePath: string): EvidenceChain {
    return EvidenceChain.fromNDJSON(readFileSync(filePath, 'utf-8'));
  }
}

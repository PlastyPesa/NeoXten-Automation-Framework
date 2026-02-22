/**
 * Consequence Memory — structured, queryable failure-resolution database.
 *
 * Records verified failures paired with their resolutions, domain-scoped
 * by project + specHash + stage. NDJSON file storage, local by default.
 *
 * Write-restricted to RunAuditor (callerWorkerId enforcement).
 * Read-only influence on pipeline: can inform Planner/Builder but cannot
 * bypass gates or modify RunState directly.
 *
 * Records are never deleted. Confidence can reach 0 but record persists.
 * Export/import enables sharing across machines with tamper verification.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { stableStringify } from './evidence-chain.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ConsequenceRecord {
  id: string;
  createdAt: string;
  sourceRunId: string;
  domain: string;
  stage: string;
  specHash: string;
  pattern: Record<string, unknown>;
  failure: {
    description: string;
    errorCode?: string;
    gateId?: string;
  };
  resolution: {
    description: string;
    appliedInRunId?: string;
  };
  confidence: number;
  occurrences: number;
  hash: string;
}

export type ConsequenceRecordInput = Omit<ConsequenceRecord, 'id' | 'createdAt' | 'hash'>;

const AUTHORIZED_WRITER = 'run-auditor';

/* ------------------------------------------------------------------ */
/*  Record hashing                                                     */
/* ------------------------------------------------------------------ */

export function computeRecordHash(record: Omit<ConsequenceRecord, 'hash'>): string {
  const payload = stableStringify({
    confidence: record.confidence,
    createdAt: record.createdAt,
    domain: record.domain,
    failure: record.failure,
    id: record.id,
    occurrences: record.occurrences,
    pattern: record.pattern,
    resolution: record.resolution,
    sourceRunId: record.sourceRunId,
    specHash: record.specHash,
    stage: record.stage,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

export function verifyRecordHash(record: ConsequenceRecord): boolean {
  const { hash: actual, ...rest } = record;
  return computeRecordHash(rest) === actual;
}

/* ------------------------------------------------------------------ */
/*  Pattern matching                                                   */
/* ------------------------------------------------------------------ */

function patternsOverlap(
  query: Record<string, unknown>,
  record: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(query)) {
    if (!(key in record)) return false;
    if (record[key] !== value) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Consequence Memory                                                 */
/* ------------------------------------------------------------------ */

export class ConsequenceMemory {
  private records: ConsequenceRecord[] = [];
  private readonly filePath: string;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Create a new empty memory at the given path. */
  static create(filePath: string): ConsequenceMemory {
    return new ConsequenceMemory(filePath);
  }

  /** Load existing memory from an NDJSON file. */
  static load(filePath: string): ConsequenceMemory {
    const mem = new ConsequenceMemory(filePath);
    if (!existsSync(filePath)) return mem;

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return mem;

    for (const line of content.split('\n')) {
      const record = JSON.parse(line) as ConsequenceRecord;
      mem.records.push(record);
    }
    return mem;
  }

  /** Number of records in memory. */
  get length(): number {
    return this.records.length;
  }

  /**
   * Write a new consequence record. Only run-auditor may write.
   * Record receives a UUID, timestamp, and SHA-256 hash on creation.
   */
  write(input: ConsequenceRecordInput, callerWorkerId: string): ConsequenceRecord {
    if (callerWorkerId !== AUTHORIZED_WRITER) {
      throw new Error('only run-auditor can write consequence records');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const partial: Omit<ConsequenceRecord, 'hash'> = {
      id,
      createdAt,
      sourceRunId: input.sourceRunId,
      domain: input.domain,
      stage: input.stage,
      specHash: input.specHash,
      pattern: input.pattern,
      failure: input.failure,
      resolution: input.resolution,
      confidence: input.confidence,
      occurrences: input.occurrences,
    };
    const record: ConsequenceRecord = { ...partial, hash: computeRecordHash(partial) };

    this.records.push(record);
    this.persist();
    return record;
  }

  /**
   * Query records by structural pattern overlap, optionally filtered by domain.
   * All keys in the query pattern must exist in the record's pattern with matching values.
   */
  query(pattern: Record<string, unknown>, domain?: string): ConsequenceRecord[] {
    return this.records.filter(record => {
      if (domain !== undefined && record.domain !== domain) return false;
      return patternsOverlap(pattern, record.pattern);
    });
  }

  /** Get all records for a specific domain. */
  getByDomain(domain: string): ConsequenceRecord[] {
    return this.records.filter(r => r.domain === domain);
  }

  /** Get a record by ID. */
  getById(id: string): ConsequenceRecord | undefined {
    return this.records.find(r => r.id === id);
  }

  /**
   * Decay a record's confidence. Only run-auditor may modify.
   * Confidence floors at 0. Record persists regardless.
   */
  decayConfidence(
    recordId: string,
    amount: number,
    callerWorkerId: string,
  ): ConsequenceRecord {
    if (callerWorkerId !== AUTHORIZED_WRITER) {
      throw new Error('only run-auditor can modify consequence records');
    }
    const idx = this.records.findIndex(r => r.id === recordId);
    if (idx === -1) throw new Error(`consequence record '${recordId}' not found`);

    const record = this.records[idx];
    const updated: Omit<ConsequenceRecord, 'hash'> = {
      ...record,
      confidence: Math.max(0, record.confidence - amount),
    };
    this.records[idx] = { ...updated, hash: computeRecordHash(updated) };

    this.persist();
    return this.records[idx];
  }

  /**
   * Verify integrity of all records. Returns IDs of tampered records.
   */
  verifyIntegrity(): { valid: boolean; tamperedIds: string[] } {
    const tampered: string[] = [];
    for (const record of this.records) {
      if (!verifyRecordHash(record)) {
        tampered.push(record.id);
      }
    }
    return { valid: tampered.length === 0, tamperedIds: tampered };
  }

  /** Export all records to an NDJSON file for sharing across machines. */
  exportRecords(exportPath: string): void {
    mkdirSync(dirname(exportPath), { recursive: true });
    const ndjson = this.records.length > 0
      ? this.records.map(r => JSON.stringify(r)).join('\n') + '\n'
      : '';
    writeFileSync(exportPath, ndjson, 'utf-8');
  }

  /**
   * Import records from an NDJSON export file. Only run-auditor may import.
   * Verifies record hashes on import — rejects tampered records.
   * Skips duplicates (by ID). Returns count of newly imported records.
   */
  importRecords(importPath: string, callerWorkerId: string): number {
    if (callerWorkerId !== AUTHORIZED_WRITER) {
      throw new Error('only run-auditor can import consequence records');
    }

    const content = readFileSync(importPath, 'utf-8').trim();
    if (!content) return 0;

    const incoming = content.split('\n').map(line => JSON.parse(line) as ConsequenceRecord);

    for (const record of incoming) {
      if (!verifyRecordHash(record)) {
        throw new Error(`tampered record detected on import: id '${record.id}'`);
      }
    }

    const existingIds = new Set(this.records.map(r => r.id));
    let imported = 0;
    for (const record of incoming) {
      if (!existingIds.has(record.id)) {
        this.records.push(record);
        imported++;
      }
    }

    if (imported > 0) this.persist();
    return imported;
  }

  /* ---- Persistence ---- */

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const ndjson = this.records.length > 0
      ? this.records.map(r => JSON.stringify(r)).join('\n') + '\n'
      : '';
    writeFileSync(this.filePath, ndjson, 'utf-8');
  }
}

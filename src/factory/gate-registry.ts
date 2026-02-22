/**
 * Gate Registry — deterministic gate evaluation with Evidence Chain integration.
 *
 * Every gate is a synchronous pure function: (evidence) -> GateResult.
 * No side effects. No network calls. No LLM calls. No override mechanism.
 *
 * evaluate() runs the gate, appends gate_pass or gate_fail to the Evidence
 * Chain, and returns the result. The pipeline halts on any FAIL.
 *
 * Public API surface is deliberately restricted to: register, evaluate,
 * getRegistered. No override, skip, force, bypass, or setResult exists.
 */

import type { EvidenceChain, RunStage } from './evidence-chain.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GateCheck {
  name: string;
  passed: boolean;
  measured: number;
  threshold: number;
  message?: string;
}

export interface GateResult {
  gateId: string;
  passed: boolean;
  checks: GateCheck[];
  timestamp: string;
}

/** Flexible evidence bag — each gate defines what keys it expects. */
export type GateEvidence = Readonly<Record<string, unknown>>;

/**
 * Synchronous, pure function. Takes evidence, produces a deterministic verdict.
 * Must set gateId and timestamp on the returned GateResult.
 */
export type GateFunction = (evidence: GateEvidence) => GateResult;

/* ------------------------------------------------------------------ */
/*  Gate Registry                                                      */
/* ------------------------------------------------------------------ */

export class GateRegistry {
  private readonly gates = new Map<string, GateFunction>();

  /**
   * Register a gate function under a unique ID.
   * Rejects duplicate registrations — gates are immutable once registered.
   */
  register(gateId: string, gateFn: GateFunction): void {
    if (this.gates.has(gateId)) {
      throw new Error(`gate '${gateId}' already registered`);
    }
    this.gates.set(gateId, gateFn);
  }

  /**
   * Evaluate a registered gate against evidence.
   *
   * 1. Retrieves the gate function (throws if unregistered).
   * 2. Calls the pure function with the evidence.
   * 3. Appends a `gate_pass` or `gate_fail` entry to the Evidence Chain.
   * 4. Returns the GateResult.
   */
  evaluate(
    gateId: string,
    evidence: GateEvidence,
    chain: EvidenceChain,
    stage: RunStage,
  ): GateResult {
    const gateFn = this.gates.get(gateId);
    if (!gateFn) {
      throw new Error(`gate '${gateId}' not registered`);
    }

    const result = gateFn(evidence);

    chain.append({
      type: result.passed ? 'gate_pass' : 'gate_fail',
      workerId: 'gate-registry',
      stage,
      data: {
        gateId: result.gateId,
        passed: result.passed,
        checks: result.checks,
      },
    });

    return result;
  }

  /** Returns the list of registered gate IDs. */
  getRegistered(): string[] {
    return Array.from(this.gates.keys());
  }
}

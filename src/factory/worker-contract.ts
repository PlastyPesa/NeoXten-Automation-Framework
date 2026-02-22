/**
 * Worker Contract — the interface every Factory Worker must implement.
 *
 * Workers are stateless processors. Each declares what pipeline stage it
 * handles, what RunState slots it reads, what it writes, and a bounded
 * execution timeout. The Master dispatches workers; workers never self-invoke.
 */

import type { RunStage } from './evidence-chain.js';
import type { EvidenceChain } from './evidence-chain.js';
import type { RunState } from './run-state.js';

/* ------------------------------------------------------------------ */
/*  RunState slice identifiers                                         */
/* ------------------------------------------------------------------ */

export type RunStateSlice =
  | 'spec'
  | 'plan'
  | 'workUnits'
  | 'buildOutput'
  | 'testResults'
  | 'uiInspection'
  | 'securityReport'
  | 'releaseArtifacts';

/**
 * Returns true if the given slice is present (non-null for objects,
 * non-empty for arrays) in the RunState.
 */
export function isSlicePresent(runState: RunState, slice: RunStateSlice): boolean {
  switch (slice) {
    case 'spec':            return runState.spec != null;
    case 'plan':            return runState.getPlan() !== null;
    case 'workUnits':       return runState.getWorkUnits().length > 0;
    case 'buildOutput':     return runState.getBuildOutput() !== null;
    case 'testResults':     return runState.getTestResults().length > 0;
    case 'uiInspection':    return runState.getUIInspection() !== null;
    case 'securityReport':  return runState.getSecurityReport() !== null;
    case 'releaseArtifacts': return runState.getReleaseArtifacts().length > 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Worker result types                                                */
/* ------------------------------------------------------------------ */

export interface WorkerArtifact {
  name: string;
  path: string;
  sha256?: string;
}

export type WorkerResult =
  | { status: 'done'; artifacts: WorkerArtifact[]; evidence: string[] }
  | { status: 'failed'; reason: string; evidence: string[] };

/* ------------------------------------------------------------------ */
/*  Worker contract interface                                          */
/* ------------------------------------------------------------------ */

export interface WorkerContract {
  /** Unique worker type identifier (e.g. 'planner', 'builder', 'tester'). */
  readonly id: string;

  /** Which pipeline stage this worker handles. */
  readonly accepts: RunStage;

  /** RunState slots that must be non-null/non-empty before execute(). */
  readonly requires: readonly RunStateSlice[];

  /** RunState slots this worker writes to. */
  readonly produces: readonly RunStateSlice[];

  /** Maximum execution time in milliseconds. */
  readonly timeout: number;

  /**
   * Execute the worker's task.
   *
   * @param task - Worker-specific input (e.g. a WorkUnit for Builder).
   * @param runState - The shared run state (read/write according to contract).
   * @param evidenceChain - Append evidence entries during execution.
   * @returns Discriminated result: done with artifacts, or failed with reason.
   */
  execute(
    task: unknown,
    runState: RunState,
    evidenceChain: EvidenceChain,
  ): Promise<WorkerResult>;
}

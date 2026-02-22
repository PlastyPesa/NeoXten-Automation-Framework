/**
 * Worker Registry — stores Worker implementations and validates dispatch.
 *
 * Registration rejects duplicate IDs. Dispatch validates that all required
 * RunState slices are present before calling execute(), and enforces the
 * worker's timeout bound.
 */

import type { EvidenceChain } from './evidence-chain.js';
import type { RunState } from './run-state.js';
import type { WorkerContract, WorkerResult } from './worker-contract.js';
import { isSlicePresent } from './worker-contract.js';

export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerContract>();

  register(worker: WorkerContract): void {
    if (this.workers.has(worker.id)) {
      throw new Error(`worker '${worker.id}' already registered`);
    }
    this.workers.set(worker.id, worker);
  }

  get(id: string): WorkerContract {
    const worker = this.workers.get(id);
    if (!worker) {
      throw new Error(`worker '${id}' not found`);
    }
    return worker;
  }

  has(id: string): boolean {
    return this.workers.has(id);
  }

  list(): string[] {
    return Array.from(this.workers.keys());
  }

  async dispatch(
    id: string,
    task: unknown,
    runState: RunState,
    evidenceChain: EvidenceChain,
  ): Promise<WorkerResult> {
    const worker = this.get(id);

    for (const slice of worker.requires) {
      if (!isSlicePresent(runState, slice)) {
        throw new Error(`missing required RunState slice: ${slice}`);
      }
    }

    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error(`worker ${id} timed out after ${worker.timeout}ms`)),
        worker.timeout,
      );
    });

    try {
      return await Promise.race([
        worker.execute(task, runState, evidenceChain),
        timer,
      ]);
    } finally {
      if (timerId !== undefined) clearTimeout(timerId);
    }
  }
}

/**
 * SpecValidator Worker — validates the Spec against schema + semantic rules.
 * Pure deterministic. Zero LLM dependency.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';
import { validateSpec } from '../spec/validator.js';

export const specValidatorWorker: WorkerContract = {
  id: 'spec-validator',
  accepts: 'spec_validation',
  requires: ['spec'],
  produces: [],
  timeout: 30_000,

  async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
    const result = validateSpec(runState.spec);

    if (result.valid) {
      chain.append({
        type: 'note',
        workerId: 'spec-validator',
        stage: 'spec_validation',
        data: { event: 'validation_passed', checkCount: countChecks(runState.spec) },
      });
      return {
        status: 'done',
        artifacts: [],
        evidence: [],
      };
    }

    const reasons = result.errors!.map(e => e.message);
    chain.append({
      type: 'note',
      workerId: 'spec-validator',
      stage: 'spec_validation',
      data: { event: 'validation_failed', errors: reasons },
    });
    return {
      status: 'failed',
      reason: reasons.join('; '),
      evidence: [],
    };
  },
};

function countChecks(spec: Record<string, unknown>): number {
  let count = 1; // schema validation
  const features = spec.features as unknown[];
  const journeys = spec.journeys as unknown[];
  count += (features?.length ?? 0); // feature uniqueness
  count += (journeys?.length ?? 0); // journey assertions
  count += 1; // coverage check
  count += 1; // schema version
  return count;
}

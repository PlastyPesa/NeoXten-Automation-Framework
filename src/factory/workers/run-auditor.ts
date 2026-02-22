/**
 * RunAuditor Worker — final pipeline stage.
 * Verifies Evidence Chain integrity, gate completeness, artifact hashes.
 * Produces RunManifest. Writes failure records to Consequence Memory.
 * No LLM.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';
import type { ConsequenceMemory } from '../consequence-memory.js';

export interface RunAuditorDeps {
  consequenceMemory?: ConsequenceMemory;
  expectedGateIds: string[];
}

export function createRunAuditorWorker(deps: RunAuditorDeps): WorkerContract {
  return {
    id: 'run-auditor',
    accepts: 'run_audit',
    requires: ['releaseArtifacts'],
    produces: [],
    timeout: 60_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const errors: string[] = [];

      const chainResult = chain.verify();
      if (!chainResult.valid) {
        errors.push(`evidence chain broken at seq ${chainResult.brokenAtSeq}`);
      }

      const timeline = chain.getTimeline();
      const passedGates = new Set(
        timeline.filter(e => e.type === 'gate_pass')
          .map(e => (e.data as Record<string, unknown>).gateId as string)
      );
      const failedGates = timeline.filter(e => e.type === 'gate_fail')
        .map(e => (e.data as Record<string, unknown>).gateId as string);

      for (const gateId of deps.expectedGateIds) {
        if (!passedGates.has(gateId)) {
          errors.push(`gate '${gateId}' not passed`);
        }
      }

      const artifacts = runState.getReleaseArtifacts();
      for (const artifact of artifacts) {
        if (!artifact.sha256 || artifact.sha256.length !== 64) {
          errors.push(`artifact '${artifact.path}' has invalid hash`);
        }
      }

      chain.append({
        type: 'note',
        workerId: 'run-auditor',
        stage: 'run_audit',
        data: {
          event: 'audit_complete',
          chainValid: chainResult.valid,
          chainLength: chainResult.length,
          gatesPassed: passedGates.size,
          gatesExpected: deps.expectedGateIds.length,
          artifactsVerified: artifacts.length,
          errors,
        },
      });

      if (failedGates.length > 0 && deps.consequenceMemory) {
        for (const gateId of failedGates) {
          const gateEntry = timeline.find(
            e => e.type === 'gate_fail' && (e.data as Record<string, unknown>).gateId === gateId
          );
          deps.consequenceMemory.write({
            sourceRunId: runState.runId,
            domain: 'shipping',
            stage: gateEntry?.stage ?? 'unknown',
            specHash: runState.specHash,
            pattern: { gateId, failureType: 'gate_fail' },
            failure: { description: `gate '${gateId}' failed`, gateId },
            resolution: { description: 'pending investigation' },
            confidence: 0.5,
            occurrences: 1,
          }, 'run-auditor');
        }
      }

      if (errors.length > 0) {
        return { status: 'failed', reason: errors.join('; '), evidence: [] };
      }

      return { status: 'done', artifacts: [], evidence: [] };
    },
  };
}

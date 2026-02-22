/**
 * Builder Worker — generates source files for a WorkUnit via LLM.
 * Self-validates output (syntax parse). All LLM calls logged.
 * Bounded retry is handled by the Master; this worker attempts once per dispatch.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';
import type { InferenceClient } from '../inference-client.js';
import { buildCallRecord } from '../inference-client.js';

export interface BuilderDeps {
  inference: InferenceClient;
}

export function createBuilderWorker(deps: BuilderDeps): WorkerContract {
  return {
    id: 'builder',
    accepts: 'building',
    requires: ['plan', 'workUnits'],
    produces: [],
    timeout: 180_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const workUnits = runState.getWorkUnits();
      const pending = workUnits.filter(wu => wu.status === 'pending');

      if (pending.length === 0) {
        return { status: 'done', artifacts: [], evidence: [] };
      }

      const allArtifacts: Array<{ name: string; path: string }> = [];

      for (const wu of pending) {
        const prompt = `Generate source code for work unit "${wu.id}": ${wu.description}\nFeatures: ${wu.featureIds.join(', ')}\n\nRespond with JSON: { "files": [{ "path": string, "content": string }] }`;

        const response = await deps.inference.complete({
          role: 'builder',
          prompt,
          systemPrompt: 'You are a code generator. Produce clean, typed code. Reply ONLY with valid JSON.',
          maxTokens: 16384,
          temperature: 0.2,
        });

        chain.append({
          type: 'llm_call',
          workerId: 'builder',
          stage: 'building',
          data: { ...buildCallRecord({ role: 'builder', prompt }, response) },
        });

        let files: Array<{ path: string; content: string }>;
        try {
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('no JSON in response');
          const parsed = JSON.parse(jsonMatch[0]) as { files: Array<{ path: string; content: string }> };
          if (!parsed.files || !Array.isArray(parsed.files)) throw new Error('no files array');
          files = parsed.files;
        } catch (err) {
          return {
            status: 'failed',
            reason: `build parse failed for ${wu.id}: ${(err as Error).message}`,
            evidence: [],
          };
        }

        for (const file of files) {
          if (!file.path || typeof file.content !== 'string') {
            return {
              status: 'failed',
              reason: `invalid file entry in ${wu.id}: missing path or content`,
              evidence: [],
            };
          }
        }

        const outputFiles = files.map(f => f.path);
        runState.updateWorkUnit(wu.id, { status: 'done', outputFiles });
        allArtifacts.push(...files.map(f => ({ name: f.path, path: f.path })));
      }

      return {
        status: 'done',
        artifacts: allArtifacts,
        evidence: [],
      };
    },
  };
}

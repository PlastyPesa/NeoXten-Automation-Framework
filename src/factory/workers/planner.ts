/**
 * Planner Worker — decomposes a Spec into a Plan with WorkUnit DAG.
 * Consults Consequence Memory for relevant failure patterns.
 * Uses LLM for reasoning (injected InferenceClient).
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { Plan, WorkUnitPlan } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';
import type { FactorySpec } from '../spec/schema.js';
import type { InferenceClient } from '../inference-client.js';
import { buildCallRecord } from '../inference-client.js';
import type { ConsequenceMemory } from '../consequence-memory.js';

export interface PlannerDeps {
  inference: InferenceClient;
  consequenceMemory?: ConsequenceMemory;
}

export function createPlannerWorker(deps: PlannerDeps): WorkerContract {
  return {
    id: 'planner',
    accepts: 'planning',
    requires: ['spec'],
    produces: ['plan'],
    timeout: 120_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const spec = runState.spec;

      if (deps.consequenceMemory) {
        const hits = deps.consequenceMemory.query({}, spec.product?.name as string);
        for (const hit of hits) {
          chain.append({
            type: 'consequence_hit',
            workerId: 'planner',
            stage: 'planning',
            data: {
              recordId: hit.id,
              pattern: hit.pattern,
              confidence: hit.confidence,
              stage: hit.stage,
            },
          });
        }
      }

      const prompt = buildPlannerPrompt(spec);
      const response = await deps.inference.complete({
        role: 'planner',
        prompt,
        systemPrompt: 'You are a software architect. Decompose the spec into ordered work units. Reply ONLY with valid JSON.',
        maxTokens: 8192,
        temperature: 0.1,
      });

      chain.append({
        type: 'llm_call',
        workerId: 'planner',
        stage: 'planning',
        data: { ...buildCallRecord({ role: 'planner', prompt }, response) },
      });

      let plan: Plan;
      try {
        plan = parsePlanResponse(response.text, spec);
      } catch (err) {
        return {
          status: 'failed',
          reason: `plan parsing failed: ${(err as Error).message}`,
          evidence: [],
        };
      }

      validatePlanCoverage(plan, spec);
      runState.setPlan(plan);

      return {
        status: 'done',
        artifacts: [{ name: 'plan.json', path: 'plan.json' }],
        evidence: [],
      };
    },
  };
}

function buildPlannerPrompt(spec: FactorySpec): string {
  const features = (spec.features as Array<{ id: string; description: string }>)
    .map(f => `- ${f.id}: ${f.description}`).join('\n');
  return `Decompose these features into work units with dependency ordering:\n${features}\n\nPlatforms: ${(spec.delivery as { targets: string[] }).targets.join(', ')}\n\nRespond with JSON: { "workUnits": [{ "id": string, "featureIds": string[], "description": string, "dependencies": string[] }], "techStack": {}, "fileStructure": string[] }`;
}

function parsePlanResponse(text: string, spec: FactorySpec): Plan {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('no JSON object found in LLM response');
  const parsed = JSON.parse(jsonMatch[0]) as Plan;
  if (!parsed.workUnits || !Array.isArray(parsed.workUnits) || parsed.workUnits.length === 0) {
    throw new Error('workUnits array missing or empty');
  }
  for (const wu of parsed.workUnits) {
    if (!wu.id || !wu.description || !Array.isArray(wu.featureIds) || !Array.isArray(wu.dependencies)) {
      throw new Error(`invalid work unit: ${JSON.stringify(wu)}`);
    }
  }
  if (!parsed.techStack) parsed.techStack = {};
  if (!parsed.fileStructure) parsed.fileStructure = [];
  return parsed;
}

function validatePlanCoverage(plan: Plan, spec: FactorySpec): void {
  const coveredFeatures = new Set(plan.workUnits.flatMap(wu => wu.featureIds));
  const allFeatures = (spec.features as Array<{ id: string }>).map(f => f.id);
  for (const fid of allFeatures) {
    if (!coveredFeatures.has(fid)) {
      throw new Error(`feature '${fid}' not covered by any work unit`);
    }
  }
}

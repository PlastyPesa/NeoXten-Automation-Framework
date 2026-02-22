/**
 * Pipeline Config — deterministic DAG-based pipeline definition.
 *
 * Defines execution order of Factory stages. Validates acyclicity,
 * dependency references, and RunState slice availability. Supports
 * stage insertion for extensibility. Serializable to Evidence Chain
 * as provenance for each run.
 *
 * The pipeline structure is derived from config, never from chat input.
 */

import { z } from 'zod';
import type { RunStateSlice } from './worker-contract.js';

/* ------------------------------------------------------------------ */
/*  Zod schema                                                         */
/* ------------------------------------------------------------------ */

const SLICE_VALUES = [
  'spec', 'plan', 'workUnits', 'buildOutput',
  'testResults', 'uiInspection', 'securityReport', 'releaseArtifacts',
] as const;

const StageConfigSchema = z.object({
  id:        z.string().min(1),
  worker:    z.string().min(1),
  gate:      z.string().nullable().default(null),
  dependsOn: z.array(z.string()).default([]),
  parallel:  z.boolean().default(false),
  requires:  z.array(z.enum(SLICE_VALUES)).default([]),
  produces:  z.array(z.enum(SLICE_VALUES)).default([]),
});

const PipelineConfigDataSchema = z.object({
  stages: z.array(StageConfigSchema).min(1),
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface StageConfig {
  readonly id: string;
  readonly worker: string;
  readonly gate: string | null;
  dependsOn: string[];
  readonly parallel: boolean;
  readonly requires: RunStateSlice[];
  readonly produces: RunStateSlice[];
}

export interface PipelineError {
  type: 'cycle' | 'unknown_dependency' | 'missing_slice' | 'unknown_worker'
      | 'unknown_gate' | 'duplicate_stage' | 'schema';
  message: string;
}

export interface CrossValidateInput {
  knownWorkers: string[];
  knownGates: string[];
}

/* ------------------------------------------------------------------ */
/*  Internal algorithms                                                */
/* ------------------------------------------------------------------ */

function detectCycle(stageMap: Map<string, StageConfig>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];

  for (const id of stageMap.keys()) color.set(id, WHITE);

  function dfs(u: string): string[] | null {
    color.set(u, GRAY);
    path.push(u);
    const stage = stageMap.get(u)!;
    for (const v of stage.dependsOn) {
      if (color.get(v) === GRAY) {
        const cycleStart = path.indexOf(v);
        const cycle = path.slice(cycleStart);
        cycle.push(v);
        return cycle;
      }
      if (color.get(v) === WHITE) {
        const result = dfs(v);
        if (result) return result;
      }
    }
    path.pop();
    color.set(u, BLACK);
    return null;
  }

  const sortedIds = Array.from(stageMap.keys()).sort();
  for (const id of sortedIds) {
    if (color.get(id) === WHITE) {
      const result = dfs(id);
      if (result) return result;
    }
  }
  return null;
}

function topologicalSort(stageMap: Map<string, StageConfig>): StageConfig[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const [id, stage] of stageMap) {
    inDegree.set(id, stage.dependsOn.length);
    if (!dependents.has(id)) dependents.set(id, []);
    for (const dep of stage.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: StageConfig[] = [];
  while (queue.length > 0) {
    queue.sort();
    const u = queue.shift()!;
    result.push(stageMap.get(u)!);
    for (const v of dependents.get(u) ?? []) {
      const newDeg = (inDegree.get(v) ?? 0) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  return result;
}

function validateSliceAvailability(
  order: StageConfig[],
): PipelineError[] {
  const errors: PipelineError[] = [];
  const available = new Set<RunStateSlice>(['spec']);

  for (const stage of order) {
    for (const req of stage.requires) {
      if (!available.has(req)) {
        errors.push({
          type: 'missing_slice',
          message: `stage '${stage.id}' requires slice '${req}' but no prior stage produces it`,
        });
      }
    }
    for (const prod of stage.produces) {
      available.add(prod);
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/*  PipelineConfig                                                     */
/* ------------------------------------------------------------------ */

export class PipelineConfig {
  private readonly stageMap: Map<string, StageConfig>;
  private cachedOrder: StageConfig[] | null = null;

  private constructor(stages: StageConfig[]) {
    this.stageMap = new Map(stages.map(s => [s.id, s]));
  }

  /**
   * Create a PipelineConfig from raw stage definitions.
   * Validates schema, checks for duplicate IDs, unknown dependencies,
   * cycles, and slice availability. Throws on first structural error.
   */
  static create(input: unknown): PipelineConfig {
    const parsed = PipelineConfigDataSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`pipeline schema error: ${issue.path.join('.')} — ${issue.message}`);
    }

    const stages = parsed.data.stages as StageConfig[];

    const ids = new Set<string>();
    for (const stage of stages) {
      if (ids.has(stage.id)) {
        throw new Error(`duplicate stage id: '${stage.id}'`);
      }
      ids.add(stage.id);
    }

    const stageMap = new Map(stages.map(s => [s.id, s]));

    for (const stage of stages) {
      for (const dep of stage.dependsOn) {
        if (!stageMap.has(dep)) {
          throw new Error(`unknown stage dependency: '${dep}' (referenced by '${stage.id}')`);
        }
      }
    }

    const cycle = detectCycle(stageMap);
    if (cycle) {
      throw new Error(`cycle detected: ${cycle.join(' -> ')}`);
    }

    const order = topologicalSort(stageMap);
    const sliceErrors = validateSliceAvailability(order);
    if (sliceErrors.length > 0) {
      throw new Error(sliceErrors[0].message);
    }

    return new PipelineConfig(stages);
  }

  /** Factory 1 default pipeline — deterministic, always the same 9 stages. */
  static defaultFactory1(): PipelineConfig {
    return PipelineConfig.create({
      stages: [
        {
          id: 'spec_validation', worker: 'spec-validator', gate: 'spec_valid',
          dependsOn: [], requires: ['spec'], produces: [],
        },
        {
          id: 'planning', worker: 'planner', gate: 'plan_complete',
          dependsOn: ['spec_validation'], requires: ['spec'], produces: ['plan', 'workUnits'],
        },
        {
          id: 'building', worker: 'builder', gate: null,
          dependsOn: ['planning'], parallel: true,
          requires: ['plan', 'workUnits'], produces: [],
        },
        {
          id: 'assembly', worker: 'assembler', gate: 'build_success',
          dependsOn: ['building'], requires: ['plan', 'workUnits'], produces: ['buildOutput'],
        },
        {
          id: 'testing', worker: 'tester', gate: 'tests_pass',
          dependsOn: ['assembly'], requires: ['buildOutput'], produces: ['testResults'],
        },
        {
          id: 'ui_inspection', worker: 'ui-inspector', gate: 'visual_qa',
          dependsOn: ['testing'], requires: ['testResults'], produces: ['uiInspection'],
        },
        {
          id: 'security_audit', worker: 'security-auditor', gate: 'security_clear',
          dependsOn: ['ui_inspection'], requires: ['buildOutput'], produces: ['securityReport'],
        },
        {
          id: 'release_package', worker: 'release-packager', gate: 'artifact_ready',
          dependsOn: ['security_audit'],
          requires: ['securityReport', 'buildOutput'], produces: ['releaseArtifacts'],
        },
        {
          id: 'run_audit', worker: 'run-auditor', gate: 'manifest_valid',
          dependsOn: ['release_package'], requires: ['releaseArtifacts'], produces: [],
        },
      ],
    });
  }

  getStage(stageId: string): StageConfig {
    const stage = this.stageMap.get(stageId);
    if (!stage) throw new Error(`stage '${stageId}' not found`);
    return stage;
  }

  getExecutionOrder(): StageConfig[] {
    if (!this.cachedOrder) {
      this.cachedOrder = topologicalSort(this.stageMap);
    }
    return this.cachedOrder;
  }

  /**
   * Insert a new stage into the DAG after `afterStageId`.
   * Stages that previously depended on `afterStageId` are rewired
   * to depend on the new stage, placing it inline in the chain.
   */
  insertStage(input: unknown, afterStageId: string): void {
    if (!this.stageMap.has(afterStageId)) {
      throw new Error(`cannot insert after unknown stage: '${afterStageId}'`);
    }

    const parsed = StageConfigSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`stage schema error: ${issue.path.join('.')} — ${issue.message}`);
    }

    const newStage = parsed.data as StageConfig;

    if (this.stageMap.has(newStage.id)) {
      throw new Error(`duplicate stage id: '${newStage.id}'`);
    }

    newStage.dependsOn = [afterStageId];

    for (const [, existing] of this.stageMap) {
      const idx = existing.dependsOn.indexOf(afterStageId);
      if (idx !== -1) {
        existing.dependsOn[idx] = newStage.id;
      }
    }

    this.stageMap.set(newStage.id, newStage);

    const cycle = detectCycle(this.stageMap);
    if (cycle) {
      this.stageMap.delete(newStage.id);
      throw new Error(`cycle detected after insertion: ${cycle.join(' -> ')}`);
    }

    const order = topologicalSort(this.stageMap);
    const sliceErrors = validateSliceAvailability(order);
    if (sliceErrors.length > 0) {
      this.stageMap.delete(newStage.id);
      throw new Error(sliceErrors[0].message);
    }

    this.cachedOrder = null;
  }

  /**
   * Cross-validate pipeline against known worker and gate registrations.
   * Returns errors for any worker or gate referenced in config but not
   * present in the provided lists.
   */
  crossValidate(input: CrossValidateInput): PipelineError[] {
    const errors: PipelineError[] = [];
    const workerSet = new Set(input.knownWorkers);
    const gateSet = new Set(input.knownGates);

    for (const stage of this.stageMap.values()) {
      if (!workerSet.has(stage.worker)) {
        errors.push({
          type: 'unknown_worker',
          message: `stage '${stage.id}' references unknown worker '${stage.worker}'`,
        });
      }
      if (stage.gate !== null && !gateSet.has(stage.gate)) {
        errors.push({
          type: 'unknown_gate',
          message: `stage '${stage.id}' references unknown gate '${stage.gate}'`,
        });
      }
    }

    return errors;
  }

  stageCount(): number {
    return this.stageMap.size;
  }

  /** Serializable snapshot for Evidence Chain provenance. */
  toEvidence(): Record<string, unknown> {
    return {
      stageCount: this.stageMap.size,
      stages: this.getExecutionOrder().map(s => ({
        id: s.id,
        worker: s.worker,
        gate: s.gate,
        dependsOn: s.dependsOn,
        parallel: s.parallel,
        requires: s.requires,
        produces: s.produces,
      })),
    };
  }
}

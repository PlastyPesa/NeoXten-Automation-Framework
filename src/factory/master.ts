/**
 * Master Controller — deterministic finite automaton driving the Factory pipeline.
 *
 * Dispatches workers, evaluates gates, transitions states. Never uses LLM
 * reasoning. Its only decisions are: dispatch next worker, or halt.
 *
 * Every state transition is logged to the Evidence Chain. No method exists
 * to skip a gate or force a transition. Gate FAIL → Aborted, always.
 *
 * Supports resume from a persisted RunState + EvidenceChain.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceChain } from './evidence-chain.js';
import type { RunStage } from './evidence-chain.js';
import { RunState } from './run-state.js';
import type { FactorySpec } from './spec/schema.js';
import { WorkerRegistry } from './worker-registry.js';
import type { WorkerResult } from './worker-contract.js';
import { GateRegistry } from './gate-registry.js';
import type { GateEvidence } from './gate-registry.js';
import { PipelineConfig } from './pipeline-config.js';
import type { StageConfig } from './pipeline-config.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MasterOptions {
  maxRetries: number;
}

export interface RunInit {
  runId?: string;
  spec: FactorySpec;
  persistDir: string;
}

export interface RunResult {
  runId: string;
  status: 'shipped' | 'aborted';
  specHash: string;
  stageReached: string;
  gatesPassed: number;
  gatesFailed: number;
  totalStages: number;
  abortReason?: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  Master Controller                                                  */
/* ------------------------------------------------------------------ */

export class MasterController {
  constructor(
    private readonly workers: WorkerRegistry,
    private readonly gates: GateRegistry,
    private readonly pipeline: PipelineConfig,
    private readonly options: MasterOptions = { maxRetries: 2 },
  ) {}

  /** Start a new run from scratch. */
  async run(init: RunInit): Promise<RunResult> {
    const runId = init.runId ?? randomUUID();
    const evidenceChainPath = `${init.persistDir}/evidence-chain.ndjson`;
    const runState = new RunState({
      runId,
      spec: init.spec,
      evidenceChainPath,
      persistDir: init.persistDir,
    });
    const chain = new EvidenceChain();

    chain.append({
      type: 'run_start',
      workerId: 'master',
      stage: 'initializing',
      data: {
        runId,
        specHash: runState.specHash,
        pipeline: this.pipeline.toEvidence(),
        maxRetries: this.options.maxRetries,
      },
    });
    this.persistChain(chain, evidenceChainPath);

    return this.executeLoop(runState, chain, Date.now());
  }

  /** Resume an interrupted run from persisted state. */
  async resume(runStatePath: string): Promise<RunResult> {
    const runState = RunState.load(runStatePath);
    if (runState.status !== 'running') {
      throw new Error(`cannot resume run with status '${runState.status}'`);
    }

    const chain = EvidenceChain.readFromFile(runState.evidenceChainPath);

    chain.append({
      type: 'note',
      workerId: 'master',
      stage: runState.currentStage,
      data: { event: 'run_resumed', runId: runState.runId },
    });
    this.persistChain(chain, runState.evidenceChainPath);

    return this.executeLoop(runState, chain, Date.now());
  }

  /* ---- Core loop ---- */

  private async executeLoop(
    runState: RunState,
    chain: EvidenceChain,
    startTime: number,
  ): Promise<RunResult> {
    const stages = this.pipeline.getExecutionOrder();

    for (const stage of stages) {
      if (this.isStageComplete(stage, runState)) continue;

      const stageId = stage.id as RunStage;

      runState.setCurrentStage(stageId);
      runState.stageStart(stage.id);
      chain.append({
        type: 'note',
        workerId: 'master',
        stage: stageId,
        data: { event: 'stage_start', stageId: stage.id },
      });

      const workerResult = await this.dispatchWithRetry(stage, runState, chain);

      runState.stageEnd(stage.id);
      chain.append({
        type: 'note',
        workerId: 'master',
        stage: stageId,
        data: { event: 'stage_end', stageId: stage.id, workerStatus: workerResult.status },
      });
      this.persistChain(chain, runState.evidenceChainPath);

      if (stage.gate) {
        const evidence: GateEvidence = {
          workerStatus: workerResult.status,
          workerReason: workerResult.status === 'failed' ? workerResult.reason : undefined,
          runState: runState.toJSON(),
        };
        const gateResult = this.gates.evaluate(stage.gate, evidence, chain, stageId);

        runState.addGateResult({
          gateId: gateResult.gateId,
          passed: gateResult.passed,
          timestamp: gateResult.timestamp,
          checks: gateResult.checks,
        });
        this.persistChain(chain, runState.evidenceChainPath);

        if (!gateResult.passed) {
          const abortReason = `gate '${stage.gate}' failed at stage '${stage.id}'`;
          runState.setStatus('aborted');
          chain.append({
            type: 'run_end',
            workerId: 'master',
            stage: stageId,
            data: { status: 'aborted', reason: abortReason },
          });
          this.persistChain(chain, runState.evidenceChainPath);
          return {
            runId: runState.runId,
            status: 'aborted',
            specHash: runState.specHash,
            stageReached: stage.id,
            gatesPassed: runState.getGateResults().filter(g => g.passed).length,
            gatesFailed: runState.getGateResults().filter(g => !g.passed).length,
            totalStages: stages.length,
            abortReason,
            durationMs: Date.now() - startTime,
          };
        }
      }
    }

    runState.setStatus('shipped');
    chain.append({
      type: 'run_end',
      workerId: 'master',
      stage: 'run_audit',
      data: { status: 'shipped' },
    });
    this.persistChain(chain, runState.evidenceChainPath);

    return {
      runId: runState.runId,
      status: 'shipped',
      specHash: runState.specHash,
      stageReached: 'run_audit',
      gatesPassed: runState.getGateResults().filter(g => g.passed).length,
      gatesFailed: 0,
      totalStages: stages.length,
      durationMs: Date.now() - startTime,
    };
  }

  /* ---- Worker dispatch with bounded retry ---- */

  private async dispatchWithRetry(
    stage: StageConfig,
    runState: RunState,
    chain: EvidenceChain,
  ): Promise<WorkerResult> {
    const stageId = stage.id as RunStage;
    let attempts = 0;

    while (true) {
      attempts++;
      chain.append({
        type: 'worker_start',
        workerId: stage.worker,
        stage: stageId,
        data: { attempt: attempts, stageId: stage.id },
      });

      try {
        const result = await this.workers.dispatch(stage.worker, {}, runState, chain);

        chain.append({
          type: 'worker_end',
          workerId: stage.worker,
          stage: stageId,
          data: {
            status: result.status,
            attempt: attempts,
            ...(result.status === 'done'
              ? { artifactCount: result.artifacts.length }
              : { reason: result.reason }),
          },
        });

        return result;
      } catch (err) {
        const errorMsg = (err as Error).message;
        chain.append({
          type: 'error',
          workerId: stage.worker,
          stage: stageId,
          data: { error: errorMsg, attempt: attempts },
        });

        if (attempts >= this.options.maxRetries) {
          chain.append({
            type: 'worker_end',
            workerId: stage.worker,
            stage: stageId,
            data: {
              status: 'failed',
              reason: `retries exhausted (${attempts}/${this.options.maxRetries}): ${errorMsg}`,
              attempt: attempts,
            },
          });
          return {
            status: 'failed',
            reason: `retries exhausted (${attempts}/${this.options.maxRetries}): ${errorMsg}`,
            evidence: [],
          };
        }

        chain.append({
          type: 'note',
          workerId: 'master',
          stage: stageId,
          data: { event: 'retry_scheduled', attempt: attempts, maxRetries: this.options.maxRetries },
        });
      }
    }
  }

  /* ---- Helpers ---- */

  private isStageComplete(stage: StageConfig, runState: RunState): boolean {
    if (stage.gate) {
      return runState.getGateResult(stage.gate) !== undefined;
    }
    const ts = runState.getTimestamps();
    return ts[stage.id]?.end !== undefined;
  }

  private persistChain(chain: EvidenceChain, filePath: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
    chain.writeToFile(filePath);
  }
}

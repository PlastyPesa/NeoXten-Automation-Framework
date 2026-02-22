/**
 * RunManifest — final tamper-evident output of a Factory Run.
 *
 * Built deterministically from RunState + Evidence Chain.
 * Contains: run metadata, spec hash, pipeline summary, gate verdicts,
 * artifact hashes, LLM usage totals, evidence chain hash, and timing.
 *
 * The manifest is the single document that proves what happened.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RunState } from './run-state.js';
import type { EvidenceChain } from './evidence-chain.js';
import { stableStringify } from './evidence-chain.js';

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

export const GateVerdictSchema = z.object({
  gateId: z.string(),
  passed: z.boolean(),
  timestamp: z.string(),
});

export const ArtifactHashSchema = z.object({
  platform: z.string(),
  path: z.string(),
  sha256: z.string().length(64),
  sizeBytes: z.number(),
});

export const LLMUsageSchema = z.object({
  totalCalls: z.number(),
  totalPromptTokens: z.number(),
  totalCompletionTokens: z.number(),
  totalDurationMs: z.number(),
  models: z.array(z.string()),
});

export const StageSummarySchema = z.object({
  stageId: z.string(),
  workerId: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  gateId: z.string().optional(),
  gatePassed: z.boolean().optional(),
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal('2026.1'),
  runId: z.string(),
  status: z.enum(['shipped', 'aborted']),
  specHash: z.string().length(64),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  stages: z.array(StageSummarySchema),
  gateVerdicts: z.array(GateVerdictSchema),
  artifactHashes: z.array(ArtifactHashSchema),
  llmUsage: LLMUsageSchema,
  evidenceChainHash: z.string().length(64),
  evidenceChainLength: z.number(),
  consequenceHitCount: z.number(),
  manifestHash: z.string().length(64),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

/* ------------------------------------------------------------------ */
/*  Builder                                                            */
/* ------------------------------------------------------------------ */

export function buildManifest(runState: RunState, chain: EvidenceChain): RunManifest {
  const timeline = chain.getTimeline();

  const runStartEntry = timeline.find(e => e.type === 'run_start');
  const runEndEntry = [...timeline].reverse().find(e => e.type === 'run_end');
  const startedAt = runStartEntry?.timestamp ?? new Date().toISOString();
  const completedAt = runEndEntry?.timestamp ?? new Date().toISOString();
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt).getTime();

  const gateVerdicts = runState.getGateResults().map(g => ({
    gateId: g.gateId,
    passed: g.passed,
    timestamp: g.timestamp,
  }));

  const artifactHashes = runState.getReleaseArtifacts().map(a => ({
    platform: a.platform,
    path: a.path,
    sha256: a.sha256,
    sizeBytes: a.sizeBytes,
  }));

  const llmEntries = timeline.filter(e => e.type === 'llm_call');
  const llmUsage: z.infer<typeof LLMUsageSchema> = {
    totalCalls: llmEntries.length,
    totalPromptTokens: sum(llmEntries, 'promptTokens'),
    totalCompletionTokens: sum(llmEntries, 'completionTokens'),
    totalDurationMs: sum(llmEntries, 'durationMs'),
    models: [...new Set(llmEntries.map(e => (e.data as Record<string, unknown>).model as string))],
  };

  const timestamps = runState.getTimestamps();
  const stages: z.infer<typeof StageSummarySchema>[] = Object.entries(timestamps).map(([stageId, ts]) => {
    const gate = gateVerdicts.find(g => matchStageGate(stageId, g.gateId));
    const stageStart = timeline.find(e => e.type === 'note' && e.stage === stageId && (e.data as Record<string, unknown>).event === 'stage_start');
    const workerId = stageStart ? (stageStart.data as Record<string, unknown>).workerId as string : undefined;
    const dMs = ts.start && ts.end ? new Date(ts.end).getTime() - new Date(ts.start).getTime() : undefined;
    return {
      stageId,
      workerId,
      startedAt: ts.start,
      endedAt: ts.end,
      durationMs: dMs,
      gateId: gate?.gateId,
      gatePassed: gate?.passed,
    };
  });

  const lastHash = chain.getLastHash();
  const evidenceChainHash = lastHash ?? createHash('sha256').update('empty', 'utf-8').digest('hex');

  const preHashManifest = {
    schemaVersion: '2026.1' as const,
    runId: runState.runId,
    status: runState.status as 'shipped' | 'aborted',
    specHash: runState.specHash,
    startedAt,
    completedAt,
    durationMs: endMs - startMs,
    stages,
    gateVerdicts,
    artifactHashes,
    llmUsage,
    evidenceChainHash,
    evidenceChainLength: chain.length,
    consequenceHitCount: runState.getConsequenceHits().length,
    manifestHash: '',
  };

  preHashManifest.manifestHash = createHash('sha256')
    .update(stableStringify(preHashManifest), 'utf-8')
    .digest('hex');

  return preHashManifest;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sum(entries: Array<{ data: Record<string, unknown> }>, field: string): number {
  return entries.reduce((acc, e) => acc + (Number((e.data as Record<string, unknown>)[field]) || 0), 0);
}

const STAGE_GATE_MAP: Record<string, string> = {
  spec_validation: 'spec_valid',
  planning: 'plan_complete',
  assembly: 'build_success',
  testing: 'tests_pass',
  ui_inspection: 'visual_qa',
  security_audit: 'security_clear',
  release_package: 'artifact_ready',
  run_audit: 'manifest_valid',
};

function matchStageGate(stageId: string, gateId: string): boolean {
  return STAGE_GATE_MAP[stageId] === gateId;
}

export type VerdictStatus = 'PASS' | 'FAIL';
export type FailingStage = 'launch' | 'ui_flow' | 'assistant' | 'gate' | null;

export interface Verdict {
  verdict: VerdictStatus;
  exitCode: 0 | 1 | 2;
  runId: string;
  timestamp: string;
  failingStage: FailingStage;
  failingFlow: string | null;
  failingStep: number;
  measured: Record<string, number>;
  thresholds: Record<string, number>;
  artifactPaths: Record<string, string | string[]>;
  logExcerpts: string[];
  sourceHints: string[];
  reproducibleCommand: string;
  flaky: boolean;
  inferenceAccounting?: {
    expectedBackendInvocations: number;
    actualBackendInvocations: number;
    expectedLlamaSpawns: number;
    actualLlamaSpawns: number;
    llamaCliEvidenceExcerpt?: string;
    callCounts?: Record<string, number>;
  };
}

export function buildVerdict(partial: Partial<Verdict> & { verdict: VerdictStatus; runId: string }): Verdict {
  const now = new Date().toISOString();
  return {
    verdict: partial.verdict,
    exitCode: partial.exitCode ?? (partial.verdict === 'PASS' ? 0 : 1),
    runId: partial.runId,
    timestamp: partial.timestamp ?? now,
    failingStage: partial.failingStage ?? null,
    failingFlow: partial.failingFlow ?? null,
    failingStep: partial.failingStep ?? 0,
    measured: partial.measured ?? {},
    thresholds: partial.thresholds ?? {},
    artifactPaths: partial.artifactPaths ?? {},
    logExcerpts: partial.logExcerpts ?? [],
    sourceHints: partial.sourceHints ?? [],
    reproducibleCommand: partial.reproducibleCommand ?? 'neoxten run --config ./neoxten.yaml',
    flaky: partial.flaky ?? false,
    inferenceAccounting: partial.inferenceAccounting,
  };
}

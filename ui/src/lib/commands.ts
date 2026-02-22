/**
 * TypeScript types matching the Rust FactoryCommand enum exactly.
 * These are the ONLY operations the UI can request.
 */

export type FactoryCommand =
  | { type: "GetRunStatus" }
  | { type: "GetGateResults" }
  | { type: "GetEvidenceEntry"; params: { seq: number } }
  | { type: "GetEvidenceRange"; params: { from: number; to: number } }
  | { type: "GetArtifact"; params: { path: string } }
  | { type: "GetConsequenceMemory"; params: { domain?: string } }
  | { type: "GetRunHistory" }
  | { type: "StartRun"; params: { specPath: string; blueprintPath?: string } }
  | { type: "AbortRun"; params: { runId: string } }
  | { type: "ValidateSpec"; params: { specPath: string } }
  | { type: "DeriveSpecFromPlan"; params: { planText: string } };

export interface RunStatus {
  runId: string;
  status: "running" | "shipped" | "aborted";
  currentStage: string;
  gatesPassed: number;
  gatesFailed: number;
  durationMs: number;
}

export interface GateResult {
  gateId: string;
  passed: boolean;
  timestamp: string;
  checks: Array<{ name: string; passed: boolean; measured: number; threshold: number }>;
}

export interface RunHistoryEntry {
  runId: string;
  status: string;
  startedAt: string;
  durationMs: number;
}

export interface SpecValidationResult {
  valid: boolean;
  errors: string[];
}

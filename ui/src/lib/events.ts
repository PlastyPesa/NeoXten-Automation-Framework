/**
 * TypeScript types for Factory NDJSON events emitted by the Rust backend.
 */

export interface RunStartedEvent {
  runId: string;
  specHash: string;
  timestamp: string;
}

export interface StageChangedEvent {
  stage: string;
  status: "started" | "completed" | "failed";
  timestamp: string;
}

export interface WorkerProgressEvent {
  workerId: string;
  message: string;
  progress?: number;
  timestamp: string;
}

export interface GateResultEvent {
  gateId: string;
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; measured: number; threshold: number }>;
  timestamp: string;
}

export interface EvidenceEntryEvent {
  seq: number;
  type: string;
  workerId: string;
  stage: string;
  hash: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface ArtifactProducedEvent {
  path: string;
  sha256: string;
  type: string;
  timestamp: string;
}

export interface RunCompletedEvent {
  runId: string;
  status: "shipped" | "aborted";
  manifestPath: string;
  timestamp: string;
}

export interface FactoryErrorEvent {
  message: string;
  stage?: string;
  workerId?: string;
  timestamp: string;
}

export type FactoryEventMap = {
  "factory://run-started": RunStartedEvent;
  "factory://stage-changed": StageChangedEvent;
  "factory://worker-progress": WorkerProgressEvent;
  "factory://gate-result": GateResultEvent;
  "factory://evidence-entry": EvidenceEntryEvent;
  "factory://artifact-produced": ArtifactProducedEvent;
  "factory://run-completed": RunCompletedEvent;
  "factory://error": FactoryErrorEvent;
};

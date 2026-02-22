import { invoke } from "@tauri-apps/api/core";
import type { RunStatus, GateResult, RunHistoryEntry, SpecValidationResult } from "../lib/commands";

export function useFactoryCommand() {
  return {
    startRun: (specPath: string, blueprintPath?: string) =>
      invoke<string>("start_run", { specPath, blueprintPath }),

    abortRun: (runId: string) =>
      invoke<string>("abort_run", { runId }),

    getRunStatus: (runId: string) =>
      invoke<RunStatus>("get_run_status", { runId }),

    getRunHistory: () =>
      invoke<RunHistoryEntry[]>("get_run_history"),

    getGateResults: (runId: string) =>
      invoke<GateResult[]>("get_gate_results", { runId }),

    getEvidenceRange: (runId: string, from: number, to: number) =>
      invoke<unknown[]>("get_evidence_range", { runId, from, to }),

    validateSpec: (specPath: string) =>
      invoke<SpecValidationResult>("validate_spec", { specPath }),
  };
}

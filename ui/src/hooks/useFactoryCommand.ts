import { invoke } from "@tauri-apps/api/core";
import type { RunStatus, GateResult, RunHistoryEntry, SpecValidationResult } from "../lib/commands";

function inTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Factory IPC — no `invoke` in plain browser (Operator web / Playwright) to avoid touching Tauri internals. */
export function useFactoryCommand() {
  return {
    startRun: (specPath: string, blueprintPath?: string) =>
      inTauriShell()
        ? invoke<string>("start_run", { specPath, blueprintPath })
        : Promise.reject(new Error("Factory start_run requires Tauri")),

    abortRun: (runId: string) =>
      inTauriShell() ? invoke<string>("abort_run", { runId }) : Promise.reject(new Error("Tauri only")),

    getRunStatus: (runId: string) =>
      inTauriShell()
        ? invoke<RunStatus>("get_run_status", { runId })
        : Promise.reject(new Error("Tauri only")),

    getRunHistory: () =>
      inTauriShell() ? invoke<RunHistoryEntry[]>("get_run_history") : Promise.resolve([]),

    getGateResults: (runId: string) =>
      inTauriShell()
        ? invoke<GateResult[]>("get_gate_results", { runId })
        : Promise.resolve([]),

    getEvidenceRange: (runId: string, from: number, to: number) =>
      inTauriShell()
        ? invoke<unknown[]>("get_evidence_range", { runId, from, to })
        : Promise.resolve([]),

    validateSpec: (specPath: string) =>
      inTauriShell()
        ? invoke<SpecValidationResult>("validate_spec", { specPath })
        : Promise.reject(new Error("Tauri only")),
  };
}

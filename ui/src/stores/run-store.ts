import { create } from "zustand";
import type {
  StageChangedEvent,
  GateResultEvent,
  EvidenceEntryEvent,
  RunCompletedEvent,
} from "../lib/events";

interface StageState {
  stage: string;
  status: "pending" | "started" | "completed" | "failed";
}

interface RunStore {
  runId: string | null;
  status: "idle" | "running" | "shipped" | "aborted";
  specHash: string | null;
  stages: StageState[];
  gateResults: GateResultEvent[];
  evidenceEntries: EvidenceEntryEvent[];
  error: string | null;

  setRunStarted: (runId: string, specHash: string) => void;
  addStageChanged: (event: StageChangedEvent) => void;
  addGateResult: (event: GateResultEvent) => void;
  addEvidenceEntry: (event: EvidenceEntryEvent) => void;
  setRunCompleted: (event: RunCompletedEvent) => void;
  setError: (message: string) => void;
  reset: () => void;
}

const PIPELINE_STAGES = [
  "spec_validation", "planning", "building", "assembly",
  "testing", "ui_inspection", "security_audit", "release_package", "run_audit",
];

export const useRunStore = create<RunStore>((set) => ({
  runId: null,
  status: "idle",
  specHash: null,
  stages: PIPELINE_STAGES.map((s) => ({ stage: s, status: "pending" })),
  gateResults: [],
  evidenceEntries: [],
  error: null,

  setRunStarted: (runId, specHash) =>
    set({
      runId,
      specHash,
      status: "running",
      stages: PIPELINE_STAGES.map((s) => ({ stage: s, status: "pending" })),
      gateResults: [],
      evidenceEntries: [],
      error: null,
    }),

  addStageChanged: (event) =>
    set((state) => ({
      stages: state.stages.map((s) =>
        s.stage === event.stage ? { ...s, status: event.status as StageState["status"] } : s,
      ),
    })),

  addGateResult: (event) =>
    set((state) => ({ gateResults: [...state.gateResults, event] })),

  addEvidenceEntry: (event) =>
    set((state) => ({ evidenceEntries: [...state.evidenceEntries, event] })),

  setRunCompleted: (event) =>
    set({ status: event.status, runId: event.runId }),

  setError: (message) => set({ error: message }),

  reset: () =>
    set({
      runId: null,
      status: "idle",
      specHash: null,
      stages: PIPELINE_STAGES.map((s) => ({ stage: s, status: "pending" })),
      gateResults: [],
      evidenceEntries: [],
      error: null,
    }),
}));

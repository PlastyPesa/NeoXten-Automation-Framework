import { create } from "zustand";
import type { RunHistoryEntry } from "../lib/commands";

interface HistoryStore {
  runs: RunHistoryEntry[];
  loading: boolean;
  setRuns: (runs: RunHistoryEntry[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  runs: [],
  loading: false,
  setRuns: (runs) => set({ runs, loading: false }),
  setLoading: (loading) => set({ loading }),
}));

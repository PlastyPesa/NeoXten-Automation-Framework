import type { EvidenceEntryEvent } from "../../lib/events";
import { HashBadge } from "./HashBadge";

interface ChainTimelineProps {
  entries: EvidenceEntryEvent[];
  "data-testid"?: string;
}

const typeColors: Record<string, string> = {
  run_start: "text-blue-400",
  worker_start: "text-amber-400",
  worker_end: "text-amber-300",
  gate_pass: "text-emerald-400",
  gate_fail: "text-rose-400",
  artifact_produced: "text-violet-400",
  llm_call: "text-cyan-400",
  error: "text-rose-500",
  note: "text-zinc-400",
  consequence_hit: "text-orange-400",
  run_end: "text-blue-300",
};

export function ChainTimeline({ entries, ...props }: ChainTimelineProps) {
  return (
    <div data-testid={props["data-testid"]} className="space-y-1 max-h-[600px] overflow-y-auto">
      {entries.map((entry) => (
        <div
          key={entry.seq}
          className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors"
        >
          <span className="text-[10px] font-mono text-zinc-600 w-8 text-right shrink-0 pt-0.5">
            #{entry.seq}
          </span>
          <div className="w-px h-6 bg-white/10 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${typeColors[entry.type] ?? "text-zinc-400"}`}>
                {entry.type}
              </span>
              <span className="text-[10px] text-zinc-600">{entry.stage}</span>
              <span className="text-[10px] text-zinc-700">{entry.workerId}</span>
            </div>
            <div className="mt-0.5">
              <HashBadge hash={entry.hash} />
            </div>
          </div>
          <span className="text-[10px] text-zinc-600 shrink-0">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      ))}
      {entries.length === 0 && (
        <p className="text-sm text-zinc-600 text-center py-8">No evidence entries yet</p>
      )}
    </div>
  );
}

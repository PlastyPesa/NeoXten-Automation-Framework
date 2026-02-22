import { Panel } from "../components/glass/Panel";
import { ChainTimeline } from "../components/evidence/ChainTimeline";
import { HashBadge } from "../components/evidence/HashBadge";
import { useRunStore } from "../stores/run-store";

export function Evidence() {
  const { evidenceEntries, runId } = useRunStore();
  const lastEntry = evidenceEntries[evidenceEntries.length - 1];

  return (
    <div data-testid="evidence-view" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Evidence</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{evidenceEntries.length} entries</span>
          {lastEntry && <HashBadge hash={lastEntry.hash} label="HEAD" />}
        </div>
      </div>

      <Panel title="Evidence Chain" data-testid="evidence-chain-panel">
        <ChainTimeline entries={evidenceEntries} data-testid="evidence-timeline" />
      </Panel>

      {runId && (
        <div className="text-[10px] text-zinc-700 font-mono text-center">
          Run: {runId}
        </div>
      )}
    </div>
  );
}

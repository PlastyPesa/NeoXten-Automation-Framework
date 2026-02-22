import { useCallback } from "react";
import { Panel } from "../components/glass/Panel";
import { Badge } from "../components/glass/Badge";
import { StageNode } from "../components/pipeline/StageNode";
import { GateIndicator } from "../components/pipeline/GateIndicator";
import { useRunStore } from "../stores/run-store";
import { useTauriEvent } from "../hooks/useTauriEvents";

export function Pipeline() {
  const { stages, gateResults, status, runId, specHash, addStageChanged, addGateResult, addEvidenceEntry, setRunCompleted, setError } = useRunStore();

  useTauriEvent("factory://stage-changed", useCallback(addStageChanged, [addStageChanged]));
  useTauriEvent("factory://gate-result", useCallback(addGateResult, [addGateResult]));
  useTauriEvent("factory://evidence-entry", useCallback(addEvidenceEntry, [addEvidenceEntry]));
  useTauriEvent("factory://run-completed", useCallback(setRunCompleted, [setRunCompleted]));
  useTauriEvent("factory://error", useCallback((e) => setError(e.message), [setError]));

  const statusVariant = status === "shipped" ? "pass" : status === "aborted" ? "fail" : status === "running" ? "running" : "pending";

  return (
    <div data-testid="pipeline-view" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Pipeline</h1>
        <div className="flex items-center gap-3">
          {specHash && (
            <span className="font-mono text-[10px] text-zinc-600">
              spec:{specHash.slice(0, 8)}
            </span>
          )}
          <Badge variant={statusVariant}>{status}</Badge>
        </div>
      </div>

      <Panel title="Execution Pipeline" data-testid="pipeline-stages">
        <div className="flex items-center overflow-x-auto py-2">
          {stages.map((s, i) => (
            <StageNode
              key={s.stage}
              name={s.stage}
              status={s.status}
              isLast={i === stages.length - 1}
              data-testid={`stage-${s.stage}`}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Gate Results" data-testid="gate-results">
        {gateResults.length === 0 ? (
          <p className="text-sm text-zinc-600">No gate results yet</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {gateResults.map((g) => (
              <GateIndicator
                key={g.gateId}
                gateId={g.gateId}
                passed={g.passed}
                data-testid={`gate-${g.gateId}`}
              />
            ))}
          </div>
        )}
      </Panel>

      {runId && (
        <div className="text-[10px] text-zinc-700 font-mono text-center">
          Run: {runId}
        </div>
      )}
    </div>
  );
}

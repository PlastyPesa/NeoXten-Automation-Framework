import { useCallback, useEffect } from "react";
import { Card } from "../components/glass/Card";
import { Badge } from "../components/glass/Badge";
import { Button } from "../components/glass/Button";
import { useHistoryStore } from "../stores/history-store";
import { useRunStore } from "../stores/run-store";
import { useFactoryCommand } from "../hooks/useFactoryCommand";

interface DashboardProps {
  onNavigate: (view: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { runs, loading, setRuns, setLoading } = useHistoryStore();
  const { status, runId } = useRunStore();
  const commands = useFactoryCommand();

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const history = await commands.getRunHistory();
      setRuns(history);
    } catch {
      setRuns([]);
    }
  }, [commands, setRuns, setLoading]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const statusVariant = status === "shipped" ? "pass" : status === "aborted" ? "fail" : status === "running" ? "running" : "pending";

  return (
    <div data-testid="dashboard-view" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Factory</h1>
        <Button data-testid="new-run-btn" onClick={() => onNavigate("import")}>
          New Run
        </Button>
      </div>

      {status !== "idle" && (
        <Card data-testid="active-run-card" className="border-amber-400/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">Active Run</p>
              <p className="font-mono text-xs text-zinc-500 mt-1">{runId}</p>
            </div>
            <Badge variant={statusVariant}>{status}</Badge>
          </div>
          <Button
            variant="ghost"
            className="mt-4"
            data-testid="view-pipeline-btn"
            onClick={() => onNavigate("pipeline")}
          >
            View Pipeline
          </Button>
        </Card>
      )}

      <Card data-testid="history-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide">
            Recent Runs
          </h2>
          <Button variant="ghost" onClick={loadHistory} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>

        {runs.length === 0 ? (
          <p className="text-sm text-zinc-600 text-center py-6">No runs yet</p>
        ) : (
          <div className="space-y-2">
            {runs.slice(0, 10).map((run) => (
              <div
                key={run.runId}
                className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer"
                onClick={() => onNavigate("pipeline")}
              >
                <div>
                  <p className="font-mono text-xs text-zinc-400">{run.runId.slice(0, 8)}...</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{run.startedAt}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-zinc-600">{run.durationMs}ms</span>
                  <Badge variant={run.status === "shipped" ? "pass" : run.status === "aborted" ? "fail" : "pending"}>
                    {run.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

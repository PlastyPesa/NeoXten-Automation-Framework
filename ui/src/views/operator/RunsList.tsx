import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/glass/Card";
import { Badge } from "../../components/glass/Badge";
import { Button } from "../../components/glass/Button";
import { opFetch } from "../../lib/operator-api";

interface RunRow {
  id: string;
  neoxtenRunId: string;
  status: string;
  exitCode: number;
  completedAt: string;
  configPath: string;
}

export function OperatorRunsList(props: { onOpenRun: (id: string) => void }) {
  const [runs, setRuns] = useState<RunRow[]>([]);

  const load = useCallback(async () => {
    const r = await opFetch<{ runs: RunRow[] }>("/api/runs");
    setRuns(r.runs);
  }, []);

  useEffect(() => {
    void load().catch(() => setRuns([]));
  }, [load]);

  return (
    <div className="space-y-6" data-testid="operator-runs">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Runs</h1>
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-zinc-300">
            <thead className="text-xs uppercase text-zinc-500 border-b border-white/5">
              <tr>
                <th className="py-2 pr-4">Run ID</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Exit</th>
                <th className="py-2 pr-4">Completed</th>
                <th className="py-2">Config</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer"
                  onClick={() => props.onOpenRun(run.id)}
                >
                  <td className="py-2 pr-4 font-mono text-xs">{run.neoxtenRunId}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={run.status === "passed" ? "pass" : "fail"}>{run.status}</Badge>
                  </td>
                  <td className="py-2 pr-4">{run.exitCode}</td>
                  <td className="py-2 pr-4 text-zinc-500 text-xs">{run.completedAt}</td>
                  <td className="py-2 text-zinc-500 text-xs truncate max-w-xs">{run.configPath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

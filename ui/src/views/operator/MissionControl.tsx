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

export function OperatorMissionControl(props: {
  onOpenRun: (id: string) => void;
  onOpenIssues: () => void;
}) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [issues, setIssues] = useState<{ id: string; status: string; title: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [r, i] = await Promise.all([
        opFetch<{ runs: RunRow[] }>("/api/runs"),
        opFetch<{ issues: { id: string; status: string; title: string }[] }>("/api/issues"),
      ]);
      setRuns(r.runs.slice(0, 8));
      setIssues(i.issues.filter((x) => x.status === "open").slice(0, 6));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6" data-testid="operator-mission">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Mission Control</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Operator plane — runs and open issues (API:{" "}
            <code className="text-zinc-400">nx operator serve</code>)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => props.onOpenIssues()}>
            Issues
          </Button>
          <Button onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      {err && (
        <Card className="border-red-500/30 text-red-300 text-sm">
          <p className="font-medium">API unavailable</p>
          <p className="text-red-400/80 mt-2">{err}</p>
          <p className="text-zinc-500 mt-2 text-xs">
            Desktop: the shell starts the Control API when possible. Dev: run{" "}
            <code className="text-zinc-400">nx operator serve</code> (Vite proxies to 8787).
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-4">
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-zinc-600">No ingested runs — use nx operator ingest &lt;runDir&gt;</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer"
                  onClick={() => props.onOpenRun(run.id)}
                >
                  <div>
                    <p className="font-mono text-xs text-zinc-400">{run.neoxtenRunId.slice(0, 12)}…</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5 truncate max-w-[240px]">
                      {run.configPath}
                    </p>
                  </div>
                  <Badge variant={run.status === "passed" ? "pass" : "fail"}>{run.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-4">
            Open issues
          </h2>
          {issues.length === 0 ? (
            <p className="text-sm text-zinc-600">No open issues</p>
          ) : (
            <ul className="space-y-2">
              {issues.map((iss) => (
                <li
                  key={iss.id}
                  className="px-3 py-2 rounded-lg bg-white/[0.02] text-sm text-zinc-300"
                >
                  {iss.title}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

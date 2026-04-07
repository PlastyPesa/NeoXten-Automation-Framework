import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/glass/Card";
import { Badge } from "../../components/glass/Badge";
import { Button } from "../../components/glass/Button";
import { opFetch } from "../../lib/operator-api";

interface IssueRow {
  id: string;
  title: string;
  status: string;
  severity: string;
  fingerprint: string;
  updatedAt: string;
  classification?: string | null;
}

type IssueFilter = "all" | "failures" | "design" | "promoted";

export function OperatorIssuesList() {
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [filter, setFilter] = useState<IssueFilter>("all");

  const load = useCallback(async () => {
    const r = await opFetch<{ issues: IssueRow[] }>("/api/issues");
    setIssues(r.issues);
  }, []);

  useEffect(() => {
    void load().catch(() => setIssues([]));
  }, [load]);

  const setStatus = async (id: string, status: string) => {
    await opFetch(`/api/issues/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
  };

  const visible = issues.filter((iss) => {
    const c = iss.classification ?? "";
    if (filter === "all") return true;
    if (filter === "failures") return !c || c === "";
    if (filter === "design") return c === "design_system_auto" || c === "design_system_promoted";
    if (filter === "promoted")
      return (
        c === "promoted_finding" || c === "design_system_promoted" || c === "design_system_auto"
      );
    return true;
  });

  return (
    <div className="space-y-6" data-testid="operator-issues">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Issues</h1>
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["failures", "Run / gate failures"],
            ["design", "Design quality"],
            ["promoted", "Promoted (any)"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs ${
              filter === key ? "bg-white/15 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {visible.map((iss) => (
          <Card key={iss.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-white">{iss.title}</p>
                {iss.classification === "promoted_finding" && (
                  <p className="text-[10px] text-violet-300 mt-0.5">Promoted from run finding</p>
                )}
                {iss.classification === "design_system_promoted" && (
                  <p className="text-[10px] text-fuchsia-300 mt-0.5">Design — promoted (manual)</p>
                )}
                {iss.classification === "design_system_auto" && (
                  <p className="text-[10px] text-fuchsia-300/90 mt-0.5">
                    Design — auto triage (proven token drift; NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN)
                  </p>
                )}
                <p className="text-[10px] font-mono text-zinc-600 mt-1">{iss.fingerprint.slice(0, 16)}…</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant={iss.status === "open" ? "fail" : "pass"}>{iss.status}</Badge>
                <div className="flex gap-1">
                  <Button variant="ghost" className="text-xs py-1 px-2" onClick={() => void setStatus(iss.id, "investigating")}>
                    Investigate
                  </Button>
                  <Button variant="ghost" className="text-xs py-1 px-2" onClick={() => void setStatus(iss.id, "closed")}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-zinc-600">No issues in this filter.</p>
        )}
      </div>
    </div>
  );
}

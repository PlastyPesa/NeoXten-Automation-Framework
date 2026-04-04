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
}

export function OperatorIssuesList() {
  const [issues, setIssues] = useState<IssueRow[]>([]);

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

  return (
    <div className="space-y-6" data-testid="operator-issues">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Issues</h1>
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <div className="space-y-3">
        {issues.map((iss) => (
          <Card key={iss.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-white">{iss.title}</p>
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
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/glass/Card";
import { Button } from "../../components/glass/Button";
import { opFetch, rawRunUrl } from "../../lib/operator-api";

interface FindingRow {
  id: string;
  kind: string;
  title: string;
  severity?: string;
  confidence?: string;
  evidence_strength?: string;
  promotion_state?: string;
  blocks_merge?: boolean;
  detail?: string;
  oracle_id?: string;
}

type FindingTabFilter = "all" | "design" | "polish" | "other";

interface ArtifactRow {
  id: string;
  relativePath: string;
  kind: string;
}

export function OperatorRunDetail(props: { runDbId: string; onBack: () => void }) {
  const [verdict, setVerdict] = useState<Record<string, unknown> | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [sourceDir, setSourceDir] = useState<string>("");
  const [logText, setLogText] = useState<string>("");
  const [tab, setTab] = useState<"summary" | "artifacts" | "log" | "findings" | "retest">("summary");
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [closure, setClosure] = useState<Record<string, unknown> | null>(null);
  const [retestItems, setRetestItems] = useState<
    Array<{ id: string; checkId: string; rationale: string; status: string; required: boolean }>
  >([]);
  const [findingFilter, setFindingFilter] = useState<FindingTabFilter>("all");

  const load = useCallback(async () => {
    const d = await opFetch<{
      run: { verdictJson: string; sourceRunDir: string };
      artifacts: ArtifactRow[];
    }>(`/api/runs/${props.runDbId}`);
    setVerdict(JSON.parse(d.run.verdictJson) as Record<string, unknown>);
    setArtifacts(d.artifacts);
    setSourceDir(d.run.sourceRunDir);
    try {
      const logRes = await fetch(rawRunUrl(props.runDbId, "console.log"));
      if (logRes.ok) setLogText(await logRes.text());
      else setLogText("(no console.log)");
    } catch {
      setLogText("(could not load log)");
    }
    try {
      const f = await opFetch<{ findings: FindingRow[] }>(`/api/runs/${props.runDbId}/findings`);
      setFindings(f.findings);
    } catch {
      setFindings([]);
    }
    try {
      const c = await opFetch<Record<string, unknown>>(`/api/runs/${props.runDbId}/validation-closure`);
      setClosure(c);
    } catch {
      setClosure(null);
    }
    try {
      const r = await opFetch<{
        retestItems: Array<{
          id: string;
          checkId: string;
          rationale: string;
          status: string;
          required: number | boolean;
        }>;
      }>(`/api/runs/${props.runDbId}/retest-items`);
      setRetestItems(
        r.retestItems.map((x) => ({
          ...x,
          required: Boolean(x.required),
        })),
      );
    } catch {
      setRetestItems([]);
    }
  }, [props.runDbId]);

  useEffect(() => {
    void load().catch(() => {
      setVerdict(null);
    });
  }, [load]);

  const pngArts = artifacts.filter((a) => a.relativePath.toLowerCase().endsWith(".png"));

  const filteredFindings = findings.filter((f) => {
    if (findingFilter === "all") return true;
    if (findingFilter === "design") return f.kind === "design_system";
    const oid = f.oracle_id ?? "";
    const isB1 = oid.startsWith("neo.b1.");
    if (findingFilter === "polish")
      return (
        (f.kind === "ux" || f.kind === "visual") &&
        (isB1 || oid.startsWith("neo.layout."))
      );
    if (findingFilter === "other") {
      if (f.kind === "design_system") return false;
      if (isB1) return false;
      return true;
    }
    return true;
  });

  return (
    <div className="space-y-6" data-testid="operator-run-detail">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={props.onBack}>
          ← Back
        </Button>
        <h1 className="text-xl font-semibold text-white">Run detail</h1>
      </div>

      <div className="flex gap-2 border-b border-white/5 pb-2">
        {(["summary", "findings", "retest", "artifacts", "log"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
              tab === t ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="space-y-4">
          {closure && (
            <Card>
              <h3 className="text-sm text-zinc-400 mb-2">Validation closure</h3>
              <ul className="text-xs text-zinc-300 space-y-1 font-mono">
                <li>verdict_ok: {String(closure.verdict_ok)}</li>
                <li>blocking_findings_count: {String(closure.blocking_findings_count)}</li>
                <li>pending_required_retests: {String(closure.pending_required_retests)}</li>
                <li>high_confidence_suspicion: {String(closure.high_confidence_suspicion_present)}</li>
                <li>advisory_findings_count: {String(closure.advisory_findings_count)}</li>
              </ul>
            </Card>
          )}
          <Card>
            <p className="text-xs text-zinc-500 mb-2">Source: {sourceDir}</p>
            <pre className="text-xs text-zinc-300 overflow-auto max-h-[480px] font-mono">
              {verdict ? JSON.stringify(verdict, null, 2) : "Loading…"}
            </pre>
          </Card>
        </div>
      )}

      {tab === "findings" && (
        <Card>
          <div className="flex flex-wrap gap-2 mb-4">
            {(
              [
                ["all", "All findings"],
                ["design", "Design system"],
                ["polish", "Layout / polish (B.1)"],
                ["other", "Other"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFindingFilter(key)}
                className={`px-2.5 py-1 rounded-md text-xs ${
                  findingFilter === key ? "bg-white/12 text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {findings.length === 0 ? (
            <p className="text-sm text-zinc-600">No findings for this run</p>
          ) : filteredFindings.length === 0 ? (
            <p className="text-sm text-zinc-600">No findings in this filter.</p>
          ) : (
            <ul className="space-y-3">
              {filteredFindings.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-white/10 p-3 bg-white/[0.02] text-sm text-zinc-300"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs uppercase text-zinc-500">{f.kind}</span>
                    {f.severity && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                        {f.severity}
                      </span>
                    )}
                    {f.confidence && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-100">
                        {f.confidence}
                      </span>
                    )}
                    {f.evidence_strength && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          f.evidence_strength === "proven"
                            ? "bg-emerald-500/20 text-emerald-100"
                            : f.evidence_strength === "likely"
                              ? "bg-amber-500/20 text-amber-100"
                              : "bg-violet-500/20 text-violet-100"
                        }`}
                        title="Design layer: proven = measured vs spec; likely = heuristic; suggestive = pattern"
                      >
                        {f.evidence_strength}
                      </span>
                    )}
                    {f.blocks_merge && (
                      <span className="text-[10px] text-red-300">blocks merge</span>
                    )}
                  </div>
                  <p className="font-medium text-white">{f.title}</p>
                  {f.detail && <p className="text-xs text-zinc-500 mt-1 whitespace-pre-wrap">{f.detail}</p>}
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <button
                      type="button"
                      className="text-xs text-sky-400 hover:underline"
                      onClick={() =>
                        void opFetch(`/api/runs/${props.runDbId}/findings/${f.id}/promote`, {
                          method: "POST",
                        }).then(() => void load())
                      }
                    >
                      Promote to issue
                    </button>
                    {f.kind === "design_system" && f.evidence_strength === "suggestive" && (
                      <span className="text-[10px] text-zinc-500">
                        Suggestive — confirm before treating as defect
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "retest" && (
        <Card>
          {retestItems.length === 0 ? (
            <p className="text-sm text-zinc-600">No retest items</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {retestItems.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1 border-b border-white/5 pb-2 text-zinc-300"
                >
                  <span className="font-mono text-xs text-zinc-500">{r.checkId}</span>
                  <span>{r.rationale}</span>
                  <span className="text-xs text-zinc-500">
                    {r.status} {r.required ? "· required" : ""}
                  </span>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      className="text-xs text-emerald-400 hover:underline"
                      onClick={() =>
                        void opFetch(`/api/retest-items/${r.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ status: "passed" }),
                        }).then(() => void load())
                      }
                    >
                      Mark passed
                    </button>
                    <button
                      type="button"
                      className="text-xs text-zinc-400 hover:underline"
                      onClick={() => {
                        const reason = window.prompt("Waive reason (operator)") ?? "waived";
                        void opFetch(`/api/retest-items/${r.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ status: "waived", waiveReason: reason }),
                        }).then(() => void load());
                      }}
                    >
                      Waive
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "artifacts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-sm text-zinc-400 mb-3">Files</h3>
            <ul className="text-xs font-mono text-zinc-500 space-y-1 max-h-64 overflow-auto">
              {artifacts.map((a) => (
                <li key={a.id}>{a.kind}: {a.relativePath}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3 className="text-sm text-zinc-400 mb-3">Screenshots</h3>
            <div className="space-y-4">
              {pngArts.length === 0 ? (
                <p className="text-sm text-zinc-600">No PNG artifacts indexed</p>
              ) : (
                pngArts.map((a) => (
                  <div key={a.id}>
                    <p className="text-[10px] text-zinc-600 mb-1">{a.relativePath}</p>
                    <img
                      src={rawRunUrl(props.runDbId, a.relativePath)}
                      alt=""
                      className="rounded-lg border border-white/10 max-w-full max-h-64 object-contain bg-black/40"
                    />
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === "log" && (
        <Card>
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap max-h-[560px] overflow-auto font-mono">
            {logText || "…"}
          </pre>
        </Card>
      )}
    </div>
  );
}

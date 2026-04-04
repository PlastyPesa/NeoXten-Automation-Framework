import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/glass/Card";
import { Button } from "../../components/glass/Button";
import { opFetch, rawRunUrl } from "../../lib/operator-api";

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
  const [tab, setTab] = useState<"summary" | "artifacts" | "log">("summary");

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
  }, [props.runDbId]);

  useEffect(() => {
    void load().catch(() => {
      setVerdict(null);
    });
  }, [load]);

  const pngArts = artifacts.filter((a) => a.relativePath.toLowerCase().endsWith(".png"));

  return (
    <div className="space-y-6" data-testid="operator-run-detail">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={props.onBack}>
          ← Back
        </Button>
        <h1 className="text-xl font-semibold text-white">Run detail</h1>
      </div>

      <div className="flex gap-2 border-b border-white/5 pb-2">
        {(["summary", "artifacts", "log"] as const).map((t) => (
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
        <Card>
          <p className="text-xs text-zinc-500 mb-2">Source: {sourceDir}</p>
          <pre className="text-xs text-zinc-300 overflow-auto max-h-[480px] font-mono">
            {verdict ? JSON.stringify(verdict, null, 2) : "Loading…"}
          </pre>
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

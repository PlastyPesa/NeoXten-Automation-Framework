import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/glass/Card";
import { Button } from "../../components/glass/Button";
import { opFetch } from "../../lib/operator-api";

interface PatchRow {
  id: string;
  state: string;
  baseSha: string;
  authorKind: string;
  createdAt: string;
}

export function OperatorPatchesView() {
  const [patches, setPatches] = useState<PatchRow[]>([]);
  const [diff, setDiff] = useState("");
  const [baseSha, setBaseSha] = useState("HEAD");
  const [changedFiles, setChangedFiles] = useState("");
  const [linkedRunDbId, setLinkedRunDbId] = useState("");
  const [patchRetest, setPatchRetest] = useState<Record<string, { checkId: string; rationale: string; status: string }[]>>(
    {},
  );

  const load = useCallback(async () => {
    const r = await opFetch<{ patches: PatchRow[] }>("/api/patches");
    setPatches(r.patches);
    const entries = await Promise.all(
      r.patches.map(async (p) => {
        try {
          const x = await opFetch<{
            retestItems: Array<{ checkId: string; rationale: string; status: string }>;
          }>(`/api/patches/${p.id}/retest-items`);
          return [p.id, x.retestItems] as const;
        } catch {
          return [p.id, []] as const;
        }
      }),
    );
    setPatchRetest(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void load().catch(() => setPatches([]));
  }, [load]);

  const submit = async () => {
    const files = changedFiles
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    await opFetch("/api/patches", {
      method: "POST",
      body: JSON.stringify({
        baseSha,
        unifiedDiff: diff,
        authorKind: "human",
        changedFiles: files,
        linkedRunDbId: linkedRunDbId.trim() || null,
      }),
    });
    setDiff("");
    await load();
  };

  return (
    <div className="space-y-6" data-testid="operator-patches">
      <h1 className="text-2xl font-semibold text-white">Patches</h1>
      <Card>
        <h2 className="text-sm text-zinc-400 mb-3">New proposal</h2>
        <input
          className="w-full mb-2 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white"
          value={baseSha}
          onChange={(e) => setBaseSha(e.target.value)}
          placeholder="base SHA"
        />
        <textarea
          className="w-full h-40 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-zinc-300"
          value={diff}
          onChange={(e) => setDiff(e.target.value)}
          placeholder="unified diff"
        />
        <p className="text-xs text-zinc-500 mt-2">Changed files (one path per line) — drives retest plan</p>
        <textarea
          className="w-full h-20 mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-zinc-300"
          value={changedFiles}
          onChange={(e) => setChangedFiles(e.target.value)}
          placeholder="src/App.tsx"
        />
        <input
          className="w-full mt-2 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white"
          value={linkedRunDbId}
          onChange={(e) => setLinkedRunDbId(e.target.value)}
          placeholder="linked run DB id (optional — attach blocking findings)"
        />
        <Button className="mt-2" onClick={() => void submit()}>
          Submit proposal
        </Button>
      </Card>
      <div className="space-y-2">
        {patches.map((p) => (
          <Card key={p.id}>
            <p className="text-xs text-zinc-500">{p.id}</p>
            <p className="text-sm text-zinc-300 mt-1">
              {p.state} · {p.authorKind} · {p.baseSha.slice(0, 7)}
            </p>
            {(patchRetest[p.id] ?? []).length > 0 && (
              <ul className="mt-2 text-xs text-zinc-500 space-y-1">
                {(patchRetest[p.id] ?? []).map((r) => (
                  <li key={r.checkId + r.status}>
                    <span className="font-mono text-zinc-400">{r.checkId}</span> — {r.rationale} ({r.status})
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

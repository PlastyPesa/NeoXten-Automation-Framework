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

  const load = useCallback(async () => {
    const r = await opFetch<{ patches: PatchRow[] }>("/api/patches");
    setPatches(r.patches);
  }, []);

  useEffect(() => {
    void load().catch(() => setPatches([]));
  }, [load]);

  const submit = async () => {
    await opFetch("/api/patches", {
      method: "POST",
      body: JSON.stringify({ baseSha, unifiedDiff: diff, authorKind: "human" }),
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
          </Card>
        ))}
      </div>
    </div>
  );
}

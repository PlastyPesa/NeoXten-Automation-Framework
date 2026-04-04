import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "../../components/glass/Card";
import { Button } from "../../components/glass/Button";

type ReadinessCheck = {
  id: string;
  label: string;
  severity: string;
  detail?: string;
};

type ReadinessReport = {
  ok: boolean;
  checks: ReadinessCheck[];
  firstRunRecommended?: boolean;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function OperatorProductSetupPanel(props: {
  operatorPort: number | null;
  serviceError: string | null;
}) {
  const [firstComplete, setFirstComplete] = useState<boolean | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    if (!isTauri()) return;
    setBusy(true);
    try {
      const fr = await invoke<{ state?: { complete?: boolean } }>("product_first_run_state");
      setFirstComplete(Boolean(fr.state?.complete));
      const report = await invoke<ReadinessReport>("product_readiness_cli", {
        servicePort: props.operatorPort ?? null,
      });
      setReadiness(report);
    } catch (e) {
      setReadiness({
        ok: false,
        checks: [
          {
            id: "readiness-cli",
            label: "Readiness check failed to run",
            severity: "fail",
            detail: e instanceof Error ? e.message : String(e),
          },
        ],
      });
    } finally {
      setBusy(false);
    }
  }, [props.operatorPort]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isTauri()) return null;

  if (firstComplete === null && !readiness && !props.serviceError) {
    return (
      <div className="mb-6" data-testid="operator-product-setup-loading">
        <Card className="border-white/10 text-xs text-zinc-500">Loading setup state…</Card>
      </div>
    );
  }

  const hasFail = readiness?.checks.some((c) => c.severity === "fail") ?? false;
  const hasWarn = readiness?.checks.some((c) => c.severity === "warn") ?? false;
  const mustShow =
    props.serviceError ||
    firstComplete === false ||
    hasFail ||
    !readiness?.ok ||
    hasWarn;

  if (!mustShow && firstComplete === true) {
    return null;
  }

  const fails = readiness?.checks.filter((c) => c.severity === "fail") ?? [];
  const warns = readiness?.checks.filter((c) => c.severity === "warn") ?? [];

  return (
    <div className="mb-6" data-testid="operator-product-setup">
      <Card className="border-amber-500/25 bg-amber-500/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-amber-200/90">Setup & readiness</h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Local-first Operator: data lives under your profile; the desktop shell starts the Control API. Resolve
              failures before relying on gates or patches.
            </p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Hide" : "Show"} details
            </Button>
            <Button className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => void load()}>
              {busy ? "Checking…" : "Recheck"}
            </Button>
            {firstComplete === false && (
              <Button
                className="!px-3 !py-1.5 text-xs"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  try {
                    await invoke("product_mark_first_run_cli");
                    setFirstComplete(true);
                    await load();
                  } catch (e) {
                    console.warn(e);
                  }
                }}
              >
                Dismiss checklist
              </Button>
            )}
          </div>
        </div>

        {props.serviceError && (
          <p className="text-xs text-red-300 mt-3 font-mono break-all">{props.serviceError}</p>
        )}

        {expanded && readiness && (
          <ul className="mt-4 space-y-2 text-xs">
            {fails.map((c) => (
              <li key={c.id} className="text-red-300">
                <span className="font-medium">[fail]</span> {c.label}
                {c.detail ? <span className="block text-red-400/80 mt-0.5">{c.detail}</span> : null}
              </li>
            ))}
            {warns.map((c) => (
              <li key={c.id} className="text-amber-200/80">
                <span className="font-medium">[warn]</span> {c.label}
                {c.detail ? <span className="block text-zinc-500 mt-0.5">{c.detail}</span> : null}
              </li>
            ))}
            {fails.length === 0 && warns.length === 0 && readiness.ok && (
              <li className="text-emerald-400/90">All checks passed.</li>
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

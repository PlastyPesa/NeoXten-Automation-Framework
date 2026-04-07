import { useState, useCallback, useEffect, lazy, Suspense } from "react";
const Dashboard = lazy(() =>
  import("./views/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Pipeline = lazy(() =>
  import("./views/Pipeline").then((m) => ({ default: m.Pipeline })),
);
const Evidence = lazy(() =>
  import("./views/Evidence").then((m) => ({ default: m.Evidence })),
);
const Chat = lazy(() => import("./views/Chat").then((m) => ({ default: m.Chat })));
const StorePack = lazy(() =>
  import("./views/StorePack").then((m) => ({ default: m.StorePack })),
);
const Import = lazy(() => import("./views/Import").then((m) => ({ default: m.Import })));
import { OperatorMissionControl } from "./views/operator/MissionControl";
import { OperatorRunsList } from "./views/operator/RunsList";
import { OperatorRunDetail } from "./views/operator/RunDetail";
import { OperatorIssuesList } from "./views/operator/IssuesList";
import { OperatorPatchesView } from "./views/operator/PatchesView";
import { OperatorProductSetupPanel } from "./views/operator/ProductSetupPanel";
import { useTauriEvent } from "./hooks/useTauriEvents";
import { useRunStore } from "./stores/run-store";
import { setOperatorApiBase } from "./lib/operator-api";
import { invoke } from "@tauri-apps/api/core";

type View =
  | "dashboard"
  | "pipeline"
  | "evidence"
  | "chat"
  | "storepack"
  | "import"
  | "op_mission"
  | "op_runs"
  | "op_run_detail"
  | "op_issues"
  | "op_patches";

const NAV_ITEMS: Array<{ id: View; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "pipeline", label: "Pipeline", icon: "▸" },
  { id: "evidence", label: "Evidence", icon: "◈" },
  { id: "chat", label: "Chat", icon: "◇" },
  { id: "storepack", label: "Store Packs", icon: "▤" },
  { id: "import", label: "New Run", icon: "+" },
  { id: "op_mission", label: "Op · Mission", icon: "◎" },
  { id: "op_runs", label: "Op · Runs", icon: "▣" },
  { id: "op_issues", label: "Op · Issues", icon: "⚠" },
  { id: "op_patches", label: "Op · Patches", icon: "⚡" },
];

function ViewFallback() {
  return (
    <div className="p-8 text-sm text-zinc-500" data-testid="view-fallback">
      Loading…
    </div>
  );
}

/** Avoid `opFetch` against relative `/api/*` before Tauri sets `setOperatorApiBase` (asset server returns HTML). */
function OperatorHttpGate(props: {
  ready: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  if (props.error) {
    return (
      <div className="p-8 text-sm" data-testid="operator-http-error">
        <p className="text-red-400 font-medium mb-2">Local operator did not start</p>
        <pre className="text-zinc-400 whitespace-pre-wrap text-xs mb-4">{props.error}</pre>
        <p className="text-zinc-500 text-xs">
          Packaged app: check{" "}
          <code className="text-zinc-400">%LOCALAPPDATA%\NeoXten\logs\operator-serve.stderr.log</code> for Node errors.
          Dev: run <code className="text-zinc-400">npm run build</code> then{" "}
          <code className="text-zinc-400">npm run operator:serve</code> from the repo root.
        </p>
      </div>
    );
  }
  if (!props.ready) {
    return (
      <div className="p-8 text-sm text-zinc-500" data-testid="operator-http-wait">
        Connecting to local operator… (first start can take up to a minute)
      </div>
    );
  }
  return <>{props.children}</>;
}

export default function App() {
  const [view, setView] = useState<View>("op_mission");
  const [operatorRunId, setOperatorRunId] = useState<string | null>(null);
  const [operatorPort, setOperatorPort] = useState<number | null>(null);
  const [operatorServiceError, setOperatorServiceError] = useState<string | null>(null);
  const { setRunStarted } = useRunStore();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    void (async () => {
      try {
        const r = await invoke<{ ok: boolean; port?: number }>("operator_ensure_running");
        if (r.ok && typeof r.port === "number") {
          setOperatorApiBase(`http://127.0.0.1:${r.port}`);
          setOperatorPort(r.port);
          setOperatorServiceError(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setOperatorServiceError(msg);
        setOperatorPort(null);
        console.warn("[NeoXten] operator_ensure_running failed:", e);
      }
    })();
  }, []);

  useTauriEvent(
    "factory://run-started",
    useCallback(
      (e) => {
        setRunStarted(e.runId, e.specHash);
        setView("pipeline");
      },
      [setRunStarted],
    ),
  );

  const handleNavigate = (v: string) => setView(v as View);

  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const operatorHttpReady = !isTauri || operatorPort != null;

  return (
    <div className="flex h-screen" data-testid="app-shell">
      <nav
        data-testid="sidebar"
        className="w-56 shrink-0 border-r border-white/5 bg-white/[0.02] backdrop-blur-xl flex flex-col"
      >
        <div className="px-5 py-6 border-b border-white/5">
          <h1 className="text-sm font-semibold tracking-widest text-zinc-300 uppercase">
            NeoXten
          </h1>
          <p className="text-[10px] text-zinc-600 mt-0.5">Factory + Operator</p>
        </div>

        <div className="flex-1 py-4 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              data-testid={`nav-${item.id}`}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                view === item.id
                  ? "bg-white/10 text-white border border-white/10"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5 border border-transparent"
              }`}
            >
              <span className="text-xs w-4 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-white/5">
          <p className="text-[10px] text-zinc-700">v2.1.0 — desktop + operator</p>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-8">
        <OperatorProductSetupPanel operatorPort={operatorPort} serviceError={operatorServiceError} />
        <Suspense fallback={<ViewFallback />}>
          {view === "dashboard" && <Dashboard onNavigate={handleNavigate} />}
          {view === "pipeline" && <Pipeline />}
          {view === "evidence" && <Evidence />}
          {view === "chat" && <Chat />}
          {view === "storepack" && <StorePack />}
          {view === "import" && <Import onNavigate={handleNavigate} />}
        </Suspense>
        {view === "op_mission" && (
          <OperatorHttpGate ready={operatorHttpReady} error={operatorServiceError}>
            <OperatorMissionControl
              onOpenRun={(id) => {
                setOperatorRunId(id);
                setView("op_run_detail");
              }}
              onOpenIssues={() => setView("op_issues")}
            />
          </OperatorHttpGate>
        )}
        {view === "op_runs" && (
          <OperatorHttpGate ready={operatorHttpReady} error={operatorServiceError}>
            <OperatorRunsList
              onOpenRun={(id) => {
                setOperatorRunId(id);
                setView("op_run_detail");
              }}
            />
          </OperatorHttpGate>
        )}
        {view === "op_run_detail" && operatorRunId && (
          <OperatorHttpGate ready={operatorHttpReady} error={operatorServiceError}>
            <OperatorRunDetail
              runDbId={operatorRunId}
              onBack={() => setView("op_runs")}
            />
          </OperatorHttpGate>
        )}
        {view === "op_issues" && (
          <OperatorHttpGate ready={operatorHttpReady} error={operatorServiceError}>
            <OperatorIssuesList />
          </OperatorHttpGate>
        )}
        {view === "op_patches" && (
          <OperatorHttpGate ready={operatorHttpReady} error={operatorServiceError}>
            <OperatorPatchesView />
          </OperatorHttpGate>
        )}
      </main>
    </div>
  );
}

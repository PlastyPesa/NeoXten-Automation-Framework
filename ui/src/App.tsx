import { useState, useCallback } from "react";
import { Dashboard } from "./views/Dashboard";
import { Pipeline } from "./views/Pipeline";
import { Evidence } from "./views/Evidence";
import { Chat } from "./views/Chat";
import { StorePack } from "./views/StorePack";
import { Import } from "./views/Import";
import { useTauriEvent } from "./hooks/useTauriEvents";
import { useRunStore } from "./stores/run-store";

type View = "dashboard" | "pipeline" | "evidence" | "chat" | "storepack" | "import";

const NAV_ITEMS: Array<{ id: View; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "pipeline", label: "Pipeline", icon: "▸" },
  { id: "evidence", label: "Evidence", icon: "◈" },
  { id: "chat", label: "Chat", icon: "◇" },
  { id: "storepack", label: "Store Packs", icon: "▤" },
  { id: "import", label: "New Run", icon: "+" },
];

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const { setRunStarted } = useRunStore();

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
          <p className="text-[10px] text-zinc-600 mt-0.5">AI Shipping Factory</p>
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
          <p className="text-[10px] text-zinc-700">v0.1.0 — headless core ready</p>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-8">
        {view === "dashboard" && <Dashboard onNavigate={handleNavigate} />}
        {view === "pipeline" && <Pipeline />}
        {view === "evidence" && <Evidence />}
        {view === "chat" && <Chat />}
        {view === "storepack" && <StorePack />}
        {view === "import" && <Import onNavigate={handleNavigate} />}
      </main>
    </div>
  );
}

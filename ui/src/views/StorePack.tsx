import { Panel } from "../components/glass/Panel";
import { Badge } from "../components/glass/Badge";
import { HashBadge } from "../components/evidence/HashBadge";
import { Button } from "../components/glass/Button";

export function StorePack() {
  return (
    <div data-testid="storepack-view" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Store Packs</h1>
        <Button data-testid="export-pack-btn" variant="secondary">
          Export Pack
        </Button>
      </div>

      <Panel title="Available Packs" data-testid="packs-panel">
        <p className="text-sm text-zinc-500">
          Store packs are generated after a successful Factory run. Complete a run to see available export packs.
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-3">
              <Badge variant="neutral">Web</Badge>
              <span className="text-sm text-zinc-300">Production build</span>
            </div>
            <HashBadge hash={"0".repeat(64)} label="pending" />
          </div>

          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-3">
              <Badge variant="neutral">Android</Badge>
              <span className="text-sm text-zinc-300">Signed AAB/APK</span>
            </div>
            <HashBadge hash={"0".repeat(64)} label="pending" />
          </div>

          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-3">
              <Badge variant="neutral">Chrome</Badge>
              <span className="text-sm text-zinc-300">Store-ready ZIP</span>
            </div>
            <HashBadge hash={"0".repeat(64)} label="pending" />
          </div>
        </div>
      </Panel>
    </div>
  );
}

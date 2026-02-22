import { useState } from "react";
import { Panel } from "../components/glass/Panel";
import { Button } from "../components/glass/Button";
import { Badge } from "../components/glass/Badge";
import { useFactoryCommand } from "../hooks/useFactoryCommand";
import { useRunStore } from "../stores/run-store";

interface ImportProps {
  onNavigate: (view: string) => void;
}

export function Import({ onNavigate }: ImportProps) {
  const [specPath, setSpecPath] = useState("");
  const [blueprintText, setBlueprintText] = useState("");
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [validating, setValidating] = useState(false);

  const commands = useFactoryCommand();
  const { setRunStarted } = useRunStore();

  const handleValidate = async () => {
    if (!specPath.trim()) return;
    setValidating(true);
    try {
      const result = await commands.validateSpec(specPath);
      setValidationResult(result);
    } catch (err) {
      setValidationResult({ valid: false, errors: [String(err)] });
    }
    setValidating(false);
  };

  const handleStartRun = async () => {
    if (!specPath.trim() || !validationResult?.valid) return;
    try {
      await commands.startRun(specPath, undefined);
      setRunStarted("pending", "");
      onNavigate("pipeline");
    } catch (err) {
      setValidationResult({ valid: false, errors: [String(err)] });
    }
  };

  return (
    <div data-testid="import-view" className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">New Run</h1>

      <Panel title="Spec Selection" data-testid="spec-panel">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Spec YAML Path</label>
            <input
              data-testid="spec-path-input"
              type="text"
              value={specPath}
              onChange={(e) => setSpecPath(e.target.value)}
              placeholder="path/to/spec.yaml"
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20 transition-colors"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button data-testid="validate-btn" onClick={handleValidate} disabled={validating || !specPath.trim()}>
              {validating ? "Validating..." : "Validate Spec"}
            </Button>
            {validationResult && (
              <Badge variant={validationResult.valid ? "pass" : "fail"}>
                {validationResult.valid ? "Valid" : "Invalid"}
              </Badge>
            )}
          </div>
          {validationResult && !validationResult.valid && (
            <div className="space-y-1">
              {validationResult.errors.map((err, i) => (
                <p key={i} className="text-xs text-rose-400">{err}</p>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Blueprint (Optional — Provenance Only)" data-testid="blueprint-panel">
        <textarea
          data-testid="blueprint-textarea"
          value={blueprintText}
          onChange={(e) => setBlueprintText(e.target.value)}
          placeholder="Paste your blueprint/plan here. This is stored as provenance evidence only — the Spec is the executable contract."
          className="w-full h-40 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-300 placeholder-zinc-600 outline-none focus:border-white/20 transition-colors resize-none"
        />
        <p className="text-[10px] text-zinc-600 mt-2">
          Blueprint text is hashed and stored in the Evidence Chain as run provenance. It does not influence pipeline execution.
        </p>
      </Panel>

      <Button
        data-testid="start-run-btn"
        onClick={handleStartRun}
        disabled={!validationResult?.valid}
        className="w-full py-3"
      >
        Start Factory Run
      </Button>
    </div>
  );
}

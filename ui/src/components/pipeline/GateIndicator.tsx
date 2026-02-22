interface GateIndicatorProps {
  gateId: string;
  passed: boolean;
  "data-testid"?: string;
}

export function GateIndicator({ gateId, passed, ...props }: GateIndicatorProps) {
  return (
    <div
      data-testid={props["data-testid"]}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono ${
        passed
          ? "bg-emerald-400/10 text-emerald-400"
          : "bg-rose-400/10 text-rose-400"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${passed ? "bg-emerald-400" : "bg-rose-400"}`} />
      <span>{gateId}</span>
      <span className="text-[10px] opacity-60">{passed ? "PASS" : "FAIL"}</span>
    </div>
  );
}

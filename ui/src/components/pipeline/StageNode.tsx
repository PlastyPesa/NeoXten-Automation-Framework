import { Badge } from "../glass/Badge";

interface StageNodeProps {
  name: string;
  status: "pending" | "started" | "completed" | "failed";
  isLast?: boolean;
  "data-testid"?: string;
}

const statusLabels = {
  pending: "Pending",
  started: "Running",
  completed: "Done",
  failed: "Failed",
} as const;

const statusVariants = {
  pending: "pending",
  started: "running",
  completed: "pass",
  failed: "fail",
} as const;

export function StageNode({ name, status, isLast = false, ...props }: StageNodeProps) {
  const isActive = status === "started";

  return (
    <div className="flex items-center" data-testid={props["data-testid"]}>
      <div
        className={`relative flex flex-col items-center gap-2 px-4 py-3 rounded-xl border transition-all duration-300 ${
          isActive
            ? "bg-amber-400/10 border-amber-400/30 shadow-lg shadow-amber-400/5"
            : status === "completed"
              ? "bg-emerald-400/5 border-emerald-400/20"
              : status === "failed"
                ? "bg-rose-400/5 border-rose-400/20"
                : "bg-white/[0.02] border-white/5"
        }`}
      >
        {isActive && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
          </span>
        )}
        <span className="text-xs font-medium text-zinc-300 whitespace-nowrap">
          {name.replace(/_/g, " ")}
        </span>
        <Badge variant={statusVariants[status]}>{statusLabels[status]}</Badge>
      </div>
      {!isLast && (
        <div
          className={`w-8 h-px mx-1 ${
            status === "completed" ? "bg-emerald-400/30" : "bg-white/10"
          }`}
        />
      )}
    </div>
  );
}

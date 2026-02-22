export function ConstraintBadge() {
  return (
    <div
      data-testid="chat-constraint-badge"
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-400/5 border border-emerald-400/20"
    >
      <span className="w-2 h-2 rounded-full bg-emerald-400" />
      <span className="text-[11px] font-medium text-emerald-400/80 tracking-wide">
        READ + RUN ONLY
      </span>
    </div>
  );
}

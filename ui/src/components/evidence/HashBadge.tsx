interface HashBadgeProps {
  hash: string;
  label?: string;
  "data-testid"?: string;
}

export function HashBadge({ hash, label = "SHA-256", ...props }: HashBadgeProps) {
  return (
    <span
      data-testid={props["data-testid"]}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/10 font-mono text-[10px] text-zinc-400"
      title={hash}
    >
      <span className="text-zinc-500">{label}</span>
      <span>{hash.slice(0, 12)}...</span>
    </span>
  );
}

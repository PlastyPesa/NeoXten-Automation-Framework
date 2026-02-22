type BadgeVariant = "pass" | "fail" | "running" | "pending" | "neutral";

const variants: Record<BadgeVariant, string> = {
  pass: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  fail: "bg-rose-400/10 text-rose-400 border-rose-400/20",
  running: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  pending: "bg-zinc-600/10 text-zinc-500 border-zinc-600/20",
  neutral: "bg-white/5 text-zinc-300 border-white/10",
};

interface BadgeProps {
  variant: BadgeVariant;
  children: string;
  "data-testid"?: string;
}

export function Badge({ variant, children, ...props }: BadgeProps) {
  return (
    <span
      data-testid={props["data-testid"]}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[variant]}`}
    >
      {children}
    </span>
  );
}

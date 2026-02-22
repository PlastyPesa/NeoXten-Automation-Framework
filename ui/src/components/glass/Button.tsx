import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-white/10 hover:bg-white/15 text-white border-white/20 hover:border-white/30 ring-1 ring-white/10 hover:ring-white/20",
  secondary:
    "bg-white/5 hover:bg-white/8 text-zinc-300 border-white/10 hover:border-white/15",
  danger:
    "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-400/20 hover:border-rose-400/30",
  ghost:
    "bg-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200 border-transparent",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
  "data-testid"?: string;
}

export function Button({
  variant = "primary",
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

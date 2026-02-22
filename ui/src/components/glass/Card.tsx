import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      data-testid={props["data-testid"]}
      className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 transition-all duration-200 ${className}`}
    >
      {children}
    </div>
  );
}

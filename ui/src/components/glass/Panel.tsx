import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
  title?: string;
  className?: string;
  "data-testid"?: string;
}

export function Panel({ children, title, className = "", ...props }: PanelProps) {
  return (
    <section
      data-testid={props["data-testid"]}
      className={`backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl ${className}`}
    >
      {title && (
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-sm font-medium tracking-wide text-zinc-300 uppercase">
            {title}
          </h2>
        </div>
      )}
      <div className="p-6">{children}</div>
    </section>
  );
}

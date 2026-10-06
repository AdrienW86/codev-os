import type { ReactNode } from "react";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" }) {
  const colors = { neutral: "bg-white/5 text-muted", green: "bg-accent/10 text-accent", amber: "bg-amber-400/10 text-amber-300" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${colors[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-surface ${className}`}>
      {children}
    </section>
  );
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-3 text-xs font-medium tracking-[0.18em] text-muted uppercase">{eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

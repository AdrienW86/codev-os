// Badge d’état unique pour toute l’application.
export type StatusTone = "neutral" | "green" | "amber" | "red" | "blue";

export const statusToneClasses: Record<StatusTone, string> = {
  neutral: "bg-surface-raised text-muted",
  green: "bg-success/10 text-success",
  amber: "bg-warning/10 text-warning",
  red: "bg-danger/10 text-danger",
  blue: "bg-accent/10 text-accent-hover",
};

export function StatusBadge({ label, tone = "neutral", symbol, className = "" }: { label: string; tone?: StatusTone; symbol?: string; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset ${statusToneClasses[tone]} ${className}`}>
      {symbol ? <span aria-hidden="true">{symbol}</span> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

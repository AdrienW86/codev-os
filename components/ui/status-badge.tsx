// Badge d’état unique pour toute l’application.
export type StatusTone = "neutral" | "green" | "amber" | "red" | "blue";

export const statusToneClasses: Record<StatusTone, string> = {
  neutral: "bg-white/5 text-muted",
  green: "bg-accent/10 text-accent",
  amber: "bg-amber-400/10 text-amber-300",
  red: "bg-red-400/10 text-red-300",
  blue: "bg-sky-400/10 text-sky-300",
};

export function StatusBadge({ label, tone = "neutral", symbol, className = "" }: { label: string; tone?: StatusTone; symbol?: string; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap ${statusToneClasses[tone]} ${className}`}>
      {symbol ? <span aria-hidden="true">{symbol}</span> : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

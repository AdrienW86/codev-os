import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

const nf = new Intl.NumberFormat("fr-FR");
export const fmtShare = (value: number | null) => value === null ? "—" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })} %`;

/** Carte du tableau de bord : même surface que les panneaux du reste de l’application. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-surface shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function IconBadge({ name, tone }: { name: IconName; tone: string }) {
  return <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon name={name} width={18} height={18} /></span>;
}

export function WidgetHeader({ icon, title, action, children }: { icon: IconName; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <div className="flex min-w-0 items-center gap-3">
        <IconBadge name={icon} tone="bg-accent/10 text-accent-hover" />
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-foreground">{title}</h2>
          {children}
        </div>
      </div>
      {action}
    </div>
  );
}

export function GhostButton({ children, onClick, pressed }: { children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-strong bg-surface-raised/40 px-3 text-xs text-foreground transition-colors hover:border-accent/50 hover:bg-surface-raised">
      {children}
    </button>
  );
}

export type BarRow = { key: string; label: ReactNode; title?: string; value: number; share: number | null; highlight?: boolean; muted?: boolean };

/** Tableau « libellé · barre · volume · % » des widgets (pages, sources, pays, OS). */
export function BarTable({ head, rows, valueLabel = "Visiteurs", empty, compact = false }: { head: string; rows: BarRow[]; valueLabel?: string; empty: string; compact?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="px-5 pb-6 pt-4 text-sm text-muted">{empty}</p>;
  return (
    <div className="px-5 pb-5 pt-4">
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_3.25rem_3.25rem] gap-3 border-b border-border pb-2 text-[10px] font-medium uppercase tracking-wider text-subtle">
        <span>{head}</span><span aria-hidden="true" /><span className="text-right">{valueLabel}</span><span className="text-right">%</span>
      </div>
      <ul className={compact ? "mt-1.5" : "mt-2"}>
        {rows.map((row) => (
          <li key={row.key} className={`grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_3.25rem_3.25rem] items-center gap-3 rounded-md ${compact ? "py-1.5" : "py-2"} text-[13px] ${row.highlight ? "bg-accent/[0.07]" : ""}`}>
            <span className={`flex min-w-0 items-center gap-2 truncate ${row.muted ? "text-muted" : "text-foreground"}`} title={row.title}>{row.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (row.value / max) * 100)}%` }} />
            </span>
            <span className="text-right font-medium tabular-nums text-foreground">{nf.format(row.value)}</span>
            <span className="text-right tabular-nums text-muted">{fmtShare(row.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

/** État vide : toujours une explication et, si possible, une suite. */
export function EmptyState({ icon = "dashboard", title, description, action, compact = false }: { icon?: IconName; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-dashed border-border text-center ${compact ? "px-4 py-6" : "px-6 py-10"}`}>
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon name={icon} /></span>
      <p className="mt-4 font-medium">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

const noticeTones = {
  neutral: "border-border bg-surface-raised/60 text-muted",
  info: "border-info/20 bg-info/5 text-info",
  amber: "border-warning/25 bg-warning/10 text-warning",
  green: "border-success/25 bg-success/10 text-success",
  red: "border-danger/25 bg-danger/10 text-danger",
};

/** Message contextuel dans une page, une modale ou un panneau ; fermable si `onDismiss`. */
export function InlineNotice({ tone = "neutral", title, children, action, onDismiss }: { tone?: keyof typeof noticeTones; title?: string; children?: ReactNode; action?: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="note" className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-6 ${noticeTones[tone]}`}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Fermer le message" className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-surface-raised"><span aria-hidden="true">×</span></button>}
    </div>
  );
}

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-raised" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded bg-surface-raised" />
      <div className="grid gap-4 pt-4 md:grid-cols-3">
        {[0, 1, 2].map((key) => <div key={key} className="h-32 animate-pulse rounded-xl bg-surface-raised/60" />)}
      </div>
    </div>
  );
}

export function ErrorState({ title = "Cette page n’a pas pu être chargée.", description = "Réessayez dans quelques instants. Aucune donnée n’a été modifiée.", action }: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 px-6 py-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-danger"><Icon name="alert" /></span>
      <p className="mt-4 font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

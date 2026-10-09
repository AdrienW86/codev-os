import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

export { PageHeading as PageHeader } from "@/components/ui/primitives";

/** En-tête de section : titre, compteur, description courte et action éventuelle. */
export function SectionHeader({ id, title, count, description, action, as: Heading = "h2" }: { id?: string; title: string; count?: number; description?: string; action?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Heading id={id} className={`flex items-center gap-2 font-semibold ${Heading === "h2" ? "text-lg" : "text-base"}`}>
          {title}{count !== undefined && <span className="text-sm font-normal text-muted">{count}</span>}
        </Heading>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Lien vers une entité liée (« Client · Rénov Habitat »). Sans destination, rendu en texte. */
export function RelationLink({ kind, label, href, onClick, icon }: { kind: string; label: string; href?: string; onClick?: () => void; icon?: IconName }) {
  const content = <>{icon && <Icon name={icon} width={14} height={14} className="shrink-0" />}<span className="text-muted">{kind}</span><span className="truncate">{label}</span></>;
  const className = "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-border px-3 text-xs";
  if (href) return <Link href={href} className={`${className} hover:border-accent/50 hover:text-accent`}>{content}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${className} hover:border-accent/50 hover:text-accent`}>{content}</button>;
  return <span className={className}>{content}</span>;
}

/** Ligne d’activité : quoi, qui/où, état, quand. */
export function ActivityItem({ title, meta, status, time, href, onOpen }: { title: ReactNode; meta?: ReactNode; status?: { label: string; tone: StatusTone }; time?: { iso: string; label: string }; href?: string; onOpen?: () => void }) {
  const titleNode = href ? <Link href={href} className="hover:text-accent hover:underline">{title}</Link>
    : onOpen ? <button type="button" onClick={onOpen} className="text-left hover:text-accent hover:underline">{title}</button> : title;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{titleNode}</p>
        {meta && <p className="mt-1 text-xs text-muted">{meta}</p>}
      </div>
      <div className="flex items-center gap-3">
        {status && <StatusBadge label={status.label} tone={status.tone} />}
        {time && <time dateTime={time.iso} className="text-xs text-muted">{time.label}</time>}
      </div>
    </li>
  );
}

/** Carte d’entité entièrement cliquable (lien ou bouton réel, jamais une div cliquable). */
export function EntityCard({ title, eyebrow, description, status, footer, href, onOpen, icon, children }: {
  title: string; eyebrow?: ReactNode; description?: ReactNode; status?: { label: string; tone: StatusTone; symbol?: string };
  footer?: ReactNode; href?: string; onOpen?: () => void; icon?: IconName; children?: ReactNode;
}) {
  const header = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-accent"><Icon name={icon} width={18} height={18} /></span>}
          <div className="min-w-0">
            {eyebrow && <p className="truncate text-xs text-muted">{eyebrow}</p>}
            <h3 className="font-semibold group-hover:text-accent">{title}</h3>
          </div>
        </div>
        {status && <StatusBadge {...status} />}
      </div>
      {description && <p className="mt-3 text-sm text-muted">{description}</p>}
    </>
  );
  const interactive = "group block w-full text-left";
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/40">
      {href ? <Link href={href} className={interactive}>{header}</Link> : onOpen ? <button type="button" onClick={onOpen} className={interactive}>{header}</button> : header}
      {children}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </article>
  );
}

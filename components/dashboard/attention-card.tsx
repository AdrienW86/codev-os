import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";

export type AttentionItem = { id: string; title: string; detail: string };

/** Carte « À traiter maintenant » : un compteur métier, quelques éléments, un lien. */
export function AttentionCard({ title, count, icon, href, linkLabel, items, emptyLabel, urgent = false }: {
  title: string; count: number; icon: IconName; href: string; linkLabel: string;
  items: AttentionItem[]; emptyLabel?: string; urgent?: boolean;
}) {
  const highlight = urgent && count > 0;
  return (
    <article className={`flex min-w-0 flex-col rounded-xl border bg-surface p-5 ${highlight ? "border-amber-300/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${highlight ? "bg-amber-400/10 text-amber-300" : "bg-accent/10 text-accent"}`}>
          <Icon name={icon} width={18} height={18} />
        </span>
      </div>
      {items.length ? (
        <ul className="mt-4 space-y-2.5">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <p className="truncate text-sm">{item.title}</p>
              <p className="truncate text-xs text-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      ) : emptyLabel && <p className="mt-4 text-sm text-muted">{emptyLabel}</p>}
      <Link href={href} className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm text-accent hover:underline">
        {linkLabel}<Icon name="arrow" width={16} height={16} />
      </Link>
    </article>
  );
}

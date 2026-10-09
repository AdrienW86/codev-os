import Link from "next/link";

export type TabItem = { id: string; label: string; href: string; count?: number };

/** Onglets reliés à l’URL : partageables, compatibles retour arrière et clavier. */
export function Tabs({ items, current, label }: { items: TabItem[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 mb-8 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1 px-1">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors ${active ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {item.label}{item.count !== undefined && <span className="text-xs text-muted">{item.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Variante locale (état React) pour les vues simulées. */
export function ButtonTabs({ items, current, onChange, label }: { items: { id: string; label: string; count?: number }[]; current: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-6 overflow-x-auto border-b border-border">
      <div className="flex min-w-max gap-1 px-1">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.id)}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors ${active ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {item.label}{item.count !== undefined && <span className="text-xs text-muted">{item.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

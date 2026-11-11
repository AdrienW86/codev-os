"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useRef } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

// Navigation V3 : mêmes entrées qu'avant, regroupées par usage (moins de charge visuelle, aucune page retirée).
// Les routes /projects, /tasks, /recommendations et /actions restent accessibles via les liens internes.
type NavGroup = "Pilotage" | "Clients" | "Contenus" | "Performance" | "Système";
const navigation: { href: string; label: string; icon: IconName; group: NavGroup; matches?: string[] }[] = [
  { href: "/dashboard", label: "Accueil", icon: "home", group: "Pilotage" },
  { href: "/agenda", label: "Agenda", icon: "calendar", group: "Pilotage" },
  { href: "/work", label: "Travail", icon: "work", group: "Pilotage", matches: ["/tasks", "/recommendations", "/actions"] },
  { href: "/clients", label: "Clients", icon: "clients", group: "Clients", matches: ["/projects"] },
  { href: "/acquisition", label: "Acquisition", icon: "clients", group: "Clients" },
  { href: "/finance", label: "Prestations & Finance", icon: "reports", group: "Clients" },
  { href: "/publications", label: "Publications", icon: "publications", group: "Contenus" },
  { href: "/studio", label: "Studio vidéo", icon: "monitor", group: "Contenus" },
  { href: "/emailing", label: "Newsletters", icon: "publications", group: "Contenus" },
  { href: "/analytics", label: "Données et performances", icon: "analytics", group: "Performance" },
  { href: "/advertising", label: "Campagnes publicitaires", icon: "ads", group: "Performance" },
  { href: "/reports", label: "Rapports", icon: "reports", group: "Performance" },
  { href: "/agents", label: "Agents", icon: "agents", group: "Système" },
  { href: "/settings", label: "Paramètres", icon: "settings", group: "Système" },
];

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="space-y-1">
      {navigation.map(({ href, label, icon, group, matches = [] }, index) => {
        const active = within(pathname, href) || matches.some((path) => within(pathname, path));
        return (
          <Fragment key={href}>
          {index > 0 && navigation[index - 1].group !== group && <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted/80 uppercase" data-nav-group>{group}</p>}
          <Link
            href={href}
            onClick={onNavigate}
            aria-current={pathname === href ? "page" : active ? "location" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-accent/12 font-medium text-foreground ring-1 ring-accent/25 ring-inset" : "text-muted hover:bg-surface-raised hover:text-foreground"}`}
          >
            <Icon name={icon} width={18} height={18} className={active ? "text-accent-hover" : undefined} />
            {label}
          </Link>
          {/* Raccourci sous Publications : supervision (validations, erreurs, comptes, photos, agent), pensée pour le téléphone. */}
          {href === "/publications" && (
            <Link
              href="/publications/published"
              onClick={onNavigate}
              aria-current={within(pathname, "/publications/published") ? "page" : undefined}
              data-published-shortcut="sidebar"
              className={`ml-9 block rounded-lg px-3 py-1.5 text-xs transition-colors ${within(pathname, "/publications/published") ? "font-medium text-foreground" : "text-muted hover:bg-surface-raised hover:text-foreground"}`}
            >
              Calendrier
            </Link>
          )}
          {href === "/publications" && (
            <Link
              href="/publications/supervision"
              onClick={onNavigate}
              aria-current={within(pathname, "/publications/supervision") ? "page" : undefined}
              data-supervision-shortcut="sidebar"
              className={`ml-9 block rounded-lg px-3 py-1.5 text-xs transition-colors ${within(pathname, "/publications/supervision") ? "font-medium text-foreground" : "text-muted hover:bg-surface-raised hover:text-foreground"}`}
            >
              Supervision
            </Link>
          )}
          </Fragment>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" aria-label="CODE-V OS — accueil" className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-strong text-lg font-bold text-accent-foreground shadow-[0_6px_18px_-8px] shadow-accent/60">V</span>
      <span className="font-semibold tracking-tight">CODE-V <span className="font-normal text-muted">OS</span></span>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-y-auto border-r border-border bg-surface p-5 lg:flex">
      <Brand />
      <div className="mt-10">
        <NavigationLinks />
      </div>
    </aside>
  );
}

export function MobileNavigation() {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      id="mobile-menu"
      className="border-b border-border bg-surface lg:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between p-4">
        <span className="font-semibold">CODE-V <span className="text-muted">OS</span></span>
        <span className="flex items-center gap-2">
          <span className="rounded-lg border border-border-strong bg-surface-raised/40 px-3 py-2 text-xs">Menu</span>
        </span>
      </summary>
      <div className="px-4 pb-4">
        <NavigationLinks onNavigate={() => { if (ref.current) ref.current.open = false; }} />
      </div>
    </details>
  );
}

// Barre d'onglets du téléphone : les 4 destinations du quotidien toujours à portée de pouce, plus le menu complet.
const tabs: { href: string; label: string; icon: IconName; prefix: string }[] = [
  { label: "Accueil", href: "/dashboard", icon: "home", prefix: "/dashboard" },
  { label: "Clients", href: "/clients", icon: "clients", prefix: "/clients" },
  { label: "Calendrier", href: "/publications/published", icon: "calendar", prefix: "/publications/published" },
  { label: "À traiter", href: "/publications/supervision", icon: "check", prefix: "/publications/supervision" },
];
export function MobileTabBar() {
  const pathname = usePathname();
  const openMenu = () => {
    const menu = document.getElementById("mobile-menu") as HTMLDetailsElement | null;
    if (!menu) return;
    menu.open = true; window.scrollTo({ top: 0, behavior: "smooth" }); menu.querySelector("summary")?.focus();
  };
  const item = "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px]";
  return (
    <nav aria-label="Navigation rapide" data-mobile-tabbar className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {tabs.map((tab) => {
        const active = within(pathname, tab.prefix);
        return <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} data-supervision-shortcut={tab.prefix === "/publications/supervision" ? "mobile" : undefined} className={`${item} ${active ? "font-semibold text-accent-hover" : "text-muted"}`}>
          <Icon name={tab.icon} width={20} height={20} />{tab.label}</Link>;
      })}
      <button type="button" onClick={openMenu} className={`${item} text-muted`} aria-controls="mobile-menu"><Icon name="menu" width={20} height={20} />Menu</button>
    </nav>
  );
}

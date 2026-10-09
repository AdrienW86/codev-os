"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

// Navigation V2 : orientée usage quotidien. Les routes /projects, /tasks,
// /recommendations et /actions restent accessibles via les liens internes.
const navigation: { href: string; label: string; icon: IconName; matches?: string[] }[] = [
  { href: "/dashboard", label: "Accueil", icon: "home" },
  { href: "/clients", label: "Clients", icon: "clients", matches: ["/projects"] },
  { href: "/agenda", label: "Agenda", icon: "calendar" },
  { href: "/work", label: "Travail", icon: "work", matches: ["/tasks", "/recommendations", "/actions"] },
  { href: "/publications", label: "Publications", icon: "publications" },
  { href: "/reports", label: "Rapports", icon: "reports" },
  { href: "/agents", label: "Agents", icon: "agents" },
  { href: "/settings", label: "Paramètres", icon: "settings" },
];

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="space-y-1">
      {navigation.map(({ href, label, icon, matches = [] }) => {
        const active = within(pathname, href) || matches.some((path) => within(pathname, path));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={pathname === href ? "page" : active ? "location" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-white/5 hover:text-foreground"}`}
          >
            <Icon name={icon} width={18} height={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" aria-label="CODE-V OS — accueil" className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-lg font-bold text-background">V</span>
      <span className="font-semibold tracking-tight">CODE-V <span className="font-normal text-muted">OS</span></span>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-y-auto border-r border-border bg-[#141718] p-5 lg:flex">
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
      className="border-b border-border bg-[#141718] lg:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between p-4">
        <span className="font-semibold">CODE-V <span className="text-muted">OS</span></span>
        <span className="rounded-md border border-border px-3 py-2 text-xs">Menu</span>
      </summary>
      <div className="px-4 pb-4">
        <NavigationLinks onNavigate={() => { if (ref.current) ref.current.open = false; }} />
      </div>
    </details>
  );
}

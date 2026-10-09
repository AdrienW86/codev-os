"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/clients", label: "Clients", icon: "clients" },
  { href: "/projects", label: "Projects", icon: "projects" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/agents", label: "Agents", icon: "agents" },
  { href: "/recommendations", label: "Recommandations", icon: "recommendations" },
  { href: "/actions", label: "Actions", icon: "tasks" },
  { href: "/publications", label: "Publications", icon: "recommendations" },
  { href: "/settings", label: "Paramètres", icon: "settings" },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="space-y-1.5">
      {navigation.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          aria-current={pathname === href ? "page" : pathname.startsWith(`${href}/`) ? "location" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${pathname === href || pathname.startsWith(`${href}/`) ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-white/5 hover:text-foreground"}`}
        >
          <Icon name={icon} />
          {label}
        </Link>
      ))}
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
      <p className="mt-12 mb-4 px-3 text-[10px] tracking-[0.2em] text-muted uppercase">Espace de travail</p>
      <NavigationLinks />
      <div className="mt-auto pt-8">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Votre espace de pilotage.</p>
          <p className="mt-2 text-xs leading-5 text-muted">Clients, projets, tâches et agents réunis pour CODE-V.</p>
          <span className="mt-4 inline-block text-[10px] tracking-widest text-accent uppercase">Version 0.2 · Prototype</span>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-xs font-medium">CV</span>
        <div>
          <p className="text-xs font-medium">Équipe CODE-V</p>
          <p className="mt-1 text-xs text-muted">Espace interne</p>
        </div>
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

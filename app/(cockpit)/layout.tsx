import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/require-admin";
import { Header } from "@/components/layout/header";
import { MobileNavigation, Sidebar } from "@/components/layout/navigation";
import { SimulationBanner } from "@/components/simulation/simulation-banner";
import { SimulationProvider } from "@/components/simulation/simulation-provider";
import { getActiveScenario } from "@/lib/simulation/server";

export default async function CockpitLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const scenario = await getActiveScenario();
  return (
    <SimulationProvider scenarioId={scenario?.id ?? null}>
      <a href="#main-content" className="sr-only fixed top-4 left-4 z-50 rounded-lg bg-accent p-3 text-background focus:not-sr-only">Aller au contenu</a>
      <Sidebar />
      <div className="min-h-screen lg:pl-60">
        <MobileNavigation />
        <Header />
        <SimulationBanner />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
          {children}
          <footer className="mt-12 flex flex-wrap justify-between gap-2 border-t border-border pt-5 text-xs text-muted">
            <span>CODE-V OS</span>
            <span>Google Ads en lecture seule · Actions externes désactivées</span>
          </footer>
        </main>
      </div>
    </SimulationProvider>
  );
}

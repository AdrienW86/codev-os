import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeading } from "@/components/ui/primitives";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimReports } from "@/components/simulation/views/sim-reports";
import { SimulatedFeatureButton } from "@/components/simulation/simulated-feature";
import { TrySimulationButton } from "@/components/simulation/simulation-banner";
import { Action } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/states";

export const metadata: Metadata = { title: "Rapports" };

const upcomingReports: { title: string; description: string; icon: IconName }[] = [
  { title: "Rapport hebdomadaire", description: "Synthèse de la semaine : travail réalisé, publications et points d’attention.", icon: "calendar" },
  { title: "Rapport client", description: "Activité et performances d’un client, prêtes à partager.", icon: "clients" },
  { title: "Rapport activité globale", description: "Vue d’ensemble de l’agence sur tous les clients et agents.", icon: "business" },
];

export default async function ReportsPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <SimReports />;
  return (
    <>
      <PageHeading eyebrow="Suivi" title="Rapports" description="Suivez l’activité et les performances de vos clients."
        action={<SimulatedFeatureButton href="/reports" scenarioId="report-ready" title="Nouveau rapport" description={<p>L’Agent Rapport préparera des rapports hebdomadaires, mensuels et globaux à relire, modifier, approuver puis envoyer. Le moteur de rapport n’est pas encore disponible.</p>}>+ Nouveau rapport</SimulatedFeatureButton>} />
      <InlineNotice title="Les rapports automatiques arrivent dans une prochaine version." action={<><TrySimulationButton scenarioId="report-ready" href="/reports">Voir le parcours en simulation</TrySimulationButton><Action href="/clients">Synthèse mensuelle d’un client</Action></>}>
        En attendant, la synthèse mensuelle reste disponible dans chaque fiche client (Vue d’ensemble → Synthèse mensuelle).
      </InlineNotice>
      <section aria-labelledby="reports-upcoming" className="mt-10">
        <h2 id="reports-upcoming" className="mb-4 text-lg font-semibold">Types de rapports</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {upcomingReports.map((report) => (
            <li key={report.title} className="flex flex-col rounded-xl border border-border bg-surface p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-muted"><Icon name={report.icon} /></span>
              <h3 className="mt-4 font-semibold">{report.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted">{report.description}</p>
              <div className="mt-4"><TrySimulationButton scenarioId="report-ready" href="/reports">Voir un exemple</TrySimulationButton></div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeading } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Rapports" };

const upcomingReports: { title: string; description: string; icon: IconName }[] = [
  { title: "Rapport hebdomadaire", description: "Synthèse de la semaine : travail réalisé, publications et points d’attention.", icon: "calendar" },
  { title: "Rapport client", description: "Activité et performances d’un client, prêtes à partager.", icon: "clients" },
  { title: "Rapport activité globale", description: "Vue d’ensemble de l’agence sur tous les clients et agents.", icon: "business" },
];

export default async function ReportsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeading eyebrow="Suivi" title="Rapports" description="Suivez l’activité et les performances de vos clients." />
      <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon name="reports" /></span>
        <p className="mt-4 font-medium">Les rapports automatiques seront disponibles dans une prochaine version.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">La synthèse mensuelle reste disponible dans chaque fiche client.</p>
      </div>
      <section aria-labelledby="reports-upcoming" className="mt-10">
        <h2 id="reports-upcoming" className="mb-4 text-lg font-semibold">Bientôt disponibles</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {upcomingReports.map((report) => (
            <li key={report.title} className="flex flex-col rounded-xl border border-border bg-surface p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-muted"><Icon name={report.icon} /></span>
              <h3 className="mt-4 font-semibold">{report.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted">{report.description}</p>
              <span className="mt-5 inline-flex w-fit rounded-md bg-white/5 px-2 py-1 text-xs text-muted">Prochainement</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

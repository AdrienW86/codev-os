import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { ClientWatchCard } from "@/components/dashboard/client-watch-card";
import { listClients } from "@/lib/clients/data";
import { listProjects } from "@/lib/projects/data";
import { listTasks } from "@/lib/tasks/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { listActions } from "@/lib/actions/data";
import { watchClients } from "@/lib/dashboard/home";
import { getActiveScenario } from "@/lib/simulation/server";
import { requireAdmin } from "@/lib/require-admin";
import { SimClients } from "@/components/simulation/views/sim-clients";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <SimClients />;
  const clients = await listClients();
  const [projects, tasks, recommendations, actions] = await Promise.all([listProjects(), listTasks(), listRecommendations(), listActions()]);
  const watched = watchClients({ clients, projects, tasks, recommendations, actions }, 3);
  return (
    <>
      <PageHeading eyebrow="Portefeuille" title="Clients" description="Votre portefeuille CODE-V. Les informations clients sont enregistrées dans Supabase." action={<Link href="/clients/new" className="rounded-lg bg-accent-strong px-4 py-3 text-sm font-semibold text-accent-foreground">+ Nouveau client</Link>} />
      {watched.length > 0 && (
        <section aria-labelledby="watch-title" className="mb-8">
          <h2 id="watch-title" className="mb-4 font-semibold">À surveiller</h2>
          <ul className="grid gap-3 md:grid-cols-3">{watched.map((client) => <li key={client.id} className="min-w-0"><ClientWatchCard client={client} /></li>)}</ul>
        </section>
      )}
      <Panel>
        <div className="flex items-center justify-between border-b border-border p-4 sm:p-5"><h2 className="font-semibold">Votre portefeuille</h2><span className="text-xs text-muted">{clients.length} clients</span></div>
        {clients.length ? <ul className="divide-y divide-border">
          {clients.map((client) => {
            // Vue liste compacte : l'essentiel pour reconnaître le client ; tout le détail est sur sa fiche.
            const openTasks = tasks.filter((t) => t.client_id === client.id && t.status !== "Terminé").length;
            const toReview = recommendations.filter((r) => r.client_id === client.id && r.status === "pending").length;
            const subtitle = [client.activity, client.geographic_area].filter(Boolean).join(" · ");
            return (
              <li key={client.id}>
                <Link href={`/clients/${client.id}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-surface-raised sm:px-5" data-client-row aria-label={`Ouvrir la fiche de ${client.name}`}>
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 font-semibold text-accent-hover">{client.name.trim().charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{client.name}</span>
                    <span className="block truncate text-xs text-muted">{subtitle || "Activité non renseignée"}</span>
                  </span>
                  <span className="hidden shrink-0 flex-wrap justify-end gap-1.5 sm:flex">
                    {openTasks > 0 && <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-muted">{openTasks} tâche{openTasks > 1 ? "s" : ""}</span>}
                    {toReview > 0 && <span className="rounded-md bg-warning/10 px-2 py-0.5 text-xs text-warning">{toReview} à examiner</span>}
                  </span>
                  <span aria-hidden className="shrink-0 text-muted">›</span>
                </Link>
              </li>
            );
          })}
        </ul> : <div className="p-8"><h3 className="font-semibold">Votre portefeuille est prêt.</h3><p className="mt-2 text-sm text-muted">Aucun client enregistré. Ajoutez votre premier client pour commencer.</p><Link href="/clients/new" className="mt-5 inline-block text-sm text-accent">+ Nouveau client</Link></div>}
      </Panel>
    </>
  );
}

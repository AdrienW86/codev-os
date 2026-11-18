import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { PageHeading } from "@/components/ui/primitives";
import { listClients } from "@/lib/clients/data";
import { harnessCharters, harnessTeams } from "@/lib/harness/charter";
import { launchTasks } from "@/lib/launch/catalog";
import { LaunchButton } from "@/components/launch/launch-button";
import { getActiveScenario } from "@/lib/simulation/server";

export const metadata: Metadata = { title: "Lancer une action" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Toutes les tâches des agents, lançables tout de suite. Le client choisi en haut s'applique à toute la page.
export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ client?: string; agent?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const simulated = Boolean(await getActiveScenario());
  const clients = await listClients().catch(() => []);
  const clientId = params.client && UUID.test(params.client) && clients.some((c) => c.id === params.client) ? params.client : null;
  const client = clients.find((c) => c.id === clientId) ?? null;
  const agentFilter = params.agent ?? null;
  const charterBy = new Map(harnessCharters.map((c) => [c.id, c]));
  const tasks = launchTasks.filter((t) => !agentFilter || t.agent === agentFilter);
  return (
    <>
      <PageHeading eyebrow="Pilotage" title="Lancer une action"
        description="Chaque tâche des agents se lance ici tout de suite, avec les mêmes règles que le planificateur. Les actions cruciales (argent, envoi à un tiers, site du client, image générée) attendent toujours votre confirmation." />
      {simulated && <p className="mb-4 text-sm text-warning">Simulation active : aucun lancement réel.</p>}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" data-launch-client-picker="true">
        <label className="text-sm">Client
          <select name="client" defaultValue={clientId ?? ""} className="mt-1 block w-64 max-w-full rounded-lg border border-border bg-surface px-3 py-2">
            <option value="">Tous les clients (tâches globales)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {agentFilter && <input type="hidden" name="agent" value={agentFilter} />}
        <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm hover:border-accent/50">Choisir</button>
        {agentFilter && <Link href={clientId ? `/lancer?client=${clientId}` : "/lancer"} className="text-sm text-accent hover:underline">Toutes les tâches</Link>}
      </form>
      {harnessTeams.map((team) => {
        const teamTasks = tasks.filter((t) => charterBy.get(t.agent)?.team === team.id);
        if (!teamTasks.length) return null;
        return (
          <section key={team.id} className="mb-8" aria-labelledby={`launch-${team.id}`}>
            <h2 id={`launch-${team.id}`} className="mb-3 text-lg font-semibold">{team.name}</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {teamTasks.map((task) => {
                const needsClient = task.scope === "client" && !clientId;
                return (
                  <li key={task.id} className="rounded-xl border border-border bg-surface p-4" id={`task-${task.id}`}>
                    <p className="font-medium">{task.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{charterBy.get(task.agent)?.name} · {task.scope === "global" ? "tous les clients" : client ? client.name : "un client"}</p>
                    <p className="mt-2 text-sm text-muted">{task.effect}</p>
                    <div className="mt-3">
                      {task.href ? <Link href={task.href(clientId)} className="text-sm font-medium text-accent hover:underline">Ouvrir l’écran de lancement →</Link>
                        : needsClient ? <p className="text-sm text-muted">Choisissez un client en haut de page.</p>
                        : simulated ? <p className="text-sm text-muted">Indisponible en simulation.</p>
                        : <LaunchButton task={task.id} clientId={task.scope === "global" ? null : clientId}
                            confirm={task.paid ? `${task.label} : cet appel est facturé par le fournisseur. Lancer maintenant ?` : undefined} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

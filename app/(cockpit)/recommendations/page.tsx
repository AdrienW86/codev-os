import { ProjectContext } from "@/components/work/project-context";
import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeading } from "@/components/ui/primitives";
import { listClients } from "@/lib/clients/data";
import { listAgents } from "@/lib/agents/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { recommendationStatuses } from "@/lib/recommendations/validation";
import { formatDate } from "@/lib/format-date";

export const metadata: Metadata = { title: "Recommandations" };

export default async function RecommendationsPage({ searchParams }: PageProps<"/recommendations">) {
  await requireAdmin();
  const params = await searchParams;
  const status = typeof params.status === "string" && recommendationStatuses.includes(params.status as (typeof recommendationStatuses)[number]) ? params.status : undefined;
  const clientId = typeof params.clientId === "string" ? params.clientId : undefined;
  const agentId = typeof params.agentId === "string" ? params.agentId : undefined;
  const [recommendations, clients, agents] = await Promise.all([
    listRecommendations({ status, clientId, agentId }),
    listClients(),
    listAgents(),
  ]);
  return (
    <>
      <PageHeading eyebrow="Suivi" title="Recommandations" description="Pistes enregistrées par les agents, à examiner par l’administration." />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-4 border-b border-border pb-5">
        <label className="text-xs text-muted">Statut<select name="status" defaultValue={status ?? ""} className="mt-2 block min-w-40 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="">Tous</option>{recommendationStatuses.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs text-muted">Client<select name="clientId" defaultValue={clientId ?? ""} className="mt-2 block min-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="">Tous</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="text-xs text-muted">Agent<select name="agentId" defaultValue={agentId ?? ""} className="mt-2 block min-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="">Tous</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium">Filtrer</button>
      </form>
      {recommendations.length ? <ul className="divide-y divide-border">{recommendations.map((item) => <li key={item.id} className="py-5 first:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted">{item.client?.name ?? "Client indisponible"} · {item.agent?.name ?? "Agent indisponible"}</p><div className="flex gap-2"><Badge tone={item.severity === "high" || item.severity === "critical" ? "amber" : "neutral"}>{item.severity}</Badge><Badge>{item.status}</Badge></div></div>
        <h2 className="mt-3 text-lg font-semibold"><Link href={`/recommendations/${item.id}`} className="hover:text-accent hover:underline">{item.title}</Link></h2><ProjectContext projectId={item.project_id} project={item.project}/>
        {item.reason && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{item.reason}</p>}
        <time dateTime={item.created_at} className="mt-3 block text-xs text-muted">{formatDate(item.created_at)}</time>
      </li>)}</ul> : <p className="border-t border-border py-8 text-sm text-muted">Aucune recommandation pour ces filtres.</p>}
    </>
  );
}

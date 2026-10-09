import type { Metadata } from "next";
import { ProjectActivity } from "@/components/projects/project-activity";
import Link from "next/link";
import { PageHeading, Panel, Badge } from "@/components/ui/primitives";
import { ClientInformation } from "@/components/clients/client-information";
import { ClientMockPreview } from "@/components/clients/client-mock-preview";
import { ClientAgentAssignments } from "@/components/agents/client-agent-assignments";
import { ClientAgenticActivity } from "@/components/clients/client-agentic-activity";
import { ClientServicesPanel } from "@/components/clients/client-services-panel";
import { ServicesAgentsSection } from "@/components/clients/services-agents-section";
import { GoogleAdsPanel } from "@/components/clients/google-ads-panel";
import { ConfirmDeleteForm } from "@/components/ui/confirm-delete-form";
import { getClientOrNotFound } from "@/lib/clients/data";
import { listProjectsByClient } from "@/lib/projects/data";
import { listTasksByClient } from "@/lib/tasks/data";
import { listAgents, listAgentsForClient } from "@/lib/agents/data";
import { listAgentProjectAssignments } from "@/lib/agents/project-assignments";
import { buildClientServicesView } from "@/lib/services/client-view";
import { listRecommendationsByClient } from "@/lib/recommendations/data";
import { listRunsByClient } from "@/lib/agent-runs/data";
import { listActions } from "@/lib/actions/data";
import { listClientServices } from "@/lib/client-services/data";
import { listAuditLogsByResource } from "@/lib/audit-logs";
import { formatDate } from "@/lib/format-date";
import { deleteClientAction } from "@/app/(cockpit)/clients/[id]/actions";

// Aucun generateStaticParams : les UUID réels sont résolus à chaque requête.
export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const client = await getClientOrNotFound(id);
  return { title: client.name };
}

export default async function ClientDetailPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const client = await getClientOrNotFound(id);
  const { ads_days } = await searchParams;
  const adsDays = typeof ads_days === "string" && ["7", "30", "90"].includes(ads_days) ? Number(ads_days) : 30;
  const [projects, tasks, assignments, agents, recommendations, runs, actions, services, auditEntries, projectAssignments] = await Promise.all([
    listProjectsByClient(client.id),
    listTasksByClient(client.id),
    listAgentsForClient(client.id),
    listAgents(),
    listRecommendationsByClient(client.id, 5),
    listRunsByClient(client.id, 5),
    listActions({ clientId: client.id, limit: 5 }),
    listClientServices(client.id),
    listAuditLogsByResource("client", client.id, 10),
    // Facultatif : sans périmètres projet, la vue services reste affichée.
    listAgentProjectAssignments({ clientId: client.id }).catch(() => []),
  ]);
  const servicesView = buildClientServicesView({
    services,
    agents,
    assignedAgentIds: new Set([...assignments, ...projectAssignments].filter((item) => item.enabled).map((item) => item.agent_id)),
  });
  const assignmentAgents = agents.map(({ id, name, status, enabled, autonomy_level, agent_scope, scope_review_required }) => ({ id, name, status, enabled, autonomy_level,agent_scope,scope_review_required }));
  const assignmentSummaries = assignments.map(({ agent_id, client_id, enabled, client_instructions, agent }) => ({
    agent_id,
    client_id,
    enabled,
    client_instructions,
    agent: agent ? { id: agent.id, name: agent.name, status: agent.status, enabled: agent.enabled, autonomy_level: agent.autonomy_level,agent_scope:agent.agent_scope,scope_review_required:agent.scope_review_required } : null,
  }));
  return (
    <>
      <Link href="/clients" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les clients</Link>
      <PageHeading eyebrow="Dossier client" title={client.name} description={[client.activity, client.geographic_area].filter(Boolean).join(" · ") || "Informations enregistrées dans votre portefeuille."} action={<div className="flex flex-wrap items-center gap-3"><Badge tone="green">Client enregistré</Badge><Link href={`/clients/${client.id}/edit`} className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium">Modifier</Link><ConfirmDeleteForm action={deleteClientAction} fields={{ id: client.id }} confirmationMessage="Supprimer définitivement ce client ? Les projets, tâches ou assignations liées peuvent aussi être supprimés selon les clés étrangères configurées dans Supabase." /></div>} />
      <Panel className="p-6"><h2 className="mb-5 font-semibold">Informations entreprise</h2><ClientInformation client={client} includeNotes /></Panel>
      <ServicesAgentsSection services={servicesView.services} otherServices={servicesView.otherServices} />
      <ClientServicesPanel clientId={client.id} services={services} />
      <Panel className="mt-6 p-6"><h2 className="font-semibold">Agents au niveau client</h2><ul className="mt-3 space-y-2">{assignments.filter(a=>a.agent?.agent_scope==="client").map(a=><li key={a.agent_id}><Link className="text-accent" href={`/agents/${a.agent_id}`}>{a.agent?.name}</Link> · {a.enabled?"Rattachement actif":"Rattachement désactivé"}{a.agent?.scope_review_required?" · Portée à vérifier":""}</li>)}</ul><Link className="mt-4 inline-block text-accent" href={`/clients/${client.id}/summary`}>Préparer la synthèse mensuelle</Link></Panel>
      <section className="mt-6 space-y-4" aria-label="Activité par projet"><h2 className="font-semibold">Projets et spécialistes</h2>{projects.map(project=><Panel key={project.id} className="p-5"><details><summary className="cursor-pointer font-medium">{project.name} · {project.type??"Type non défini"} · {project.status}</summary><Link href={`/projects/${project.id}`} className="mt-3 inline-block text-sm text-accent">Ouvrir le projet</Link><ProjectActivity project={project}/></details></Panel>)}{!projects.length&&<p className="text-sm text-muted">Aucun projet enregistré.</p>}</section>
      <GoogleAdsPanel clientId={client.id} days={adsDays} />
      <ClientAgentAssignments clientId={client.id} agents={assignmentAgents} assignments={assignmentSummaries} />
      <ClientAgenticActivity recommendations={recommendations} runs={runs} actions={actions} />
      <Panel className="mt-8 p-5"><h2 className="font-semibold">Audit de la fiche client</h2>{auditEntries.length ? <ol className="mt-4 space-y-3">{auditEntries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><span className="text-sm">{entry.action} · {entry.actor_type}</span><time className="text-xs text-muted" dateTime={entry.created_at}>{formatDate(entry.created_at)}</time></li>)}</ol> : <p className="mt-3 text-sm text-muted">Aucun événement d’audit enregistré pour cette fiche.</p>}</Panel>
      <ClientMockPreview projects={projects} tasks={tasks} agents={agents} />
    </>
  );
}

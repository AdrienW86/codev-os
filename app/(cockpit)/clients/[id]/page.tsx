import type { Metadata } from "next";
import Link from "next/link";
import { ProjectActivity } from "@/components/projects/project-activity";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { ClientInformation } from "@/components/clients/client-information";
import { ClientAgentAssignments } from "@/components/agents/client-agent-assignments";
import { ClientAgenticActivity } from "@/components/clients/client-agentic-activity";
import { ClientServicesPanel } from "@/components/clients/client-services-panel";
import { ServicesAgentsSection } from "@/components/clients/services-agents-section";
import { GoogleAdsPanel } from "@/components/clients/google-ads-panel";
import { CampaignDashboard } from "@/components/google-ads/campaign-dashboard";
import { parseFilters } from "@/lib/integrations/google-ads/dashboard";
import { ANALYSIS_ENGINE_NOTE, loadCampaignDashboard } from "@/lib/integrations/google-ads/service";
import { loadGoogleAdsDashboardAction, prepareGoogleAdsReportAction, runGoogleAdsScopeAnalysisAction, runGoogleAdsScopeAIAnalysisAction } from "@/app/(cockpit)/clients/[id]/google-ads-actions";
import { ClientSourcesPanel } from "@/components/clients/client-sources-panel";
import { listClientSources } from "@/lib/connections/service";
import { safeRead } from "@/lib/core/safe-read";
import { ProjectCard, TaskCard } from "@/components/work/work-cards";
import { ConfirmDeleteForm } from "@/components/ui/confirm-delete-form";
import { Action } from "@/components/ui/button";
import { ActivityItem, SectionHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { SimClient } from "@/components/simulation/views/sim-client";
import { TrySimulationButton } from "@/components/simulation/simulation-banner";
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
import { actionStatusLabel, actionTypeLabel, recommendationStatusLabel, runStatusLabel } from "@/lib/presentation/labels";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { deleteClientAction } from "@/app/(cockpit)/clients/[id]/actions";

const isSimulatedId = (id: string) => id.startsWith("sim-");
const tabIds = ["overview", "projects", "ads", "agents", "activity", "information"] as const;
type TabId = (typeof tabIds)[number];

// Aucun generateStaticParams : les UUID réels sont résolus à chaque requête.
export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (isSimulatedId(id)) return { title: "Client (simulation)" };
  const client = await getClientOrNotFound(id);
  return { title: client.name };
}

export default async function ClientDetailPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  await requireAdmin();
  const { id } = await params;

  // Fiche simulée : jamais de lecture en base.
  if (isSimulatedId(id)) {
    if (await getActiveScenario()) return <SimClient id={id} />;
    return <EmptyState icon="clients" title="Ce client appartient à la simulation." description="La simulation n’est pas active. Activez-la pour ouvrir cette fiche fictive, ou revenez à vos clients réels."
      action={<><TrySimulationButton href={`/clients/${id}`} /><Action href="/clients">Clients réels</Action></>} />;
  }

  const client = await getClientOrNotFound(id);
  const search = await searchParams;
  const tab: TabId = tabIds.includes(search.tab as TabId) ? (search.tab as TabId) : "overview";
  const sources = tab === "agents" ? await safeRead("sources", () => listClientSources(client.id), []) : { data: [], unavailable: false };
  // Campagnes Google Ads : filtres lus dans l'URL, données chargées côté serveur pour le premier rendu ;
  // les changements de filtres sont ensuite rechargés sur place par le composant (aucune navigation).
  const adsFilters = tab === "ads" ? parseFilters(search) : null;
  const adsInitial = adsFilters ? await loadCampaignDashboard(client.id, adsFilters) : null;
  const [projects, tasks, assignments, agents, recommendations, runs, actions, services, projectAssignments] = await Promise.all([
    listProjectsByClient(client.id),
    listTasksByClient(client.id),
    listAgentsForClient(client.id),
    listAgents(),
    listRecommendationsByClient(client.id, 10),
    listRunsByClient(client.id, 5),
    listActions({ clientId: client.id, limit: 10 }),
    listClientServices(client.id),
    // Facultatif : sans périmètres projet, la vue services reste affichée.
    listAgentProjectAssignments({ clientId: client.id }).catch(() => []),
  ]);
  const openTasks = tasks.filter((task) => task.status !== "Terminé");
  const pendingRecommendations = recommendations.filter((item) => item.status === "pending");
  const pendingActions = actions.filter((item) => item.status === "pending_approval");
  const toHandle = openTasks.length + pendingRecommendations.length + pendingActions.length;
  const href = (tabId: TabId) => tabId === "overview" ? `/clients/${client.id}` : `/clients/${client.id}?tab=${tabId}`;

  return (
    <>
      <Link href="/clients" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les clients</Link>
      <PageHeading eyebrow="Dossier client" title={client.name} description={[client.activity, client.geographic_area].filter(Boolean).join(" · ") || "Informations enregistrées dans votre portefeuille."} action={<Action href={`/clients/${client.id}/edit`}>Modifier</Action>} />
      <p className="mb-4 text-sm"><Link href={`/advertising?client=${client.id}`} className="text-accent">Campagnes publicitaires →</Link></p>
      <Tabs label="Sections du dossier client" current={tab} items={[
        { id: "overview", label: "Vue d’ensemble", href: href("overview") },
        { id: "projects", label: "Projets & tâches", href: href("projects"), count: projects.length },
        { id: "ads", label: "Campagnes", href: href("ads") },
        { id: "agents", label: "Agents", href: href("agents") },
        { id: "activity", label: "Activité", href: href("activity") },
        { id: "information", label: "Informations", href: href("information") },
      ]} />

      {tab === "overview" && (() => {
        const servicesView = buildClientServicesView({
          services, agents,
          assignedAgentIds: new Set([...assignments, ...projectAssignments].filter((item) => item.enabled).map((item) => item.agent_id)),
        });
        return (
          <>
            <ServicesAgentsSection clientId={client.id} services={servicesView.services} otherServices={servicesView.otherServices} />
            {toHandle > 0 && (
              <section aria-labelledby="client-work" className="mt-10">
                <SectionHeader id="client-work" title="Travail à traiter" count={toHandle} action={<Link href="/work" className="text-sm text-accent hover:underline">Ouvrir Travail</Link>} />
                <Panel className="px-5"><ul className="divide-y divide-border">
                  {pendingActions.map((item) => <ActivityItem key={item.id} title={actionTypeLabel(item.action_type)} href="/actions?status=pending_approval" meta={`Action · ${item.agent?.name ?? "Agent"}`} status={actionStatusLabel(item.status)} />)}
                  {pendingRecommendations.map((item) => <ActivityItem key={item.id} title={item.title} href={`/recommendations/${item.id}`} meta={`Recommandation · ${item.agent?.name ?? "Agent"}`} status={recommendationStatusLabel(item.status)} />)}
                  {openTasks.map((task) => <ActivityItem key={task.id} title={task.title} href={`/tasks/${task.id}/edit`} meta={`Tâche${task.project ? ` · ${task.project.name}` : ""}`} status={{ label: task.status, tone: task.priority === "Haute" ? "amber" : "neutral" }} time={task.due_date ? { iso: task.due_date, label: formatDate(task.due_date) } : undefined} />)}
                </ul></Panel>
              </section>
            )}
            {projects.length > 0 && (
              <section aria-labelledby="client-projects-summary" className="mt-10">
                <SectionHeader id="client-projects-summary" title="Projets" count={projects.length} action={<Link href={href("projects")} className="text-sm text-accent hover:underline">Projets & tâches</Link>} />
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{projects.map((project) => (
                  <li key={project.id}><Link href={`/projects/${project.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-accent/40"><span className="block font-medium">{project.name}</span><span className="mt-1 block text-xs text-muted">{project.type ?? "Projet"} · {project.status} · {project.progress} %</span></Link></li>
                ))}</ul>
              </section>
            )}
            <section aria-labelledby="client-links" className="mt-10">
              <SectionHeader id="client-links" title="Publications & rapports" />
              <div className="grid gap-3 md:grid-cols-2">
                <Link href={`/publications?client=${client.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-accent/40"><span className="block font-medium">Publications du client</span><span className="mt-1 block text-sm text-muted">Tableau des publications filtré sur {client.name}.</span></Link>
                <Link href={`/clients/${client.id}/summary`} className="block rounded-xl border border-border bg-surface p-4 hover:border-accent/40"><span className="block font-medium">Synthèse mensuelle</span><span className="mt-1 block text-sm text-muted">Activité du mois, organisée par projet. Les rapports automatiques arrivent bientôt.</span></Link>
              </div>
            </section>
            {runs.length > 0 && (
              <Panel className="mt-10 p-5">
                <h2 className="font-semibold">Activité récente</h2>
                <ul className="mt-2 divide-y divide-border">{runs.map((run) => <ActivityItem key={run.id} title={run.agent?.name ?? "Agent"} href={`/agents/${run.agent_id}`} meta={run.project?.name} status={runStatusLabel(run.status)} time={{ iso: run.started_at, label: formatDate(run.started_at) }} />)}</ul>
              </Panel>
            )}
          </>
        );
      })()}

      {tab === "projects" && (
        <div className="space-y-10">
          <section aria-labelledby="client-projects">
            <SectionHeader id="client-projects" title="Projets" count={projects.length} action={<Action href="/projects/new">+ Nouveau projet</Action>} />
            {projects.length ? <div className="grid gap-5 md:grid-cols-2">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div>
              : <EmptyState compact icon="projects" title="Aucun projet pour ce client." action={<Action href="/projects/new" variant="primary">+ Nouveau projet</Action>} />}
          </section>
          <section aria-labelledby="client-tasks">
            <SectionHeader id="client-tasks" title="Tâches" count={tasks.length} action={<Action href="/tasks/new">+ Nouvelle tâche</Action>} />
            {tasks.length ? <div className="grid gap-5 md:grid-cols-2">{tasks.map((task) => <TaskCard key={task.id} task={task} agents={agents} />)}</div>
              : <EmptyState compact icon="tasks" title="Aucune tâche pour ce client." action={<Action href="/tasks/new" variant="primary">+ Nouvelle tâche</Action>} />}
          </section>
          {projects.length > 0 && <section aria-label="Activité par projet" className="space-y-4"><h2 className="font-semibold">Activité des spécialistes par projet</h2>{projects.map((project) => <Panel key={project.id} className="p-5"><details><summary className="min-h-10 cursor-pointer font-medium">{project.name} · {project.type ?? "Type non défini"} · {project.status}</summary><Link href={`/projects/${project.id}`} className="mt-3 inline-block text-sm text-accent">Ouvrir le projet</Link><ProjectActivity project={project} /></details></Panel>)}</section>}
        </div>
      )}

      {tab === "agents" && (() => {
        const assignmentAgents = agents.map(({ id, name, status, enabled, autonomy_level, agent_scope, scope_review_required }) => ({ id, name, status, enabled, autonomy_level, agent_scope, scope_review_required }));
        const assignmentSummaries = assignments.map(({ agent_id, client_id, enabled, client_instructions, agent }) => ({
          agent_id, client_id, enabled, client_instructions,
          agent: agent ? { id: agent.id, name: agent.name, status: agent.status, enabled: agent.enabled, autonomy_level: agent.autonomy_level, agent_scope: agent.agent_scope, scope_review_required: agent.scope_review_required } : null,
        }));
        return (
          <>
            <ClientAgentAssignments clientId={client.id} agents={assignmentAgents} assignments={assignmentSummaries} />
            <GoogleAdsPanel clientId={client.id} />
            <div className="mt-8"><ClientSourcesPanel clientId={client.id} sources={sources.data} unavailable={sources.unavailable} /></div>
          </>
        );
      })()}

      {tab === "ads" && adsFilters && adsInitial && (
        <CampaignDashboard clientId={client.id} initial={adsInitial} initialFilters={adsFilters} load={loadGoogleAdsDashboardAction}
          prepareReport={prepareGoogleAdsReportAction} runAnalysis={runGoogleAdsScopeAnalysisAction} runAIAnalysis={runGoogleAdsScopeAIAnalysisAction} analysisNote={ANALYSIS_ENGINE_NOTE} />
      )}

      {tab === "activity" && <ActivityTab clientId={client.id} recommendations={recommendations} runs={runs} actions={actions} />}

      {tab === "information" && (
        <>
          <Panel className="p-6"><h2 className="mb-5 font-semibold">Informations entreprise</h2><ClientInformation client={client} includeNotes /></Panel>
          <ClientServicesPanel clientId={client.id} services={services} />
          <section aria-labelledby="client-danger" className="mt-10 rounded-xl border border-red-400/20 p-5">
            <h2 id="client-danger" className="font-semibold">Supprimer le client</h2>
            <p className="mt-1 mb-4 text-sm text-muted">Action définitive. Les projets, tâches ou assignations liés peuvent aussi être supprimés.</p>
            <ConfirmDeleteForm action={deleteClientAction} fields={{ id: client.id }} confirmationMessage="Supprimer définitivement ce client ? Les projets, tâches ou assignations liées peuvent aussi être supprimés selon les clés étrangères configurées dans Supabase." />
          </section>
        </>
      )}
    </>
  );
}

async function ActivityTab({ clientId, recommendations, runs, actions }: { clientId: string } & Pick<Parameters<typeof ClientAgenticActivity>[0], "recommendations" | "runs" | "actions">) {
  const auditEntries = await listAuditLogsByResource("client", clientId, 10);
  return (
    <>
      <ClientAgenticActivity recommendations={recommendations} runs={runs} actions={actions} />
      <Panel className="mt-8 p-5">
        <details>
          <summary className="min-h-10 cursor-pointer font-semibold">Journal technique de la fiche <span className="text-sm font-normal text-muted">({auditEntries.length})</span></summary>
          {auditEntries.length ? <ol className="mt-4 space-y-3">{auditEntries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><span className="font-mono text-xs">{entry.action} · {entry.actor_type}</span><time className="text-xs text-muted" dateTime={entry.created_at}>{formatDate(entry.created_at)}</time></li>)}</ol> : <p className="mt-3 text-sm text-muted">Aucun événement enregistré pour cette fiche.</p>}
        </details>
      </Panel>
    </>
  );
}

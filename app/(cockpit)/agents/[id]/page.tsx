import type { Metadata } from "next";
import { actionStatusLabel, actionTypeLabel, recommendationStatusLabel, runStatusLabel } from "@/lib/presentation/labels";
import { ScopeControls } from "@/components/agents/scope-controls";
import { ProjectContext } from "@/components/work/project-context";
import { listAgentProjectAssignments } from "@/lib/agents/project-assignments";
import { listProjectsByClient } from "@/lib/projects/data";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentForm } from "@/components/agents/agent-form";
import { ConfirmDeleteForm } from "@/components/ui/confirm-delete-form";
import { deleteAgentAction } from "./actions";
import { AgentTestRunForm } from "@/components/agents/agent-test-run-form";
import { GoogleAdsRunForm } from "@/components/agents/google-ads-run-form";
import { Badge, PageHeading, Panel } from "@/components/ui/primitives";
import { getAgentById, listClientsForAgent } from "@/lib/agents/data";
import { ANALYSIS_ENGINE_NOTE, isGoogleAdsAgent } from "@/lib/integrations/google-ads/service";
import { requireAdmin } from "@/lib/require-admin";
import { listRunsByAgent } from "@/lib/agent-runs/data";
import { listRecommendationsByAgent } from "@/lib/recommendations/data";
import { listActionsByAgent } from "@/lib/actions/data";
import { formatDate } from "@/lib/format-date";

export async function generateMetadata({ params }: PageProps<"/agents/[id]">): Promise<Metadata> {
  const { id } = await params;
  const agent = await getAgentById(id);
  return { title: agent?.name ?? "Agent" };
}

export default async function AgentDetailPage({ params, searchParams }: PageProps<"/agents/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const [agent, assignments, runs, recommendations, actions] = await Promise.all([
    getAgentById(id), listClientsForAgent(id), listRunsByAgent(id), listRecommendationsByAgent(id), listActionsByAgent(id),
  ]);
  if (!agent) notFound();
  const [projectAssignments,clientProjects]=await Promise.all([listAgentProjectAssignments({agentId:id}),Promise.all(assignments.map(a=>listProjectsByClient(a.client_id)))]);
  const scopeProjects=clientProjects.flat().map(p=>({id:p.id,name:p.name,clientName:p.client?.name??"Client",enabled:projectAssignments.some(a=>a.project_id===p.id&&a.enabled)}));
  const { updated } = await searchParams;
  // Identification par le registre (agent_type), jamais par le nom affiché.
  const googleAds = isGoogleAdsAgent(agent);
  const activeClients = assignments.filter((item) => item.enabled && item.client).map((item) => ({ id: item.client_id, name: item.client?.name ?? "Client" }));
  const realAnalysis = googleAds && <Panel className="mb-6 border-accent/30 p-6">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Analyse réelle Google Ads</h2><Badge tone="green">Données réelles</Badge><Badge>Lecture seule</Badge><Badge>Sans IA</Badge></div>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{ANALYSIS_ENGINE_NOTE} Aucune modification Google Ads. Une connexion vérifiée est nécessaire sur la fiche client.</p>
    <ul className="mt-4 space-y-2 text-sm">{assignments.filter((item) => item.client).map((item) => <li key={item.client_id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link href={`/clients/${item.client_id}?tab=ads`} className="text-accent hover:underline">{item.client?.name} : campagnes et analyse par périmètre</Link>
      <span className="text-xs text-muted">{item.enabled ? "assignation active" : "assignation désactivée"} · instructions client : {item.client_instructions ? "renseignées, non utilisées par ce moteur" : "aucune"}</span>
    </li>)}</ul>
    {agent.enabled && agent.status === "Actif" ? <GoogleAdsRunForm agentId={agent.id} clients={activeClients} /> : <p className="mt-4 text-sm text-muted">Activez l’agent et passez son statut à Actif pour lancer une analyse réelle.</p>}
  </Panel>;

  return (
    <>
      <Link href="/agents" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les agents</Link>
      {updated === "1" && <p role="status" className="mb-6 rounded-lg border border-green-400/30 bg-green-400/10 p-4 text-sm text-green-400">Les modifications de l’agent ont été enregistrées.</p>}
      <Link href="#modifier" className="mb-4 inline-block text-sm text-accent hover:underline">Modifier l’agent</Link>
      <Panel className="mb-6 p-6"><h2 className="mb-4 font-semibold">Portée et autorisations projet</h2><ScopeControls agentId={id} scope={agent.agent_scope} review={agent.scope_review_required} projects={scopeProjects}/>{agent.agent_scope==="client"&&<div className="mt-4 space-y-3">{assignments.map(a=><div key={a.client_id}><Link className="text-accent" href={`/clients/${a.client_id}/summary`}>Synthèse : {a.client?.name??"Client"}</Link><ul className="mt-2 flex flex-wrap gap-3">{clientProjects.flat().filter(p=>p.client_id===a.client_id).map(p=><li key={p.id}><Link href={`/projects/${p.id}`}>{p.name}</Link></li>)}</ul></div>)}</div>}</Panel>
      <PageHeading eyebrow="Configuration agent" title={agent.name} description={googleAds ? "Agent Google Ads : analyse réelle en lecture seule par règles déterministes (sans IA). Le test interne, distinct, n’utilise aucune donnée Google Ads." : "Configuration enregistrée. Les analyses de test restent internes et n’appellent ni IA ni API externe."} action={<div className="flex gap-2"><Badge tone={agent.status === "Actif" ? "green" : "neutral"}>{agent.status}</Badge><Badge tone={agent.enabled ? "green" : "neutral"}>{agent.enabled ? "Activé" : "Désactivé"}</Badge></div>} />
      {realAnalysis}
      <section id="agent-test-run" className="mb-6"><Panel className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="font-semibold">Test interne</h2><Badge tone="amber">Simulation</Badge></div><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Vérifie la chaîne run → recommandation avec un contenu fictif et déterministe. N’utilise aucune donnée réelle{googleAds ? " Google Ads" : ""}, aucune IA ni API externe ; ce n’est pas une analyse du compte.</p></div></div>
        {agent.enabled && agent.status === "Actif" ? agent.agent_scope === "project" ? <p className="mt-4 text-sm text-muted">Choisissez un projet autorisé dans la section Portée.</p> : <AgentTestRunForm agentId={agent.id} clients={assignments.filter((item) => item.enabled && item.client).map((item) => ({ id: item.client_id, name: item.client?.name ?? "Client" }))} /> : <p className="mt-4 text-sm text-muted">Activez cet agent et passez son statut à Actif avant de lancer une analyse.</p>}
      </Panel></section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <section id="modifier"><Panel className="p-6"><h2 className="mb-5 font-semibold">Modifier — paramètres et instructions globales</h2><AgentForm agent={agent} /></Panel></section>
        <div className="space-y-6">
          <Panel className="border-red-400/20 p-6"><h2 className="font-semibold">Suppression de l’agent</h2><p className="my-4 text-sm leading-6 text-muted">Cet agent peut avoir des clients assignés, des runs, des recommandations, des actions et des messages. Les contraintes existantes peuvent refuser sa suppression ou supprimer des relations associées.</p><ConfirmDeleteForm action={deleteAgentAction} fields={{ id: agent.id, confirmed: "true" }} buttonText="Supprimer l’agent" confirmationMessage="Supprimer définitivement cet agent ? Les relations supprimées par cascade le seront aussi. Cette opération est irréversible." /></Panel>
          <Panel className="p-6">
            <h2 className="font-semibold">Clients assignés <span className="text-sm font-normal text-muted">({assignments.length})</span></h2>
            {assignments.length ? <ul className="mt-4 divide-y divide-border">{assignments.map((assignment) => <li key={assignment.client_id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/clients/${assignment.client_id}`} className="text-sm font-medium text-accent hover:underline">{assignment.client?.name ?? "Client indisponible"}</Link><Badge tone={assignment.enabled ? "green" : "neutral"}>{assignment.enabled ? "Activé" : "Désactivé"}</Badge></div>
              {assignment.client_instructions && <div className="mt-3"><p className="text-xs text-muted">Instructions propres au client{googleAds ? " — non utilisées par l’analyse Google Ads actuelle (moteur déterministe)" : ""} :</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted">{assignment.client_instructions}</p></div>}
            </li>)}</ul> : <p className="mt-4 text-sm text-muted">Aucun client assigné.</p>}
          </Panel>
        </div>
      </div>
      <div className="mt-8 grid items-start gap-5 xl:grid-cols-3">
        <Panel className="p-5"><h2 className="font-semibold">Dernières analyses</h2>{runs.length ? <ul className="mt-4 space-y-4">{runs.slice(0, 5).map((run) => <li key={run.id} className="border-t border-border pt-3"><div className="flex justify-between gap-2"><Badge tone={runStatusLabel(run.status).tone}>{runStatusLabel(run.status).label}</Badge><time className="text-xs text-muted" dateTime={run.started_at}>{formatDate(run.started_at)}</time></div><p className="mt-2 text-sm">{run.summary ?? "Analyse en cours"}</p><ProjectContext projectId={run.project_id} project={run.project}/></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune analyse enregistrée.</p>}</Panel>
        <Panel className="p-5"><h2 className="font-semibold">Dernières recommandations</h2>{recommendations.length ? <ul className="mt-4 space-y-4">{recommendations.slice(0, 5).map((item) => <li key={item.id} className="border-t border-border pt-3"><Link href={`/recommendations/${item.id}`} className="text-sm font-medium hover:text-accent hover:underline">{item.title}</Link><ProjectContext projectId={item.project_id} project={item.project}/><div className="mt-2"><Badge tone={recommendationStatusLabel(item.status).tone}>{recommendationStatusLabel(item.status).label}</Badge></div></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune recommandation enregistrée.</p>}</Panel>
        <Panel className="p-5"><h2 className="font-semibold">Actions récentes</h2>{actions.length ? <ul className="mt-4 space-y-4">{actions.slice(0, 5).map((item) => <li key={item.id} className="flex justify-between gap-2 border-t border-border pt-3"><div className="text-sm">{actionTypeLabel(item.action_type)}<ProjectContext projectId={item.project_id} project={item.project}/></div><Badge tone={actionStatusLabel(item.status).tone}>{actionStatusLabel(item.status).label}</Badge></li>)}</ul> : <p className="mt-3 text-sm text-muted">Aucune action enregistrée.</p>}</Panel>
      </div>
    </>
  );
}

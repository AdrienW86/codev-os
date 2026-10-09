import { ProjectContext } from "@/components/work/project-context";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeading, Panel } from "@/components/ui/primitives";
import { RecommendationControls } from "@/components/recommendations/recommendation-controls";
import { listActionsByRecommendation } from "@/lib/actions/data";
import { listMessagesByRecommendation } from "@/lib/agent-messages/data";
import { getRecommendationById } from "@/lib/recommendations/data";
import { formatDate } from "@/lib/format-date";
import { requireAdmin } from "@/lib/require-admin";

export async function generateMetadata({ params }: PageProps<"/recommendations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const recommendation = await getRecommendationById(id);
  return { title: recommendation?.title ?? "Recommandation" };
}

export default async function RecommendationDetailPage({ params }: PageProps<"/recommendations/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const recommendation = await getRecommendationById(id);
  if (!recommendation) notFound();
  const [messages, actions] = await Promise.all([listMessagesByRecommendation(id), listActionsByRecommendation(id)]);
  return (
    <>
      <Link href="/recommendations" className="mb-6 inline-block text-xs text-accent hover:underline">← Toutes les recommandations</Link>
      <PageHeading eyebrow="Recommandation" title={recommendation.title} description="Recommandation enregistrée. Aucune API externe ni exécution automatique n’est connectée." action={<Badge>{recommendation.status}</Badge>} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <div className="space-y-6">
          <Panel className="p-6">
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm"><span>Client : <Link href={`/clients/${recommendation.client_id}`} className="text-accent hover:underline">{recommendation.client?.name ?? "Client indisponible"}</Link></span><span>Agent : <Link href={`/agents/${recommendation.agent_id}`} className="text-accent hover:underline">{recommendation.agent?.name ?? "Agent indisponible"}</Link></span></div>
            <ProjectContext projectId={recommendation.project_id} project={recommendation.project}/><dl className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
              <div><dt className="text-xs text-muted">Statut</dt><dd className="mt-1 text-sm">{recommendation.status}</dd></div>
              <div><dt className="text-xs text-muted">Sévérité</dt><dd className="mt-1 text-sm">{recommendation.severity}</dd></div>
              <div><dt className="text-xs text-muted">Créée</dt><dd className="mt-1 text-sm"><time dateTime={recommendation.created_at}>{formatDate(recommendation.created_at)}</time></dd></div>
            </dl>
            <div className="mt-5 border-t border-border pt-5"><h2 className="text-sm font-semibold">Raison</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{recommendation.reason || "Aucune raison fournie."}</p></div>
            <details className="mt-5 border-t border-border pt-5"><summary className="cursor-pointer text-sm font-medium">Données techniques</summary><pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-background p-4 text-xs leading-5 text-muted">{JSON.stringify(recommendation.payload, null, 2)}</pre></details>
          </Panel>
          <Panel className="p-6">
            <h2 className="font-semibold">Conversation <span className="text-sm font-normal text-muted">({messages.length})</span></h2>
            {messages.length ? <ol className="mt-5 space-y-5">{messages.map((message) => <li key={message.id} className="border-l-2 border-border pl-4">
              <div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-medium">{message.sender_type === "admin" ? "Administration" : message.sender_type === "system" ? "Système" : "Agent (message existant)"}</span><time dateTime={message.created_at} className="text-xs text-muted">{formatDate(message.created_at)}</time></div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.message}</p>
            </li>)}</ol> : <p className="mt-4 text-sm text-muted">Aucun message enregistré.</p>}
          </Panel>
          <Panel className="p-6">
            <h2 className="font-semibold">Actions liées <span className="text-sm font-normal text-muted">({actions.length})</span></h2>
            {actions.length ? <ul className="mt-4 divide-y divide-border">{actions.map((action) => <li key={action.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{action.action_type}</p><p className="mt-1 text-xs text-muted">{action.requires_approval ? "Approbation requise" : "Approbation non requise"}</p></div><Badge>{action.status}</Badge></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aucune action liée.</p>}
          </Panel>
        </div>
        <Panel className="p-6"><h2 className="mb-5 font-semibold">Actions administratives</h2><RecommendationControls id={id} status={recommendation.status} /></Panel>
      </div>
    </>
  );
}
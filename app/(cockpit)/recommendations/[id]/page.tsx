import { ProjectContext } from "@/components/work/project-context";
import { actionStatusLabel, actionTypeLabel, recommendationStatusLabel, severityLabel } from "@/lib/presentation/labels";
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
import type { Json } from "@/lib/supabase/database.types";

export async function generateMetadata({ params }: PageProps<"/recommendations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const recommendation = await getRecommendationById(id);
  return { title: recommendation?.title ?? "Recommandation" };
}

const record = (value: Json | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function SeoRecommendationEvidence({ payload }: { payload: Json }) {
  const data = record(payload);
  if (!["page_drop", "emerging_query", "low_ctr"].includes(String(data.kind)) || typeof data.key !== "string") return null;
  const metrics = record(data.metrics as Json);
  const suggestion = typeof data.suggested_action === "string" ? data.suggested_action : null;
  const kind = data.kind === "page_drop" ? "Page en baisse" : data.kind === "emerging_query" ? "Requête à potentiel" : "CTR à améliorer";
  return (
    <div className="mt-5 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Lecture SEO</h2>
      <p className="mt-2 text-sm"><span className="text-muted">Type :</span> {kind}</p>
      <p className="mt-1 break-words text-sm"><span className="text-muted">Cible :</span> {data.key}</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {typeof metrics.clicks === "number" && <span>Clics : {metrics.clicks}</span>}
        {typeof metrics.priorClicks === "number" && <span>Avant : {metrics.priorClicks}</span>}
        {typeof metrics.impressions === "number" && <span>Impressions : {metrics.impressions}</span>}
        {typeof metrics.position === "number" && <span>Position : {metrics.position.toFixed(1)}</span>}
        {typeof metrics.ctr === "number" && <span>CTR : {(metrics.ctr * 100).toFixed(1)} %</span>}
      </div>
      {suggestion && <p className="mt-3 text-sm leading-6"><span className="font-medium">Piste proposée :</span> <span className="text-muted">{suggestion}</span></p>}
      <p className="mt-2 text-xs text-muted">Cette piste n’est pas une modification automatique : elle doit être examinée avant création d’une action.</p>
    </div>
  );
}

export default async function RecommendationDetailPage({ params }: PageProps<"/recommendations/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const recommendation = await getRecommendationById(id);
  if (!recommendation) notFound();
  const [messages, actions] = await Promise.all([listMessagesByRecommendation(id), listActionsByRecommendation(id)]);
  const recommendationPayload = record(recommendation.payload);
  const seoActionAvailable = ["page_drop", "emerging_query", "low_ctr"].includes(String(recommendationPayload.kind));
  return (
    <>
      <Link href="/recommendations" className="mb-6 inline-block text-xs text-accent hover:underline">← Toutes les recommandations</Link>
      <PageHeading eyebrow="Recommandation" title={recommendation.title} description="Recommandation enregistrée. Aucune API externe ni exécution automatique n’est connectée." action={<Badge tone={recommendationStatusLabel(recommendation.status).tone}>{recommendationStatusLabel(recommendation.status).label}</Badge>} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <div className="space-y-6">
          <Panel className="p-6">
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm"><span>Client : <Link href={`/clients/${recommendation.client_id}`} className="text-accent hover:underline">{recommendation.client?.name ?? "Client indisponible"}</Link></span><span>Agent : <Link href={`/agents/${recommendation.agent_id}`} className="text-accent hover:underline">{recommendation.agent?.name ?? "Agent indisponible"}</Link></span></div>
            <ProjectContext projectId={recommendation.project_id} project={recommendation.project}/><dl className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
              <div><dt className="text-xs text-muted">Statut</dt><dd className="mt-1 text-sm">{recommendationStatusLabel(recommendation.status).label}</dd></div>
              <div><dt className="text-xs text-muted">Importance</dt><dd className="mt-1 text-sm">{severityLabel(recommendation.severity).label}</dd></div>
              <div><dt className="text-xs text-muted">Créée</dt><dd className="mt-1 text-sm"><time dateTime={recommendation.created_at}>{formatDate(recommendation.created_at)}</time></dd></div>
            </dl>
            <div className="mt-5 border-t border-border pt-5"><h2 className="text-sm font-semibold">Raison</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{recommendation.reason || "Aucune raison fournie."}</p></div><SeoRecommendationEvidence payload={recommendation.payload} />
            <details className="mt-5 border-t border-border pt-5"><summary className="min-h-10 cursor-pointer text-sm font-medium">Données techniques (vue avancée)</summary><pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-background p-4 text-xs leading-5 text-muted">{JSON.stringify(recommendation.payload, null, 2)}</pre></details>
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
            {actions.length ? <ul className="mt-4 divide-y divide-border">{actions.map((action) => <li key={action.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{actionTypeLabel(action.action_type)}</p><p className="mt-1 text-xs text-muted">{action.requires_approval ? "Approbation requise" : "Approbation non requise"}</p></div><Badge tone={actionStatusLabel(action.status).tone}>{actionStatusLabel(action.status).label}</Badge></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aucune action liée.</p>}
          </Panel>
        </div>
        <Panel className="p-6"><h2 className="mb-5 font-semibold">Actions administratives</h2><RecommendationControls id={id} status={recommendation.status} seoActionAvailable={seoActionAvailable} /></Panel>
      </div>
    </>
  );
}
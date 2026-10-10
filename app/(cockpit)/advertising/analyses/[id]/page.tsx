import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getAgentRun } from "@/lib/agent-runs/data";
import { isStoredScope } from "@/lib/integrations/google-ads/scope";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { businessLabels, validInstructionSnapshot } from "@/lib/integrations/google-ads/business-context";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const run = await getAgentRun((await params).id);
  const meta = run?.metadata as Record<string, unknown> | null;
  if (!run || !meta || meta.run_type !== "google_ads_read_only" || !isStoredScope(meta.scope)) notFound();
  const scope = meta.scope;
  return <>
    <PageHeading eyebrow="Analyse Google Ads" title={run.client?.name ?? "Client"} description={`${scope.start} → ${scope.end} · ${scope.campaignIds.length} campagnes · compte ${scope.accountId}`} />
    <p className="mb-4 text-sm"><Link href={`/advertising?client=${run.client_id}`} className="text-accent">← Campagnes publicitaires</Link></p>
    <Panel className="space-y-4 p-5">
      <p className="font-medium">{meta.engine === "ai" ? "Analyse IA personnalisée" : meta.engine === "deterministic_fallback" ? "IA indisponible — repli déterministe explicite" : "Règles déterministes, sans IA"} · {run.status}</p>
      {typeof meta.provider === "string" && <p className="text-sm text-muted">Fournisseur / modèle : {meta.provider} / {String(meta.model)}</p>}
      <p>{run.summary}</p>
      <p className="whitespace-pre-wrap text-sm leading-7">{typeof meta.analysis_text === "string" ? meta.analysis_text : "Aucun résultat enregistré pour ce run."}</p>
    </Panel>
    {validInstructionSnapshot(meta.instruction_snapshot) && <details className="mt-5 rounded-xl border border-border p-4"><summary className="min-h-10 cursor-pointer">Instructions figées au moment de l’analyse</summary><p className="mt-3 whitespace-pre-wrap text-sm">Globales : {meta.instruction_snapshot.global || "non renseignées"}</p><p className="mt-3 whitespace-pre-wrap text-sm">Client : {meta.instruction_snapshot.client || "non renseignées"}</p>
      {meta.instruction_snapshot.business && <dl className="mt-4 space-y-3 text-sm">{(Object.entries(businessLabels) as [keyof typeof businessLabels, string][]).map(([key, label]) => <div key={key}><dt className="text-muted">{label}</dt><dd>{(meta.instruction_snapshot as import("@/lib/integrations/google-ads/business-context").AdsInstructionSnapshot).business?.[key] || "Non renseigné"}</dd></div>)}<div><dt className="text-muted">Budget publicitaire mensuel</dt><dd>{meta.instruction_snapshot.business.advertisingMonthlyBudget ?? "Non renseigné"} {meta.instruction_snapshot.business.currency}</dd></div><div><dt className="text-muted">Coût par prospect cible</dt><dd>{meta.instruction_snapshot.business.targetCostPerLead ?? "Non renseigné"} {meta.instruction_snapshot.business.currency}</dd></div></dl>}
    </details>}
  </>;
}

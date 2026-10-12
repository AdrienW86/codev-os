import "server-only";
// Persistance des opportunités : déduplication par empreinte, cycle de vie, lien avec la recommandation existante.
// Dépendances injectées (base, création de recommandation, journal) : testable sans Supabase.
//  - une opportunité déjà traitée ou écartée n'est jamais relancée : seul un changement significatif est signalé ;
//  - une recommandation (table existante) est créée pour les opportunités prioritaires, ou à la demande ;
//  - aucune action externe n'est préparée ici.
import type { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { OpportunityStatus, SeoOpportunityRow } from "@/lib/supabase/seo-opportunities.types";
import { categoryLabels, isSignificantChange, pathOf, type DetectedOpportunity, type Metrics, type Period } from "@/lib/seo/opportunities";
import { canTransitionOpportunity, closedStatuses, recommendationStatusFor } from "@/lib/seo/opportunity-status";

type Db = ReturnType<typeof getSupabaseServerClient>;
export type RecommendFn = (input: { agentId: string; clientId: string; title: string; reason: string; severity: "low" | "medium" | "high"; payload: Record<string, unknown> }) => Promise<{ id: string; created: boolean }>;
export type AuditFn = (entry: { action: string; resource_type: string; resource_id: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
export type StoreDeps = { db: Db; recommend: RecommendFn; audit: AuditFn; now?: () => Date };

const OPEN: readonly OpportunityStatus[] = ["detected", "to_review", "approved", "in_progress"];

export function asMetrics(value: Json | null | undefined): Metrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.clicks !== "number" || typeof item.impressions !== "number") return null;
  return { clicks: item.clicks, impressions: item.impressions, ctr: typeof item.ctr === "number" ? item.ctr : null, position: typeof item.position === "number" ? item.position : null };
}

export function recommendationTitle(row: Pick<SeoOpportunityRow, "category" | "keyword">) {
  return `${categoryLabels[row.category]} : « ${row.keyword} »`.slice(0, 200);
}

/** Charge utile de la recommandation : renvoie vers l'opportunité, qui reste la source de vérité. */
export function recommendationPayload(row: SeoOpportunityRow): Record<string, unknown> {
  return {
    kind: "keyword_opportunity", opportunity_id: row.id, category: row.category, key: row.keyword, keywords: row.keywords,
    target_page: row.target_url, intent: row.intent, priority: row.priority, confidence: row.confidence, verified: row.verified,
    metrics: row.metrics, previous_metrics: row.previous_metrics, period: { start: row.period_start, end: row.period_end },
    suggested_action: row.recommended_action, action_kind: row.action_kind,
  };
}

const severityOf = (priority: SeoOpportunityRow["priority"]) => priority;

/** Recommandation liée (existante ou créée) ; l'identifiant est enregistré sur l'opportunité. */
export async function ensureRecommendation(deps: StoreDeps, row: SeoOpportunityRow, agentId: string): Promise<string> {
  if (row.recommendation_id) return row.recommendation_id;
  const reason = `${row.rationale}\n\nAction recommandée : ${row.recommended_action}${row.verified ? "" : "\n\nHypothèse fondée sur le contexte client : aucune donnée de volume Google."}`;
  const created = await deps.recommend({ agentId, clientId: row.client_id, title: recommendationTitle(row), reason, severity: severityOf(row.priority), payload: recommendationPayload(row) });
  const { error } = await deps.db.from("seo_keyword_opportunities").update({ recommendation_id: created.id }).eq("id", row.id).is("recommendation_id", null);
  if (error) throw new Error("opportunity link");
  return created.id;
}

/** Une opportunité nouvelle de priorité haute et de confiance suffisante passe directement « à examiner ». */
export const needsReview = (item: Pick<DetectedOpportunity, "priority" | "confidence">) => item.priority === "high" && item.confidence !== "low";

export type PersistSummary = { created: number; updated: number; toReview: number; recommendations: number; resurfaced: number };

export async function persistOpportunities(deps: StoreDeps, input: { clientId: string; agentId: string; analysisId: string | null; period: Period; previousPeriod: Period; opportunities: DetectedOpportunity[] }): Promise<PersistSummary> {
  const summary: PersistSummary = { created: 0, updated: 0, toReview: 0, recommendations: 0, resurfaced: 0 };
  if (!input.opportunities.length) return summary;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const fingerprints = input.opportunities.map((item) => item.fingerprint);
  const { data: existingRows, error } = await deps.db.from("seo_keyword_opportunities").select("*").eq("client_id", input.clientId).in("fingerprint", fingerprints);
  if (error) throw new Error("opportunities read");
  const existing = new Map(((existingRows ?? []) as SeoOpportunityRow[]).map((row) => [row.fingerprint, row]));

  for (const item of input.opportunities) {
    const fields = {
      category: item.category, keyword: item.keyword.slice(0, 300), keywords: item.keywords.slice(0, 20).map((value) => value.slice(0, 300)),
      target_url: item.targetUrl, target_status: item.targetStatus, intent: item.intent, intent_basis: item.intentBasis.slice(0, 300),
      priority: item.priority, confidence: item.confidence, data_source: item.source, verified: item.verified,
      period_start: input.period.start, period_end: input.period.end, previous_start: input.previousPeriod.start, previous_end: input.previousPeriod.end,
      metrics: item.metrics as unknown as Json, previous_metrics: item.previous as unknown as Json, potential_clicks: item.potentialClicks,
      factors: item.factors.slice(0, 12), rationale: item.rationale.slice(0, 4000), recommended_action: item.recommendedAction.slice(0, 4000), action_kind: item.actionKind,
      evidence: item.evidence as Json, last_analysis_id: input.analysisId,
    };
    const current = existing.get(item.fingerprint);
    if (!current) {
      const status: OpportunityStatus = needsReview(item) ? "to_review" : "detected";
      const { data, error: insertError } = await deps.db.from("seo_keyword_opportunities").insert({ client_id: input.clientId, fingerprint: item.fingerprint, ...fields, status, last_detected_at: now }).select("*").single();
      if (insertError?.code === "23505") continue; // Course entre deux analyses : l'autre a déjà créé la ligne.
      if (insertError || !data) throw new Error("opportunity insert");
      summary.created++;
      if (status === "to_review") {
        summary.toReview++;
        await ensureRecommendation(deps, data as SeoOpportunityRow, input.agentId);
        summary.recommendations++;
      }
      continue;
    }
    if (closedStatuses.includes(current.status)) {
      // Déjà traitée ou écartée : on garde la situation de référence (métriques au moment de la décision).
      const significant = item.verified && isSignificantChange(asMetrics(current.metrics), item.metrics);
      const evidence = { ...(current.evidence && typeof current.evidence === "object" && !Array.isArray(current.evidence) ? current.evidence : {}), latest: { metrics: item.metrics, period: input.period, at: now } };
      const { error: updateError } = await deps.db.from("seo_keyword_opportunities").update({
        last_detected_at: now, detection_count: (current.detection_count ?? 1) + 1, last_analysis_id: input.analysisId, evidence: evidence as Json,
        significant_change: current.significant_change || significant,
      }).eq("id", current.id).eq("status", current.status);
      if (updateError) throw new Error("opportunity update");
      if (significant && !current.significant_change) {
        summary.resurfaced++;
        await deps.audit({ action: "seo_opportunity.significant_change", resource_type: "seo_opportunity", resource_id: current.id, metadata: { client_id: input.clientId, status: current.status } });
      }
      summary.updated++;
      continue;
    }
    // Ouverte : relevé actualisé ; jamais de retour en arrière du statut.
    const promote = current.status === "detected" && needsReview(item);
    const { error: updateError } = await deps.db.from("seo_keyword_opportunities").update({
      ...fields, last_detected_at: now, detection_count: (current.detection_count ?? 1) + 1, ...(promote ? { status: "to_review" as const } : {}),
    }).eq("id", current.id).eq("status", current.status);
    if (updateError) throw new Error("opportunity update");
    summary.updated++;
    if (promote) {
      summary.toReview++;
      if (!current.recommendation_id) { await ensureRecommendation(deps, { ...current, ...fields, status: "to_review" } as SeoOpportunityRow, input.agentId); summary.recommendations++; }
    }
  }
  return summary;
}

export type TransitionResult = { ok: true; row: SeoOpportunityRow } | { ok: false; message: string };

/**
 * Changement de statut décidé par l'administrateur ; la recommandation liée suit (acceptée, refusée, archivée).
 * Écarter exige une justification. Rouvrir une opportunité close détache l'ancienne recommandation (historique conservé).
 */
export async function transitionOpportunity(deps: StoreDeps & { agentId: string | null }, input: { id: string; to: OpportunityStatus; reason?: string | null }): Promise<TransitionResult> {
  const { data, error } = await deps.db.from("seo_keyword_opportunities").select("*").eq("id", input.id).maybeSingle();
  if (error) throw new Error("opportunity read");
  const row = data as SeoOpportunityRow | null;
  if (!row) return { ok: false, message: "Opportunité introuvable." };
  if (!canTransitionOpportunity(row.status, input.to)) return { ok: false, message: "Ce changement de statut n’est pas possible depuis l’état actuel. Rechargez la page." };
  const reason = input.reason?.trim().slice(0, 2000) || null;
  if (input.to === "dismissed" && !reason) return { ok: false, message: "Indiquez pourquoi cette opportunité est écartée." };
  const reopen = input.to === "to_review";
  const patch: Partial<Pick<SeoOpportunityRow, "status" | "status_reason" | "significant_change" | "recommendation_id" | "metrics">> = { status: input.to, status_reason: input.to === "dismissed" || reopen ? reason : row.status_reason, ...(reopen ? { significant_change: false, recommendation_id: null } : {}) };
  // Réouverture : la situation de référence devient le dernier relevé connu.
  if (reopen) {
    const latest = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence) ? (row.evidence as Record<string, unknown>).latest as Record<string, unknown> | undefined : undefined;
    if (latest?.metrics && row.verified) patch.metrics = latest.metrics as Json;
  }
  const { data: updated, error: updateError } = await deps.db.from("seo_keyword_opportunities").update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
  if (updateError) throw new Error("opportunity update");
  if (!updated) return { ok: false, message: "L’opportunité a changé entre-temps. Rechargez la page." };
  let next = updated as SeoOpportunityRow;
  await syncRecommendation(deps, row, next);
  if (!next.recommendation_id && deps.agentId && (input.to === "approved" || input.to === "to_review")) {
    const recommendationId = await ensureRecommendation(deps, next, deps.agentId);
    next = { ...next, recommendation_id: recommendationId };
    if (input.to === "approved") await setRecommendationStatus(deps.db, recommendationId, "accepted");
  }
  await deps.audit({ action: "seo_opportunity.status_changed", resource_type: "seo_opportunity", resource_id: row.id, metadata: { client_id: row.client_id, from: row.status, to: input.to, reason: reason ? reason.slice(0, 300) : null } });
  return { ok: true, row: next };
}

async function setRecommendationStatus(db: Db, id: string, status: "accepted" | "rejected" | "archived") {
  const { data } = await db.from("recommendations").select("status").eq("id", id).maybeSingle();
  if (!data || data.status === status) return;
  const allowed = data.status === "pending" || (status === "archived" && (data.status === "accepted" || data.status === "rejected"));
  if (!allowed) return;
  const { error } = await db.from("recommendations").update({ status }).eq("id", id).eq("status", data.status);
  if (error) throw new Error("recommendation update");
}

async function syncRecommendation(deps: StoreDeps, before: SeoOpportunityRow, after: SeoOpportunityRow) {
  const id = before.recommendation_id;
  if (!id) return;
  if (after.status === "to_review") { await setRecommendationStatus(deps.db, id, "archived"); return; }
  const wanted = recommendationStatusFor(after.status);
  if (wanted === "pending") return;
  const { data } = await deps.db.from("recommendations").select("status").eq("id", id).maybeSingle();
  // Acceptée puis écartée : la recommandation ne peut plus être refusée, elle est archivée.
  if (data?.status === "accepted" && wanted === "rejected") await setRecommendationStatus(deps.db, id, "archived");
  else await setRecommendationStatus(deps.db, id, wanted);
}

/** Décision prise depuis la page Recommandations : l'opportunité liée suit (approuvée ou écartée). */
export async function syncOpportunityFromRecommendation(deps: StoreDeps, recommendationId: string, recommendationStatus: string) {
  const { data, error } = await deps.db.from("seo_keyword_opportunities").select("*").eq("recommendation_id", recommendationId).maybeSingle();
  if (error || !data) return;
  const row = data as SeoOpportunityRow;
  const to = recommendationStatus === "accepted" && (row.status === "detected" || row.status === "to_review") ? "approved"
    : recommendationStatus === "rejected" && OPEN.includes(row.status) ? "dismissed" : null;
  if (!to) return;
  const { error: updateError } = await deps.db.from("seo_keyword_opportunities").update({ status: to, ...(to === "dismissed" ? { status_reason: row.status_reason ?? "Recommandation refusée depuis la page Recommandations." } : {}) }).eq("id", row.id).eq("status", row.status);
  if (updateError) throw new Error("opportunity update");
  await deps.audit({ action: "seo_opportunity.status_changed", resource_type: "seo_opportunity", resource_id: row.id, metadata: { client_id: row.client_id, from: row.status, to, via: "recommendation" } });
}

/** Libellé court de la cible pour l'affichage. */
export const targetLabel = (row: Pick<SeoOpportunityRow, "target_url" | "target_status">) =>
  row.target_url ? pathOf(row.target_url) : row.target_status === "missing" ? "Aucune page adaptée" : "—";

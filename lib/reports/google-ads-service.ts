import "server-only";
// Rapports Google Ads : préparés depuis l'onglet Campagnes pour un périmètre EXPLICITE (dates + campagnes),
// enregistré avec le rapport et chacune de ses versions. Les filtres du tableau de bord ne modifient jamais
// un rapport existant ; une actualisation crée une nouvelle version avec le MÊME périmètre (approbation invalidée).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import type { Json } from "@/lib/supabase/database.types";
import { loadCampaignDashboard, loadCampaignDashboardForSystem } from "@/lib/integrations/google-ads/service";
import { DEFAULT_FILTERS } from "@/lib/integrations/google-ads/dashboard";
import { isStoredScope, storeScope, type AdsScope, type StoredAdsScope } from "@/lib/integrations/google-ads/scope";
import { buildGoogleAdsReport } from "./google-ads";
import { requireReportVersionStorage } from "./version-storage";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (what: string): never => { throw new Error(`report ${what}`); };
const migrationMessage = "Les rapports Google Ads nécessitent la migration 20261016000000_google_ads_reports (non appliquée sur cette base).";
/** Colonne scope absente (42703 / PGRST204) ou type google_ads refusé par l'ancienne contrainte (23514). */
const missingMigration = (error: { code?: string } | null) => ["42703", "PGRST204", "23514"].includes(error?.code ?? "");

export type GoogleAdsReportOutcome = { ok: true; id: string; version: number } | { ok: false; message: string };

/** Instantané des campagnes du périmètre, lu en direct (lecture seule) sur le compte associé au client. */
export async function googleAdsReportSnapshot(clientId: string, scope: AdsScope, expectedAccountId?: string, options?: { system: boolean; mode: "ai" | "deterministic" }) {
  const loaded = await (options?.system ? loadCampaignDashboardForSystem : loadCampaignDashboard)(clientId, { ...DEFAULT_FILTERS, period: { preset: "custom", start: scope.start, end: scope.end }, status: "all", includeUntracked: true });
  if (!loaded.ok) return { ok: false as const, message: loaded.message };
  const { data } = loaded;
  if (expectedAccountId && data.account.id !== expectedAccountId) return { ok: false as const, message: "Le compte Google Ads associé à ce client a changé : ce rapport ne peut pas être actualisé." };
  const stored = storeScope(scope, data.campaigns, { days: data.period.days, timezone: data.account.timezone, currency: data.account.currency, accountId: data.account.id });
  if (!stored) return { ok: false as const, message: "Une campagne du périmètre est introuvable dans le compte Google Ads de ce client." };
  const { data: client, error } = await db().from("clients").select("name").eq("id", clientId).maybeSingle();
  if (error) fail("read");
  if (!client) return { ok: false as const, message: "Client introuvable." };
  const built = buildGoogleAdsReport({
    clientName: client.name, accountName: data.account.name ?? "Compte sans nom", scope: stored,
    rows: data.campaigns.filter((row) => stored.campaignIds.includes(row.id)), leads: data.leads, includesToday: data.period.includesToday,
  });
  if (options) {
    const { analyzeClientReport } = await import("./recurring/analysis");
    const analyzed = await analyzeClientReport(clientId, data.campaigns.filter(row => stored.campaignIds.includes(row.id)), stored, options.mode);
    if (!analyzed.ok) return analyzed;
    for (const section of built.internal.sections) section.lines = section.lines.map(line => line === "Rapport déterministe (sans IA), lu en lecture seule : aucune modification Google Ads." ? "Tableaux calculés depuis Google Ads ; moteur des recommandations identifié séparément. Aucune modification Google Ads." : line);
    const section = { title: analyzed.engine === "ai" ? "Recommandations personnalisées (IA)" : "Constats déterministes (sans IA)", lines: analyzed.text.split("\n").filter(Boolean) };
    built.internal.sections.push(section); built.client.sections.push(section);
    built.internal.sections.push({ title: "Fraîcheur", lines: [`Données récupérées le ${data.fetchedAt}.`, `Moteur : ${analyzed.engine}.`] });
    built.client.sections.push({ title: "Fraîcheur", lines: [`Données récupérées le ${data.fetchedAt}.`] });
  }
  return { ok: true as const, stored, built };
}

const contentOf = (built: ReturnType<typeof buildGoogleAdsReport>) => ({
  internal_content: built.internal as unknown as Json, client_content: built.client as unknown as Json,
  summary: built.client.summary.slice(0, 4000), title: built.title.slice(0, 200),
});

export async function prepareGoogleAdsReport(actor: Actor, clientId: string, scope: AdsScope): Promise<GoogleAdsReportOutcome> {
  if (!uuid.test(clientId)) return { ok: false, message: "Client invalide." };
  try { await requireReportVersionStorage(); } catch { return { ok: false, message: "La migration 20261019000000 des versions transactionnelles est requise pour préparer un rapport." }; }
  const result = await googleAdsReportSnapshot(clientId, scope);
  if (!result.ok) return result;
  const content = contentOf(result.built);
  const stored = result.stored as unknown as Json;
  const { data: created, error } = await db().from("reports").insert({
    client_id: clientId, kind: "google_ads", period_start: result.stored.start, period_end: result.stored.end,
    status: "ready_for_review", version: 1, generated_at: new Date().toISOString(), scope: stored, ...content,
  }).select("id").single();
  if (missingMigration(error)) return { ok: false, message: migrationMessage };
  if (error || !created) fail("insert");
  await writeAudit(actor, { action: "report.generated", resource_type: "report", resource_id: created!.id, metadata: { client_id: clientId, kind: "google_ads", period_start: result.stored.start, period_end: result.stored.end, campaigns: result.stored.campaignIds.length } });
  return { ok: true, id: created!.id, version: 1 };
}

/** Nouvelle version avec le périmètre ENREGISTRÉ (jamais celui des filtres affichés). Refusé si envoyé ou archivé. */
export async function regenerateGoogleAdsReport(actor: Actor, reportId: string): Promise<GoogleAdsReportOutcome> {
  if (!uuid.test(reportId)) return { ok: false, message: "Rapport introuvable." };
  try { await requireReportVersionStorage(); } catch { return { ok: false, message: "La migration 20261019000000 des versions transactionnelles est requise pour actualiser un rapport." }; }
  const { data: report, error } = await db().from("reports").select("id,client_id,kind,status,version,scope").eq("id", reportId).maybeSingle();
  if (missingMigration(error)) return { ok: false, message: migrationMessage };
  if (error) fail("read");
  if (!report || report.kind !== "google_ads" || !report.client_id) return { ok: false, message: "Rapport Google Ads introuvable." };
  if (["sent", "archived"].includes(report.status)) return { ok: false, message: "Ce rapport a été envoyé ou archivé : son contenu est figé." };
  if (!isStoredScope(report.scope)) return { ok: false, message: "Périmètre enregistré illisible : préparez un nouveau rapport depuis l’onglet Campagnes." };
  const saved: StoredAdsScope = report.scope;
  const occurrence = await db().from("ads_report_occurrences").select("config").eq("report_id", reportId).maybeSingle();
  const recurring = occurrence.error ? null : occurrence.data?.config as Record<string, unknown> | undefined;
  const result = await googleAdsReportSnapshot(report.client_id, { start: saved.start, end: saved.end, status: saved.status, types: saved.types, campaignIds: saved.campaignIds }, saved.accountId, recurring ? { system: false, mode: recurring.mode === "ai" ? "ai" : "deterministic" } : undefined);
  if (!result.ok) return result;
  const content = contentOf(result.built);
  const version = report.version + 1;
  // Le périmètre de la ligne n'est pas modifié (et ne peut pas l'être : trigger reports_scope_guard).
  const { data: updated, error: updateError } = await db().from("reports").update({ ...content, version, status: "ready_for_review", generated_at: new Date().toISOString(), approved_at: null, approved_by: null, approved_version: null })
    .eq("id", reportId).eq("version", report.version).select("id");
  if (updateError) fail("update");
  if (!updated?.length) return { ok: false, message: "Le rapport a changé entre-temps : rechargez-le." };
  await writeAudit(actor, { action: "report.regenerated", resource_type: "report", resource_id: reportId, metadata: { version, kind: "google_ads" } });
  return { ok: true, id: reportId, version };
}

/** Lecture tolérante du périmètre (null si absent ou si la migration n'est pas appliquée). */
export async function getReportScope(reportId: string): Promise<StoredAdsScope | null> {
  if (!uuid.test(reportId)) return null;
  const { data, error } = await db().from("reports").select("scope").eq("id", reportId).maybeSingle();
  if (error || !data) return null;
  return isStoredScope(data.scope) ? data.scope : null;
}

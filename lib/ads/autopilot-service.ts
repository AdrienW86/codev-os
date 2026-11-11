import "server-only";
// Pilote automatique Google Ads : réglages, journal, application et annulation.
// Triple verrou : CODEV_GOOGLE_ADS_WRITES_ENABLED=true ET CODEV_GOOGLE_ADS_AUTOPILOT=true (serveur) ET mode client
// différent de « off ». Chaque modification est écrite au journal AVANT l'appel Google Ads, auditée et annulable.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { executeApprovedAdsChange } from "@/lib/ads/write-foundation";
import { AUTOPILOT_MODES, DEFAULT_MAX_PER_CAMPAIGN_WEEK, type AutopilotCandidate, type AutopilotMode, type JournalEntry } from "@/lib/ads/autopilot";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;

export type AutopilotSettings = { available: boolean; mode: AutopilotMode; maxPerCampaignWeek: number; serverEnabled: boolean };
export type AutopilotChange = { id: string; campaign_id: string; keyword: string; match_type: string; reason: string; status: string; created_at: string; applied_at: string | null; undone_at: string | null; error_code: string | null };

export function autopilotServerEnabled(env: Record<string, string | undefined> = process.env) {
  return env.CODEV_GOOGLE_ADS_WRITES_ENABLED === "true" && env.CODEV_GOOGLE_ADS_AUTOPILOT === "true";
}

export async function readAutopilotSettings(clientId: string): Promise<AutopilotSettings> {
  const serverEnabled = autopilotServerEnabled();
  if (!uuid.test(clientId)) return { available: false, mode: "off", maxPerCampaignWeek: DEFAULT_MAX_PER_CAMPAIGN_WEEK, serverEnabled };
  const { data, error } = await db().from("ads_autopilot_settings").select("mode,max_negatives_per_campaign_week").eq("client_id", clientId).maybeSingle();
  if (error) return { available: false, mode: "off", maxPerCampaignWeek: DEFAULT_MAX_PER_CAMPAIGN_WEEK, serverEnabled };
  const mode = AUTOPILOT_MODES.includes(data?.mode) ? data!.mode as AutopilotMode : "off";
  return { available: true, mode, maxPerCampaignWeek: Number(data?.max_negatives_per_campaign_week ?? DEFAULT_MAX_PER_CAMPAIGN_WEEK), serverEnabled };
}

export async function saveAutopilotMode(clientId: string, mode: unknown): Promise<{ ok: boolean; message: string }> {
  const { userId } = await requireAdmin();
  if (!uuid.test(clientId) || typeof mode !== "string" || !AUTOPILOT_MODES.includes(mode as AutopilotMode)) return { ok: false, message: "Réglage invalide." };
  const { error } = await db().from("ads_autopilot_settings").upsert({ client_id: clientId, mode, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (error) return { ok: false, message: "Réglage non enregistré : migration 20261205000000_ads_autopilot à appliquer." };
  await writeAudit({ kind: "admin", userId }, { action: "ads.autopilot.configured", resource_type: "client", resource_id: clientId, metadata: { mode } });
  return { ok: true, message: mode === "off" ? "Pilote automatique désactivé." : "Pilote automatique activé : mots-clés négatifs appliqués à la prochaine veille hebdomadaire." };
}

export async function listAutopilotChanges(clientId: string, limit = 50): Promise<AutopilotChange[] | null> {
  if (!uuid.test(clientId)) return null;
  const { data, error } = await db().from("ads_autopilot_changes").select("id,campaign_id,keyword,match_type,reason,status,created_at,applied_at,undone_at,error_code").eq("client_id", clientId).order("created_at", { ascending: false }).limit(Math.min(limit, 200));
  return error ? null : (data ?? []) as AutopilotChange[];
}

export async function autopilotJournal(clientId: string): Promise<JournalEntry[]> {
  const { data, error } = await db().from("ads_autopilot_changes").select("campaign_id,keyword,status,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error("Journal du pilote automatique illisible.");
  return (data ?? []).map((row) => ({ campaignId: row.campaign_id, keyword: row.keyword, status: row.status, createdAt: row.created_at }));
}

/** Applique les candidats (déjà filtrés par planAutopilot) : journal d'abord, une mutation par campagne, relecture des noms de ressources. */
export async function applyAutopilot(actor: Actor, input: { clientId: string; account: string; managerId: string | null; candidates: AutopilotCandidate[]; jobId: string | null }) {
  const result = { applied: 0, uncertain: 0, skipped: 0 };
  if (!input.candidates.length) return result;
  if (!autopilotServerEnabled()) { result.skipped = input.candidates.length; return result; }
  const byCampaign = new Map<string, AutopilotCandidate[]>();
  for (const candidate of input.candidates) byCampaign.set(candidate.campaignId, [...(byCampaign.get(candidate.campaignId) ?? []), candidate]);
  for (const [campaignId, items] of byCampaign) {
    const { data: rows, error } = await db().from("ads_autopilot_changes").insert(items.map((item) => ({
      client_id: input.clientId, account_id: input.account, campaign_id: campaignId, keyword: item.keyword, match_type: item.matchType, reason: item.reason,
      evidence: { cost: item.cost, clicks: item.clicks, detail: item.detail }, job_id: input.jobId,
    }))).select("id,keyword");
    if (error || !rows?.length) { result.skipped += items.length; continue; } // doublon actif ou migration absente : rien n'est écrit chez Google
    const ids = rows.map((row) => row.id as string);
    await writeAudit(actor, { action: "ads.autopilot.requested", resource_type: "client", resource_id: input.clientId, metadata: { account: input.account, campaignId, keywords: rows.map((row) => row.keyword) } });
    try {
      const executed = await executeApprovedAdsChange({ kind: "negative_keyword_add", customerId: input.account, campaignId, keywords: rows.map((row) => ({ text: row.keyword as string, matchType: "EXACT" as const })) }, { approved: true, dryRun: false, managerId: input.managerId });
      const names = ((executed.response as { results?: { resourceName?: unknown }[] } | undefined)?.results ?? []).map((item) => typeof item.resourceName === "string" ? item.resourceName : null);
      for (const [index, id] of ids.entries()) {
        const name = names[index];
        const valid = name && new RegExp(`^customers/${input.account}/campaignCriteria/${campaignId}~\\d+$`).test(name) ? name : null;
        await db().from("ads_autopilot_changes").update({ status: valid ? "applied" : "uncertain", resource_name: valid, applied_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
        if (valid) result.applied++; else result.uncertain++;
      }
      await writeAudit(actor, { action: "ads.autopilot.applied", resource_type: "client", resource_id: input.clientId, metadata: { account: input.account, campaignId, count: ids.length } });
    } catch {
      // Effet incertain (délai, réseau) : jamais de nouvel essai automatique ; visible et vérifiable dans le journal.
      await db().from("ads_autopilot_changes").update({ status: "uncertain", error_code: "mutation_failed_or_unknown" }).in("id", ids).eq("status", "pending");
      await writeAudit(actor, { action: "ads.autopilot.failed", resource_type: "client", resource_id: input.clientId, metadata: { account: input.account, campaignId } });
      result.uncertain += ids.length;
    }
  }
  return result;
}

/** Annulation par un administrateur : retire le négatif chez Google Ads, puis marque la ligne « annulée ». */
export async function undoAutopilotChange(changeId: string): Promise<{ ok: boolean; message: string }> {
  const { userId } = await requireAdmin();
  if (!uuid.test(changeId)) return { ok: false, message: "Modification inconnue." };
  if (await getActiveScenario()) return { ok: false, message: "Simulation active : aucune modification Google Ads." };
  const { data: row, error } = await db().from("ads_autopilot_changes").select("id,client_id,account_id,campaign_id,status,resource_name,keyword").eq("id", changeId).maybeSingle();
  if (error || !row) return { ok: false, message: "Modification introuvable." };
  if (row.status !== "applied" || !row.resource_name) return { ok: false, message: "Seule une modification appliquée et vérifiée peut être annulée ici." };
  const { data: connection } = await getSupabaseServerClient().from("client_connections").select("external_account_id,status,metadata").eq("client_id", row.client_id).eq("provider", "google_ads").maybeSingle();
  const account = String(connection?.external_account_id ?? "").replace(/-/g, "");
  if (connection?.status !== "connected" || account !== row.account_id) return { ok: false, message: "Le compte Google Ads lié a changé : annulation à faire dans Google Ads." };
  const manager = (connection.metadata as { manager_customer_id?: string } | null)?.manager_customer_id?.replace(/-/g, "") ?? null;
  try {
    await executeApprovedAdsChange({ kind: "negative_keyword_remove", customerId: account, campaignId: row.campaign_id, resourceNames: [row.resource_name] }, { approved: true, dryRun: false, managerId: manager });
  } catch { return { ok: false, message: "Google Ads a refusé l’annulation (droits ou écriture désactivée)." }; }
  await db().from("ads_autopilot_changes").update({ status: "undone", undone_at: new Date().toISOString(), undone_by: userId }).eq("id", changeId).eq("status", "applied");
  await writeAudit({ kind: "admin", userId }, { action: "ads.autopilot.undone", resource_type: "client", resource_id: row.client_id, metadata: { changeId, keyword: row.keyword } });
  return { ok: true, message: `« ${row.keyword} » n’est plus exclu.` };
}

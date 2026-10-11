import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { recurringConfigSchema, nextOccurrence, occurrenceWindow, type RecurringConfig, type OccurrenceWindow, continueOccurrenceWindow } from "./domain";
import type { Json } from "@/lib/supabase/database.types";
import type { AdsReportSettingsRow } from "@/lib/supabase/ads-workspace.types";
import { loadCampaignDashboard } from "@/lib/integrations/google-ads/service";
import { DEFAULT_FILTERS } from "@/lib/integrations/google-ads/dashboard";
const db = () => getSupabaseServerClient();
const missing = "Rapports récurrents indisponibles : appliquez les migrations 16 à 20 puis 20261020000001_ads_recurring_reports.";
export async function recurringOverview(clientId: string) {
  await requireAdmin();
  const [settings, occurrences] = await Promise.all([
    db().from("client_ads_report_settings").select("*").eq("client_id", clientId).maybeSingle(),
    db().from("ads_report_occurrences").select("*").eq("client_id", clientId).order("due_at", { ascending: false }).limit(25),
  ]);
  if (settings.error || occurrences.error) return { available: false as const, message: missing };
  const ids = (occurrences.data ?? []).map(o => o.report_id);
  const reports = ids.length ? await db().from("reports").select("id,status,version,approved_version,generated_at,period_start,period_end,summary").in("id", ids) : { data: [], error: null };
  if (reports.error) throw new Error("report read");
  const parsed = recurringConfigSchema.safeParse(settings.data?.config);
  const nextWindow = settings.data && parsed.success ? await recurringWindow(clientId, parsed.data, new Date(settings.data.next_due_at)) : null;
  return { available: true as const, settings: settings.data, nextWindow, occurrences: (occurrences.data ?? []).map(o => ({ ...o, report: reports.data?.find(r => r.id === o.report_id) ?? null })) };
}
export async function saveRecurringSettings(actor: Actor, clientId: string, input: unknown, revision: number) {
  const config = recurringConfigSchema.safeParse(input);
  if (!config.success || !Number.isInteger(revision) || revision < 0) return { ok: false, message: "Configuration invalide : vérifiez le destinataire, sa confirmation et les campagnes." };
  // Revalidate campaigns on THIS connected account, and timezone before persisting.
  if (config.data.enabled) {
  const inventory = await loadCampaignDashboard(clientId, { ...DEFAULT_FILTERS, period: { preset: "last_7" }, status: "all", includeUntracked: true });
  if (!inventory.ok) return { ok: false, message: inventory.message };
  if (config.data.campaignIds.some(id => !inventory.data.campaigns.some(row => row.id === id && (!config.data.types.length || config.data.types.includes(row.type))))) return { ok: false, message: "Une campagne ne correspond pas au compte ou aux types sélectionnés." };
  config.data.accountId = inventory.data.account.id;
  config.data.dataTimezone = inventory.data.account.timezone;
  }
  const next = nextOccurrence(config.data);
  const { error } = await db().rpc("codev_save_ads_report_settings", { p_client_id: clientId, p_revision: revision, p_config: config.data as Json, p_due: next.dueAt, p_prepare: next.prepareAt });
  if (error) return { ok: false, message: error.code === "40001" ? "Configuration modifiée entre-temps : rechargez." : missing };
  await writeAudit(actor, { action: "report.recurrence_configured", resource_type: "client", resource_id: clientId, metadata: { revision: revision + 1, enabled: config.data.enabled, transport: config.data.transport } });
  return { ok: true, message: "Configuration enregistrée. Les rapports déjà préparés conservent leur destinataire et leur périmètre." };
}
async function enqueue(settings: AdsReportSettingsRow, window: OccurrenceWindow, manual = false) {
  const config = recurringConfigSchema.parse(settings.config);
  const next = nextOccurrence(config, new Date(window.dueAt));
  const result = await db().rpc("codev_enqueue_ads_report", { p_client_id: settings.client_id, p_revision: settings.revision, p_due: window.dueAt, p_window: window as unknown as Json, p_next_due: next.dueAt, p_next_prepare: next.prepareAt, p_manual: manual });
  if (result.error) throw new Error("recurring enqueue");
  return result.data;
}
/** Uses the existing jobs/worker lease engine. No second scheduler, no provider call during enqueue. */
export async function enqueueDueAdsReports(actor: Actor, now: Date) {
  const settings = await db().from("client_ads_report_settings").select("*").lte("next_prepare_at", now.toISOString()).order("next_prepare_at").limit(25);
  if (["42P01", "PGRST205"].includes(settings.error?.code ?? "")) return 0;
  if (settings.error) throw new Error("recurring read");
  let count = 0;
  for (const row of settings.data ?? []) {
    const parsed = recurringConfigSchema.safeParse(row.config);
    if (!parsed.success || !parsed.data.enabled) continue;
    const window = occurrenceWindow(parsed.data, new Date(row.next_due_at));
    if (await enqueue(row, window)) { count++; await writeAudit(actor, { action: "report.recurrence_enqueued", resource_type: "client", resource_id: row.client_id, metadata: { revision: row.revision } }); }
  }
  return count;
}
export async function prepareRecurringNow(actor: Actor, clientId: string) {
  const result = await db().from("client_ads_report_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (result.error || !result.data) return { ok: false, message: missing };
  const config: RecurringConfig = recurringConfigSchema.parse(result.data.config);
  if (!config.enabled) return { ok: false, message: "Réactivez les rapports avant de préparer une échéance." };
  // Manual provisional preparation uses the most recent CLOSED-day window and remains approval-required.
  const window = occurrenceWindow(config, new Date(result.data.next_due_at));
  if (new Date(window.prepareAt) > new Date()) return { ok: false, message: "La période n’est pas close. Consultez l’aperçu provisoire ; préparez la version finalisée à la date indiquée." };
  await enqueue(result.data, window, true);
  await writeAudit(actor, { action: "report.preparation_requested", resource_type: "client", resource_id: clientId, metadata: {} });
  return { ok: true, message: "Préparation mise en file. Elle sera traitée au prochain tick du planificateur." };
}

export async function recurringWindow(clientId: string, config: RecurringConfig, due: Date) {
  const window = occurrenceWindow(config, due);
  const previous = await db().from("ads_report_occurrences").select("period_window,config")
    .eq("client_id", clientId).eq("preparation", "ready").lt("due_at", due.toISOString()).order("due_at", { ascending: false }).limit(100);
  if (previous.error) throw new Error("recurring periods read");
  const ends = (previous.data ?? []).filter(o => {
    const c = recurringConfigSchema.safeParse(o.config);
    return c.success && c.data.accountId === config.accountId && (c.data.dataTimezone ?? c.data.timezone) === (config.dataTimezone ?? config.timezone);
  }).map(o => (o.period_window as Record<string, unknown>).end).filter((v): v is string => typeof v === "string").sort();
  return continueOccurrenceWindow(window, ends.at(-1));
}

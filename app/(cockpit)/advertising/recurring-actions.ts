"use server";
import { revalidatePath } from "next/cache";
import { adminMutation } from "@/lib/core/mutation";
import { requireAdminWriter } from "@/lib/core/guards";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { saveRecurringSettings, prepareRecurringNow, recurringWindow } from "@/lib/reports/recurring/service";
import { recurringConfigSchema, localClosedDate } from "@/lib/reports/recurring/domain";
import { googleAdsReportSnapshot } from "@/lib/reports/google-ads-service";
import type { ReportContent } from "@/lib/reports/build";
export async function saveAdsRecurringAction(clientId: string, input: unknown, revision: number) {
  return adminMutation("recurring reports", actor => saveRecurringSettings(actor, clientId, input, revision), ["/advertising", `/clients/${clientId}`]);
}
export async function pauseAdsRecurringAction(clientId: string) {
  return adminMutation("recurring reports", async actor => {
    const settings = await getSupabaseServerClient().from("client_ads_report_settings").select("*").eq("client_id", clientId).maybeSingle();
    if (settings.error || !settings.data) return { ok: false, message: "Configuration indisponible." };
    const config = recurringConfigSchema.parse(settings.data.config);
    return saveRecurringSettings(actor, clientId, { ...config, enabled: false }, settings.data.revision);
  }, ["/advertising", `/clients/${clientId}`]);
}
export async function prepareAdsRecurringAction(clientId: string): Promise<{ ok?: boolean; message?: string; preview?: ReportContent }> {
  const actor = await requireAdminWriter();
  const db = getSupabaseServerClient();
  const result = await db.from("client_ads_report_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (result.error || !result.data) return { ok: false, message: "Configuration indisponible : migrations requises." };
  const config = recurringConfigSchema.parse(result.data.config);
  if (!config.enabled) return { ok: false, message: "Rapports en pause." };
  const window = await recurringWindow(clientId, config, new Date(result.data.next_due_at));
  if (!window) return { ok: false, message: "Ces journées sont déjà couvertes. Le planificateur passera à la période suivante." };
  if (new Date(window.prepareAt) > new Date()) {
    const end = localClosedDate(new Date(), config.dataTimezone ?? config.timezone);
    if (end < window.start) return { ok: false, message: "Cette période n’a pas encore commencé." };
    const snapshot = await googleAdsReportSnapshot(clientId, { start: window.start, end, status: "all", types: config.types, campaignIds: config.campaignIds }, config.accountId);
    if (!snapshot.ok) return snapshot;
    const { getAdsRecommendation } = await import("@/lib/integrations/google-ads/recommendations-service");
    const recommendation = await getAdsRecommendation(clientId, { start: window.start, end, status: "all", types: config.types, campaignIds: config.campaignIds }, config.mode);
    snapshot.built.client.sections.push({ title: "Recommandations provisoires", lines: recommendation.ok ? recommendation.text.split("\n").filter(Boolean) : [recommendation.message] });
    return { ok: true, message: `Aperçu provisoire jusqu’au ${end}, sans approbation ni envoi possible. La version finalisée sera préparée le ${new Date(window.prepareAt).toLocaleString("fr-FR", { timeZone: config.timezone })}.`, preview: snapshot.built.client };
  }
  const response = await prepareRecurringNow(actor, clientId);
  revalidatePath("/advertising"); return response;
}

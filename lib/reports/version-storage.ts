import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
/** Avoid creating reports without their transactional version trigger on a pre-migration preview. */
export async function requireReportVersionStorage() {
  const { error } = await getSupabaseServerClient().from("report_deliveries").select("report_id").limit(1);
  if (error) throw new Error("La migration 20261019000000_report_delivery_claims est requise avant toute modification de rapport.");
}

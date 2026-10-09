import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditLogInsert } from "@/lib/supabase/database.types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function writeAuditLog(entry: AuditLogInsert) {
  await requireAdmin();
  try {
    const { error } = await getSupabaseServerClient().from("audit_logs").insert(entry);
    if (error) throw new Error();
  } catch {
    console.error("[audit] Échec de l’écriture du journal.");
    throw new Error("Journalisation indisponible.");
  }
}

export async function listAuditLogsByResource(resourceType: string, resourceId: string, limit = 20) {
  await requireAdmin();
  if (!uuid.test(resourceId)) return [];
  try {
    const { data, error } = await getSupabaseServerClient().from("audit_logs").select("id,action,actor_type,created_at").eq("resource_type", resourceType).eq("resource_id", resourceId).order("created_at", { ascending: false }).limit(Math.max(1, Math.min(50, Math.trunc(limit))));
    if (error) throw new Error();
    return data ?? [];
  } catch {
    console.error("[audit] Échec de la lecture du journal.");
    throw new Error("L’historique est indisponible.");
  }
}

import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import type { IncidentRow } from "@/lib/supabase/core.types";

export type IncidentRecord = IncidentRow & { client: { id: string; name: string } | null; project: { id: string; name: string } | null; agent: { id: string; name: string } | null };

/** Incidents ouverts + résolus des 14 derniers jours. */
export async function listIncidents(now = new Date()): Promise<IncidentRecord[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const { data, error } = await getSupabaseServerClient().from("incidents")
    .select("*,client:clients(id,name),project:projects(id,name),agent:agents(id,name)")
    .or(`status.neq.resolved,resolved_at.gte.${since}`).order("detected_at", { ascending: false }).limit(200);
  if (error) throw new Error("incidents list");
  return (data ?? []) as unknown as IncidentRecord[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prise en charge / résolution manuelle par l'administrateur (jamais de suppression). */
export async function updateIncidentStatus(actor: Actor & { kind: "admin" }, id: string, status: "investigating" | "resolved"): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!uuid.test(id)) return { ok: false, message: "Incident introuvable." };
  const from: IncidentRow["status"][] = status === "investigating" ? ["open"] : ["open", "investigating"];
  const { data, error } = await getSupabaseServerClient().from("incidents")
    .update({ status, ...(status === "resolved" ? { resolved_at: new Date().toISOString() } : {}) })
    .eq("id", id).in("status", from).select("id");
  if (error) throw new Error("incident update");
  if (!data?.length) return { ok: false, message: "L’incident a changé entre-temps : rechargez la page." };
  await writeAudit(actor, { action: `incident.${status}`, resource_type: "incident", resource_id: id, metadata: {} });
  return { ok: true };
}

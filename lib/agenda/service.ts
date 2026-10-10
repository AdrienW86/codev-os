import "server-only";
// Agenda : éléments planifiés (rendez-vous, créneaux, contrôles). Jamais supprimés : terminés ou annulés.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { validateAgendaInput } from "@/lib/agenda/occurrences";
import type { AgendaItemRow } from "@/lib/supabase/core.types";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Outcome = { ok: true; message?: string } | { ok: false; message: string };

export type AgendaRecord = AgendaItemRow & { client: { id: string; name: string } | null };

/** Éléments susceptibles d'avoir une occurrence avant `to` (les récurrents sont développés ensuite). */
export async function listAgendaItems(to: Date): Promise<AgendaRecord[]> {
  const { data, error } = await db().from("agenda_items").select("*,client:clients(id,name)").neq("status", "cancelled").lt("starts_at", to.toISOString()).order("starts_at", { ascending: false }).limit(500);
  if (error) throw new Error("agenda list");
  return (data ?? []) as unknown as AgendaRecord[];
}

export async function createAgendaItem(actor: Actor & { kind: "admin" }, input: unknown): Promise<Outcome> {
  const valid = validateAgendaInput(input);
  if (!valid.ok) return valid;
  const value = valid.value;
  if (value.clientId) {
    const { data, error } = await db().from("clients").select("id").eq("id", value.clientId).maybeSingle();
    if (error) throw new Error("client read");
    if (!data) return { ok: false, message: "Client introuvable." };
  }
  const { data, error } = await db().from("agenda_items").insert({
    kind: value.kind, title: value.title, notes: value.notes, client_id: value.clientId, project_id: null, agent_id: null, automation_id: null,
    starts_at: value.startsAt, duration_minutes: value.durationMinutes, timezone: value.timezone, recurrence: value.recurrence,
    recurrence_until: value.recurrenceUntil, priority: value.priority, created_by: actor.userId,
  }).select("id").single();
  if (error || !data) throw new Error("agenda insert");
  await writeAudit(actor, { action: "agenda.created", resource_type: "agenda_item", resource_id: data.id, metadata: { kind: value.kind, recurrence: value.recurrence } });
  return { ok: true, message: "Ajouté à l’agenda." };
}

export async function setAgendaItemStatus(actor: Actor & { kind: "admin" }, id: string, status: "done" | "cancelled"): Promise<Outcome> {
  if (!uuid.test(id)) return { ok: false, message: "Élément introuvable." };
  const { data, error } = await db().from("agenda_items").update({ status }).eq("id", id).eq("status", "planned").select("id");
  if (error) throw new Error("agenda update");
  if (!data?.length) return { ok: false, message: "Cet élément a déjà été traité." };
  await writeAudit(actor, { action: `agenda.${status}`, resource_type: "agenda_item", resource_id: id, metadata: {} });
  return { ok: true, message: status === "done" ? "Marqué comme fait." : "Annulé (conservé dans l’historique)." };
}

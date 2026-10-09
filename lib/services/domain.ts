import "server-only";
// Services souscrits ↔ agents : activation, désactivation, agents globaux.
// Aucune suppression : un service désactivé passe en « ended », ses rattachements « service »
// sont désactivés et ses automatisations mises en pause ; tout l'historique est conservé.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { agentDefinitions, agentTypesForService, globalClientAgentTypes, type AgentType } from "@/lib/agents/registry";
import { getService, matchServiceType, type ServiceId } from "@/lib/services/catalog";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ServiceOutcome =
  | { ok: true; lifecycle: "active" | "to_configure" | "ended"; agents: { type: AgentType; name: string; ready: boolean }[] }
  | { ok: false; message: string };

type AgentRef = { id: string; agent_type: string | null; enabled: boolean; status: string; name: string };

export class RegistryNotInstalled extends Error {
  constructor() { super("Registre d’agents indisponible : appliquez la migration 20261015000000_codev_os_core.sql."); }
}

async function registryAgents(types: AgentType[]): Promise<Map<AgentType, AgentRef>> {
  if (!types.length) return new Map();
  const { data, error } = await getSupabaseServerClient().from("agents").select("id,agent_type,enabled,status,name").in("agent_type", types);
  if (error) throw new RegistryNotInstalled();
  const map = new Map<AgentType, AgentRef>();
  // Plusieurs agents d'un même type : le premier activé est retenu.
  for (const agent of (data ?? []) as AgentRef[]) {
    const type = agent.agent_type as AgentType;
    const current = map.get(type);
    if (!current || (!current.enabled && agent.enabled)) map.set(type, agent);
  }
  return map;
}

const isReady = (agent: AgentRef | undefined) => Boolean(agent?.enabled && agent.status === "Actif");

type ServiceRow = { id: string; service_type: string; service_key: string | null; lifecycle: string | null };

/** Ligne de service correspondant à une clé : clé explicite, sinon libellé historique reconnu. */
function findServiceRow(rows: ServiceRow[], key: ServiceId) {
  return rows.find((row) => row.service_key === key) ?? rows.find((row) => !row.service_key && matchServiceType(row.service_type)?.id === key) ?? null;
}

async function assign(clientId: string, agent: AgentRef, source: "service" | "global", serviceKey: string | null) {
  const supabase = getSupabaseServerClient();
  const { data: existing, error } = await supabase.from("agent_client_assignments").select("agent_id,enabled,source").eq("agent_id", agent.id).eq("client_id", clientId).maybeSingle();
  if (error) throw new Error("assignment read");
  if (!existing) {
    const { error: insertError } = await supabase.from("agent_client_assignments").insert({ agent_id: agent.id, client_id: clientId, enabled: true, source, service_key: serviceKey });
    if (insertError) throw new Error("assignment insert");
    return "created" as const;
  }
  // Un rattachement manuel garde sa source ; il est seulement réactivé.
  const patch = existing.source === "manual" ? { enabled: true } : { enabled: true, source, service_key: serviceKey };
  const { error: updateError } = await supabase.from("agent_client_assignments").update(patch).eq("agent_id", agent.id).eq("client_id", clientId);
  if (updateError) throw new Error("assignment update");
  return existing.enabled ? ("unchanged" as const) : ("reenabled" as const);
}

/** Rattache les agents globaux (Agent Rapport) aux clients indiqués, ou à tous. Idempotent. */
export async function ensureGlobalAgents(actor: Actor, clientIds?: string[]) {
  const supabase = getSupabaseServerClient();
  const agents = await registryAgents(globalClientAgentTypes());
  let ids = clientIds;
  if (!ids) {
    const { data, error } = await supabase.from("clients").select("id");
    if (error) throw new Error("clients read");
    ids = (data ?? []).map((row) => row.id);
  }
  let created = 0;
  for (const agent of agents.values()) {
    const { data: existing, error } = await supabase.from("agent_client_assignments").select("client_id").eq("agent_id", agent.id);
    if (error) throw new Error("assignment read");
    const assigned = new Set((existing ?? []).map((row) => row.client_id));
    const missing = ids.filter((id) => uuid.test(id) && !assigned.has(id));
    if (missing.length) {
      const { error: insertError } = await supabase.from("agent_client_assignments").insert(missing.map((clientId) => ({ agent_id: agent.id, client_id: clientId, enabled: true, source: "global" as const, service_key: null })));
      if (insertError) throw new Error("assignment insert");
      created += missing.length;
      await writeAudit(actor, { action: "agent.global_attached", resource_type: "agent", resource_id: agent.id, metadata: { clients: missing.length } });
    }
  }
  return { created };
}

export async function activateService(actor: Actor, clientId: string, serviceKey: string): Promise<ServiceOutcome> {
  const service = getService(serviceKey);
  if (!uuid.test(clientId) || !service) return { ok: false, message: "Service ou client invalide." };
  if (service.includedByDefault) {
    await ensureGlobalAgents(actor, [clientId]);
    return { ok: true, lifecycle: "active", agents: globalClientAgentTypes().map((type) => ({ type, name: agentDefinitions[type].name, ready: true })) };
  }
  const supabase = getSupabaseServerClient();
  const { data: client, error: clientError } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (clientError) throw new Error("client read");
  if (!client) return { ok: false, message: "Client introuvable." };

  const types = agentTypesForService(service.id);
  const agents = await registryAgents(types);
  const ready = types.every((type) => isReady(agents.get(type)));
  const lifecycle = ready ? "active" : "to_configure";

  const { data: rows, error: rowsError } = await supabase.from("client_services").select("id,service_type,service_key,lifecycle").eq("client_id", clientId);
  if (rowsError) throw new RegistryNotInstalled();
  const existing = findServiceRow((rows ?? []) as ServiceRow[], service.id);
  const now = new Date().toISOString();
  const patch = { service_key: service.id, lifecycle, status: "Actif", activated_at: now, deactivated_at: null } as const;
  const { data: saved, error: saveError } = existing
    ? await supabase.from("client_services").update(patch).eq("id", existing.id).select("id").single()
    : await supabase.from("client_services").insert({ client_id: clientId, service_type: service.name, ...patch }).select("id").single();
  if (saveError || !saved) throw new Error("service save");

  for (const type of types) {
    const agent = agents.get(type);
    if (agent) await assign(clientId, agent, "service", service.id);
  }
  await ensureGlobalAgents(actor, [clientId]);
  await writeAudit(actor, { action: "service.activated", resource_type: "client", resource_id: clientId, after: { service: service.id, lifecycle }, metadata: { service_row: saved.id, agents: types } });
  return { ok: true, lifecycle, agents: types.map((type) => ({ type, name: agentDefinitions[type].name, ready: isReady(agents.get(type)) })) };
}

export async function deactivateService(actor: Actor, clientId: string, serviceKey: string): Promise<ServiceOutcome> {
  const service = getService(serviceKey);
  if (!uuid.test(clientId) || !service) return { ok: false, message: "Service ou client invalide." };
  if (service.includedByDefault) return { ok: false, message: "Ce service est inclus pour tous les clients." };
  const supabase = getSupabaseServerClient();
  const { data: rows, error: rowsError } = await supabase.from("client_services").select("id,service_type,service_key,lifecycle").eq("client_id", clientId);
  if (rowsError) throw new RegistryNotInstalled();
  const all = (rows ?? []) as ServiceRow[];
  const row = findServiceRow(all, service.id);
  if (!row || row.lifecycle === "ended") return { ok: false, message: "Ce service n’est pas actif pour ce client." };

  const { error: updateError } = await supabase.from("client_services").update({ service_key: service.id, lifecycle: "ended", status: "Terminé", deactivated_at: new Date().toISOString() }).eq("id", row.id);
  if (updateError) throw new Error("service update");

  // Agents encore nécessaires à un autre service actif du client : conservés.
  const stillNeeded = new Set(all.filter((other) => other.id !== row.id && other.lifecycle !== "ended")
    .map((other) => (other.service_key ? getService(other.service_key) : matchServiceType(other.service_type))?.id)
    .filter((id): id is ServiceId => Boolean(id)).flatMap((id) => agentTypesForService(id)));
  const types = agentTypesForService(service.id).filter((type) => !stillNeeded.has(type));
  const agents = await registryAgents(types);
  const agentIds = [...agents.values()].map((agent) => agent.id);
  if (agentIds.length) {
    const { error: assignmentError } = await supabase.from("agent_client_assignments").update({ enabled: false }).eq("client_id", clientId).eq("source", "service").in("agent_id", agentIds);
    if (assignmentError) throw new Error("assignment update");
    const { error: automationError } = await supabase.from("automations").update({ status: "paused" }).eq("client_id", clientId).eq("status", "active").in("agent_id", agentIds);
    if (automationError) throw new Error("automation update");
  }
  await writeAudit(actor, { action: "service.deactivated", resource_type: "client", resource_id: clientId, before: { service: service.id, lifecycle: row.lifecycle }, after: { lifecycle: "ended" }, metadata: { paused_agents: types } });
  return { ok: true, lifecycle: "ended", agents: types.map((type) => ({ type, name: agentDefinitions[type].name, ready: false })) };
}

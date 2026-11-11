import "server-only";
// Lecture et correction de la couverture des agents (voir coverage.ts). Autorisation faite au point d'entrée.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Actor } from "@/lib/core/actor";
import { automationPresets } from "@/lib/automations/definitions";
import { createAutomation } from "@/lib/automations/service";
import { scheduleSeoAnalyses } from "@/lib/seo/opportunity-service";
import { computeAgentCoverage, fixableGaps, type CoverageGap } from "./coverage";

const db = () => getSupabaseServerClient();

export type AgentCoverage = { gaps: CoverageGap[]; clientNames: Record<string, string> };

export async function loadAgentCoverage(): Promise<AgentCoverage> {
  const [agents, automations, assignments, clients] = await Promise.all([
    db().from("agents").select("id,name,agent_type,enabled,status"),
    db().from("automations").select("run_type,client_id,status").neq("status", "archived"),
    db().from("agent_client_assignments").select("agent_id,client_id,enabled"),
    db().from("clients").select("id,name"),
  ]);
  if (agents.error || automations.error || assignments.error || clients.error) throw new Error("coverage read");
  const gaps = computeAgentCoverage({ agents: agents.data ?? [], automations: automations.data ?? [], assignments: assignments.data ?? [] });
  return { gaps, clientNames: Object.fromEntries((clients.data ?? []).map((client) => [client.id, client.name])) };
}

/**
 * Crée uniquement les automatisations manquantes des agents actifs, à partir des modèles recommandés.
 * Ne réactive jamais un agent ni une automatisation mis en pause par l'administrateur.
 */
export async function createMissingAutomations(actor: Actor & { kind: "admin" }): Promise<{ ok: boolean; message: string }> {
  const { gaps } = await loadAgentCoverage();
  const todo = fixableGaps(gaps);
  if (!todo.length) return { ok: true, message: "Chaque agent actif a déjà ses exécutions planifiées." };
  let created = 0;
  const failures: string[] = [];
  for (const gap of todo) {
    if (gap.clientId) {
      const result = await scheduleSeoAnalyses(actor, gap.clientId);
      if (result.ok) created++; else failures.push(gap.label);
      continue;
    }
    const preset = automationPresets.find((item) => item.id === gap.presetId);
    if (!preset) { failures.push(gap.label); continue; }
    const result = await createAutomation(actor, { name: preset.name, runType: preset.runType, clientId: null, frequency: preset.frequency, schedule: preset.schedule, config: preset.config });
    if (result.ok) created++; else failures.push(gap.label);
  }
  if (failures.length) return { ok: created > 0, message: `${created} planification(s) créée(s) ; à vérifier : ${failures.join(", ")}.` };
  return { ok: true, message: `${created} planification(s) créée(s). Les agents concernés tourneront au prochain créneau.` };
}

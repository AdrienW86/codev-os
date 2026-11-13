import "server-only";
// Passerelle IA mesurée (harness) : même signature que structuredResponse, plus le plafond mensuel du client et le
// journal de chaque appel. Le périmètre (agent, client) est porté par withAiScope autour du travail de l'agent.
// Table absente (migration non appliquée) : rien n'est mesuré ni bloqué, comportement d'avant. Lecture en échec : appel refusé.
import { AsyncLocalStorage } from "node:async_hooks";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { structuredResponse as rawStructuredResponse, type StructuredOptions } from "@/lib/integrations/publications-openai";
import type { HarnessAgentId } from "@/lib/harness/charter";
import { budgetOf, estimateCallCostEur, monthStart, parseCap, type Budget, type SpendLine } from "./budget";
import type { AIProvider } from "./types";
import { claudeEnabledFor } from "./client-routing";
import { modelForAgent } from "./models";
import { createAnthropicProvider } from "./providers";

type Scope = { agent: HarnessAgentId; clientId: string };
type Usage = { input_tokens: number; output_tokens: number; estimated_cost_eur: number; model: string };
const scopes = new AsyncLocalStorage<Scope>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const db = () => getSupabaseServerClient();
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};

export function withAiScope<T>(scope: Scope, work: () => Promise<T>): Promise<T> {
  return UUID.test(scope.clientId) ? scopes.run(scope, work) : work();
}

export const AI_BUDGET_EXCEEDED = "ai_budget_exceeded";
export const isBudgetExceeded = (error: unknown) => (error as { message?: unknown } | null)?.message === AI_BUDGET_EXCEEDED;

/** Dépense IA du mois du client, toutes sources mesurées. null = suivi non installé (migration non appliquée). */
export async function clientAiBudget(clientId: string, now = new Date()): Promise<Budget | null> {
  if (!UUID.test(clientId)) throw new Error("client invalid");
  const since = monthStart(now).toISOString();
  const [metered, cap, runs, media] = await Promise.all([
    db().from("ai_usage" as never).select("agent,estimated_cost_eur").eq("client_id", clientId).gte("created_at", since).limit(5000),
    db().from("client_ai_budgets" as never).select("monthly_cap_eur").eq("client_id", clientId).maybeSingle(),
    db().from("agent_runs").select("estimated_cost_eur").eq("client_id", clientId).gte("started_at", since).limit(5000),
    db().rpc("client_media_ai_month_spend" as never, { p_client_id: clientId } as never),
  ]);
  if (metered.error && missingTable(metered.error)) return null;
  if (metered.error || cap.error) throw new Error("ai budget read");
  const lines: SpendLine[] = ((metered.data ?? []) as { agent: string; estimated_cost_eur: number | string }[]).map((row) => ({ source: "metered", agent: row.agent, eur: Number(row.estimated_cost_eur) }));
  // Publications et Photothèque gardent leur journal : additionnés quand lisibles (sinon la dépense affichée le dit).
  if (!runs.error) for (const row of (runs.data ?? []) as { estimated_cost_eur: number | string | null }[]) lines.push({ source: "publications", agent: "publications", eur: Number(row.estimated_cost_eur ?? 0) });
  if (!media.error) lines.push({ source: "media-library", agent: "media-library", eur: Number(media.data ?? 0) });
  const row = cap.data as { monthly_cap_eur: number | string } | null;
  return budgetOf(lines, row ? Number(row.monthly_cap_eur) : null);
}

async function record(scope: Scope, usage: Usage | undefined) {
  if (!usage) return;
  const { error } = await db().from("ai_usage" as never).insert({
    agent: scope.agent, client_id: scope.clientId, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    estimated_cost_eur: usage.estimated_cost_eur, model: usage.model,
  } as never);
  if (error && !missingTable(error)) console.error("[ai] Consommation IA non journalisée.");
}

/** structuredResponse mesuré : refusé avant l'appel si le plafond du client serait dépassé, journalisé après. */
export async function structuredResponse(instructions: string, input: unknown, schema: unknown, options: StructuredOptions = {}) {
  const scope = scopes.getStore();
  // L'agent du périmètre choisit le modèle (famille rédaction, vision…) quand l'appelant ne le précise pas.
  if (scope) options = { ...options, agent: options.agent ?? scope.agent, clientId: options.clientId ?? scope.clientId };
  if (scope) {
    const budget = await clientAiBudget(scope.clientId);
    if (budget && !budget.allowed) throw Object.assign(new Error(AI_BUDGET_EXCEEDED), { retryable: false });
  }
  try {
    const result = await rawStructuredResponse(instructions, input, schema, options);
    if (scope) await record(scope, result.usage as Usage);
    return result;
  } catch (error) {
    // Un appel facturé puis refusé (sortie invalide, limite) est aussi compté.
    if (scope) await record(scope, (error as { usage?: Usage } | null)?.usage);
    throw error;
  }
}

/**
 * Assistant serveur mesuré (Google Ads, SEO…) : même contrat que le fournisseur, plus le plafond du client et le
 * journal de chaque appel quand un périmètre withAiScope est actif. Hors périmètre : appel inchangé.
 */
export function meteredProvider(provider: AIProvider | null): AIProvider | null {
  if (!provider) return null;
  return {
    id: provider.id, model: provider.model,
    ping: (signal) => provider.ping(signal),
    async complete(input) {
      const scope = scopes.getStore();
      if (scope) {
        const budget = await clientAiBudget(scope.clientId);
        if (budget && !budget.allowed) throw Object.assign(new Error(AI_BUDGET_EXCEEDED), { retryable: false });
      }
      // Client activé sur Claude (fiche client → Agents) : même appel, sur le modèle Claude de la famille de l'agent.
      const used = scope ? await claudeProviderFor(scope, provider) : provider;
      const response = await used.complete(input);
      if (scope && response.usage) {
        const { inputTokens, outputTokens } = response.usage;
        await record(scope, { input_tokens: inputTokens, output_tokens: outputTokens, estimated_cost_eur: Math.min(1, estimateCallCostEur(used.model, inputTokens, outputTokens)), model: used.model.slice(0, 80) || "inconnu" });
      }
      return response;
    },
  };
}

async function claudeProviderFor(scope: Scope, provider: AIProvider): Promise<AIProvider> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key || process.env.AGENTS_AI_PROVIDER?.trim().toLowerCase() === "openai" || !(await claudeEnabledFor(scope.clientId))) return provider;
  const choice = modelForAgent(scope.agent, process.env, { claudeAllowed: true });
  if (choice.provider !== "anthropic" || (provider.id === "anthropic" && provider.model === choice.model)) return provider;
  return createAnthropicProvider(key, choice.model);
}

/** Réglage du plafond mensuel du client (fiche client → Agents). */
export async function saveClientAiCap(userId: string, clientId: string, value: unknown): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const cap = parseCap(value);
  if (cap === null) return { ok: false, message: "Plafond invalide : un montant en euros entre 0 et 200." };
  const { error } = await db().from("client_ai_budgets" as never).upsert({ client_id: clientId, monthly_cap_eur: cap, updated_by: userId, updated_at: new Date().toISOString() } as never, { onConflict: "client_id" });
  if (error) return { ok: false, message: missingTable(error) ? "Budget IA non installé : appliquez la migration 20261206000000_ai_usage_budget." : "Plafond non enregistré." };
  return { ok: true, message: `Plafond IA réglé à ${cap.toLocaleString("fr-FR")} € par mois.` };
}

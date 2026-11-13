"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { saveClientAiCap } from "@/lib/ai/metered";
import { saveClientClaude } from "@/lib/ai/client-routing";

export async function saveClientAiCapAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = String(form.get("client_id") ?? "");
  return adminMutation("ai-budget", (actor) => saveClientAiCap(actor.userId, clientId, form.get("monthly_cap_eur")), [`/clients/${clientId}`]);
}

export async function saveClientClaudeAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = String(form.get("client_id") ?? "");
  const provider = form.get("provider");
  if (provider !== "claude" && provider !== "openai") return { ok: false, message: "Choix invalide." };
  return adminMutation("ai-routing", (actor) => saveClientClaude(actor.userId, clientId, provider === "claude"), [`/clients/${clientId}`]);
}

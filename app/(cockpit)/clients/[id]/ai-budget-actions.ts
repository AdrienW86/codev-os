"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { saveClientAiCap } from "@/lib/ai/metered";

export async function saveClientAiCapAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = String(form.get("client_id") ?? "");
  return adminMutation("ai-budget", (actor) => saveClientAiCap(actor.userId, clientId, form.get("monthly_cap_eur")), [`/clients/${clientId}`]);
}

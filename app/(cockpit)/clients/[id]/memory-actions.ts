"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { addClientFact, reviewClientFact } from "@/lib/client-memory/service";

export async function addClientFactAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = String(form.get("client_id") ?? "");
  return adminMutation("client-memory", (actor) => addClientFact(actor.userId, clientId, {
    kind: form.get("kind"), statement: form.get("statement"), validUntil: form.get("valid_until"),
  }), [`/clients/${clientId}`]);
}

export async function reviewClientFactAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = String(form.get("client_id") ?? "");
  return adminMutation("client-memory", (actor) => reviewClientFact(actor.userId, clientId, String(form.get("fact_id") ?? ""), form.get("decision")), [`/clients/${clientId}`]);
}

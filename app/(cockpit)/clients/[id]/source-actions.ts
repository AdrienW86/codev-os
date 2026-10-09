"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { saveClientSource } from "@/lib/connections/service";

export async function saveClientSourceAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = formText(form, "client_id", 40);
  const provider = formText(form, "provider", 40);
  const value = formText(form, "value", 201);
  return adminMutation("connections", (actor) => saveClientSource(actor, clientId, provider, value), [`/clients/${clientId}`, "/settings"]);
}

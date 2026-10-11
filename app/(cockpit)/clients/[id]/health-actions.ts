"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { runNow } from "@/lib/automations/service";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientId(form: FormData) {
  const value = formText(form, "client_id", 40);
  return uuid.test(value) ? value : "";
}

export async function runClientSeoNowAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = clientId(form);
  if (!id) return { ok: false, message: "Client invalide." };
  return adminMutation("client-health", (actor) => runNow(actor, { runType: "seo.analyze", clientId: id }), [
    `/clients/${id}`,
    "/work",
  ]);
}

export async function runClientMonitoringNowAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = clientId(form);
  if (!id) return { ok: false, message: "Client invalide." };
  return adminMutation("client-health", (actor) => runNow(actor, { runType: "monitoring.check_sites", clientId: id }), [
    `/clients/${id}`,
    "/work",
  ]);
}

"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { runNow } from "@/lib/automations/service";
import { requireAdmin } from "@/lib/require-admin";
import { syncVercelAnalytics } from "@/lib/vercel-analytics/sync";

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


const day = /^\d{4}-\d{2}-\d{2}$/;

export async function loadClientVercelAnalyticsRangeAction(clientIdValue: string, start: string, end: string) {
  await requireAdmin();
  if (!uuid.test(clientIdValue) || !day.test(start) || !day.test(end) || start > end) {
    return { ok: false as const, message: "Période invalide." };
  }
  const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1 || days > 366) return { ok: false as const, message: "La période doit contenir entre 1 et 366 jours." };
  const result = await syncVercelAnalytics(clientIdValue, { start, end });
  if (!result.ok) return { ok: false as const, message: result.reason === "not_configured" ? "Vercel n’est pas configuré pour ce client." : "Les données Vercel sont temporairement indisponibles." };
  return { ok: true as const, data: result.data };
}

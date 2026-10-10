"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { todayInParis } from "@/lib/dashboard/home";
import { approveReport, archiveReport, editReportSummary, generateReport, sendReport } from "@/lib/reports/service";
import { isRecurringReportKind } from "@/lib/reports/labels";
import { regenerateGoogleAdsReport } from "@/lib/reports/google-ads-service";

const paths = (id?: string) => ["/reports", ...(id ? [`/reports/${id}`] : []), "/dashboard"];

export async function generateReportAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = formText(form, "client_id", 40);
  const kind = formText(form, "kind", 10);
  if (!clientId || !isRecurringReportKind(kind)) return { ok: false, message: "Choisissez un client et un type de rapport." };
  return adminMutation("reports", async (actor) => {
    const result = await generateReport(actor, { clientId, kind, today: todayInParis() });
    if (result.status === "frozen") return { ok: false, message: "Ce rapport a déjà été envoyé ou archivé : il n’est plus régénéré." };
    return { ok: true, message: result.status === "created" ? "Rapport généré : il est prêt à relire." : `Nouvelle version (v${result.version}) générée ; l’approbation précédente est invalidée.` };
  }, paths());
}

export async function approveReportAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("reports", async (actor) => {
    const result = await approveReport(actor, id);
    return result.ok ? { ok: true, message: "Rapport approuvé. Il peut maintenant être envoyé." } : result;
  }, paths(id));
}

export async function editReportSummaryAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  const summary = formText(form, "summary", 4001);
  return adminMutation("reports", async (actor) => {
    const result = await editReportSummary(actor, id, summary);
    return result.ok ? { ok: true, message: "Synthèse enregistrée (nouvelle version). Relisez puis approuvez à nouveau." } : result;
  }, paths(id));
}

export async function archiveReportAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("reports", async (actor) => {
    const result = await archiveReport(actor, id);
    return result.ok ? { ok: true, message: "Rapport archivé. Il reste consultable." } : result;
  }, paths(id));
}

export async function sendReportAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  const mode = formText(form, "mode", 10) === "email" ? "email" : "manual";
  return adminMutation("reports", async (actor) => {
    const result = await sendReport(actor, id, mode);
    return result.ok ? { ok: true, message: mode === "email" ? "Rapport envoyé par e-mail." : "Envoi manuel consigné." } : result;
  }, paths(id));
}

/** Actualise un rapport Google Ads avec son périmètre ENREGISTRÉ : nouvelle version, approbation invalidée. */
export async function regenerateGoogleAdsReportAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("reports", async (actor) => {
    const result = await regenerateGoogleAdsReport(actor, id);
    return result.ok ? { ok: true, message: `Nouvelle version (v${result.version}) générée avec le même périmètre ; relisez puis approuvez à nouveau.` } : result;
  }, paths(id));
}

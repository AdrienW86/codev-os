"use server";

import { revalidatePath } from "next/cache";
import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { generateProfessionalReport, regenerateProfessionalReport } from "@/lib/reports/professional-service";

export type ProfessionalMutationState = MutationState & { id?: string; requestId?: string };

export async function generateProfessionalReportAction(_: ProfessionalMutationState, form: FormData): Promise<ProfessionalMutationState> {
  const requestId = formText(form, "request_id", 40);
  let id: string | undefined;
  const result = await adminMutation("reports", async actor => {
    if (form.getAll("confirmed").length !== 1 || form.get("confirmed") !== "yes") return { ok: false, message: "Confirmez la préparation du document à relire." };
    const outcome = await generateProfessionalReport(actor, {
      clientId: formText(form, "client_id", 40), requestId,
      family: formText(form, "family", 20), sources: form.getAll("sources"),
      start: formText(form, "start", 11), end: formText(form, "end", 11),
    });
    if (!outcome.ok) return outcome;
    id = outcome.id;
    revalidatePath(`/reports/${outcome.id}`);
    return { ok: true, message: outcome.reused ? "Cette préparation existe déjà. Ouvrez le document pour le relire." : "Document préparé : relisez les données et les limites avant toute approbation." };
  }, ["/reports"]);
  return { ...result, id, requestId };
}

export async function regenerateProfessionalReportAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("reports", async actor => {
    const outcome = await regenerateProfessionalReport(actor, id, Number(formText(form, "version", 10)));
    return outcome.ok ? { ok: true, message: `Version ${outcome.version} préparée avec le même périmètre. L’approbation précédente est invalidée.` } : outcome;
  }, ["/reports", `/reports/${id}`]);
}

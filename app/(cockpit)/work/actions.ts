"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { updateIncidentStatus } from "@/lib/incidents/data";

async function incident(form: FormData, status: "investigating" | "resolved"): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("incidents", async (actor) => {
    const result = await updateIncidentStatus(actor, id, status);
    return result.ok ? { ok: true, message: status === "resolved" ? "Incident marqué comme résolu." : "Incident pris en charge." } : result;
  }, ["/work", "/dashboard", "/settings"]);
}

export async function investigateIncidentAction(_: MutationState, form: FormData) { return incident(form, "investigating"); }
export async function resolveIncidentAction(_: MutationState, form: FormData) { return incident(form, "resolved"); }

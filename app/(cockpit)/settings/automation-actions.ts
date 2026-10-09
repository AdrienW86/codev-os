"use server";

import { adminMutation, formText, type MutationState } from "@/lib/core/mutation";
import { automationFromForm, automationPresets } from "@/lib/automations/definitions";
import { changeAutomationStatus, createAutomation, runAutomationNow } from "@/lib/automations/service";

const paths = ["/settings", "/agenda", "/dashboard"];

export async function createAutomationAction(_: MutationState, form: FormData): Promise<MutationState> {
  const input = automationFromForm(form);
  return adminMutation("automations", (actor) => createAutomation(actor, input), paths);
}

export async function createPresetAutomationAction(_: MutationState, form: FormData): Promise<MutationState> {
  const preset = automationPresets.find((item) => item.id === formText(form, "preset", 40));
  if (!preset) return { ok: false, message: "Modèle inconnu." };
  return adminMutation("automations", (actor) => createAutomation(actor, { name: preset.name, runType: preset.runType, clientId: null, frequency: preset.frequency, schedule: preset.schedule, config: preset.config }), paths);
}

async function status(form: FormData, operation: "pause" | "resume" | "archive") {
  const id = formText(form, "id", 40);
  return adminMutation("automations", async (actor) => {
    const result = await changeAutomationStatus(actor, id, operation);
    return result.ok ? { ok: true, message: operation === "pause" ? "Automatisation en pause." : operation === "resume" ? "Automatisation réactivée." : "Automatisation archivée (historique conservé)." } : result;
  }, paths);
}

export async function pauseAutomationAction(_: MutationState, form: FormData) { return status(form, "pause"); }
export async function resumeAutomationAction(_: MutationState, form: FormData) { return status(form, "resume"); }
export async function archiveAutomationAction(_: MutationState, form: FormData) { return status(form, "archive"); }

export async function runAutomationNowAction(_: MutationState, form: FormData): Promise<MutationState> {
  const id = formText(form, "id", 40);
  return adminMutation("automations", (actor) => runAutomationNow(actor, id), [...paths, "/reports", "/work"]);
}

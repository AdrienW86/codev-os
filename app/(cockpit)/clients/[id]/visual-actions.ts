"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { generateVisual, saveVisualAgent } from "@/lib/visual-agent/service";

// Agent Visuels : réglages, aperçu (rendu seul, rien n'est déposé) et génération immédiate (dépôt dans le Drive).
export type VisualAgentState = { ok?: boolean; message?: string; preview?: string; headline?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function saveVisualAgentAction(_state: VisualAgentState, form: FormData): Promise<VisualAgentState> {
  const { userId } = await requireAdmin();
  const clientId = form.get("client_id");
  if (typeof clientId !== "string" || !UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const result = await saveVisualAgent(userId, clientId, form);
  if (result.ok) revalidatePath(`/clients/${clientId}`);
  return result;
}

export async function runVisualAction(_state: VisualAgentState, form: FormData): Promise<VisualAgentState> {
  const { userId } = await requireAdmin();
  const clientId = form.get("client_id"), mode = form.get("mode");
  if (typeof clientId !== "string" || !UUID.test(clientId) || (mode !== "preview" && mode !== "generate")) return { ok: false, message: "Demande invalide." };
  const result = await generateVisual(clientId, { trigger: "manual", actorId: userId, preview: mode === "preview" });
  if (!result.ok) return { ok: false, message: result.message };
  if (mode === "generate") revalidatePath(`/clients/${clientId}`);
  return {
    ok: true, headline: result.headline, preview: `data:image/png;base64,${Buffer.from(result.png).toString("base64")}`,
    message: mode === "preview" ? `Aperçu : « ${result.headline} » (${result.service}, mise en page « ${result.template} »). Rien n’a été déposé ; chaque aperçu tire une prestation et une mise en page au hasard.`
      : `Visuel déposé dans le Drive (« ${result.headline} ») : il rejoindra la photothèque au prochain import.`,
  };
}

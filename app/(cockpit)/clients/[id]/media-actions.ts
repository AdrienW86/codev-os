"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { publicationPlatforms } from "@/lib/publications/types";
import { MAX_PUBLICATION_MEDIA, manualStatuses } from "@/lib/whatsapp/library-model";
import { preparePublication, setLibraryStatus } from "@/lib/whatsapp/library";
import { classifyClientMedia, saveMediaProfile, syncDriveLibrary, type ClassifyResult } from "@/lib/media-intelligence/service";

export type MediaLibraryState = { message?: string; ok?: boolean; publicationId?: string };
const request = z.object({
  client_id: z.uuid(),
  asset_ids: z.array(z.uuid()).min(1).max(120),
  intent: z.union([z.literal("prepare"), z.literal("analyze"), z.enum(manualStatuses.map(status => `status:${status}`) as [string, ...string[]])]),
});
const prepare = z.object({
  project_id: z.uuid(),
  platforms: z.array(z.enum(publicationPlatforms)).min(1).max(3),
  asset_ids: z.array(z.uuid()).min(1).max(MAX_PUBLICATION_MEDIA),
  text: z.string().max(10000).transform(value => value.trim() || null),
  suggest: z.boolean(),
  allow_reuse: z.boolean(),
});

/** Une seule action pour la sélection : changement de statut ou préparation d'une publication. */
export async function mediaLibraryAction(_state: MediaLibraryState, form: FormData): Promise<MediaLibraryState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const parsed = request.safeParse({ client_id: form.get("client_id"), asset_ids: form.getAll("asset_id"), intent: form.get("intent") });
  if (!parsed.success) return { message: "Sélectionnez au moins un média." };
  const { client_id: clientId, asset_ids: assetIds, intent } = parsed.data;
  try {
    if (intent.startsWith("status:")) {
      const status = intent.slice(7) as (typeof manualStatuses)[number];
      const count = await setLibraryStatus(userId, clientId, assetIds, status);
      revalidatePath(`/clients/${clientId}`);
      return { message: count ? `${count} média(s) mis à jour.` : "Aucun média mis à jour.", ok: count > 0 };
    }
    if (intent === "analyze") {
      if (assetIds.length > 20) return { message: "20 photos au maximum par analyse." };
      const result = await classifyClientMedia(clientId, { assetIds, limit: 20 });
      revalidatePath(`/clients/${clientId}`);
      return { message: classifyMessage(result), ok: result.analyzed > 0 };
    }
    const input = prepare.safeParse({ project_id: form.get("project_id"), platforms: form.getAll("platform"), asset_ids: assetIds, text: String(form.get("text") ?? ""), suggest: form.get("suggest") === "on", allow_reuse: form.get("allow_reuse") === "on" });
    if (!input.success) return { message: `Choisissez un projet, au moins une plateforme et ${MAX_PUBLICATION_MEDIA} photos au maximum.` };
    const result = await preparePublication(userId, { clientId, projectId: input.data.project_id, platforms: input.data.platforms, assetIds: input.data.asset_ids, allowReuse: input.data.allow_reuse, text: input.data.text, suggest: input.data.suggest });
    revalidatePath(`/clients/${clientId}`);
    return { message: result.message, ok: Boolean(result.id), publicationId: result.id };
  } catch {
    return { message: "Photothèque indisponible. Vérifiez la migration de la photothèque et la configuration Drive d’import." };
  }
}

const stopped: Record<NonNullable<ClassifyResult["stopped"]>, string> = {
  no_profile: "Enregistrez d’abord le profil de la photothèque du client.",
  disabled: "Analyse automatique désactivée pour ce client.",
  no_key: "Analyse IA indisponible : la clé OpenAI n’est pas configurée.",
  budget: "Budget IA mensuel du client atteint.",
};
// Résumé lisible du classement ; aucune photo n'est supprimée ni validée par l'IA.
function classifyMessage(result: ClassifyResult) {
  const parts = [`${result.analyzed} photo(s) analysée(s)`];
  if (result.quarantined) parts.push(`${result.quarantined} mise(s) en quarantaine pour vérification`);
  if (result.failed) parts.push(`${result.failed} échec(s)`);
  return result.stopped && !result.analyzed ? stopped[result.stopped] : `${parts.join(", ")}.${result.stopped ? ` ${stopped[result.stopped]}` : ""}`;
}

export type MediaProfileState = { message?: string; ok?: boolean };
/** Profil média du client : activité, prestations, types de photos, consignes, budget IA et conservation. */
export async function saveMediaProfileAction(_state: MediaProfileState, form: FormData): Promise<MediaProfileState> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const clientId = z.uuid().safeParse(form.get("client_id"));
  if (!clientId.success) return { message: "Client invalide." };
  const result = await saveMediaProfile(userId, clientId.data, form);
  if (result.ok) revalidatePath(`/clients/${clientId.data}`);
  return result;
}

/** Actions sans sélection : synchroniser le dossier Drive de l'agent ou analyser les nouvelles photos. */
export async function mediaMaintenanceAction(_state: MediaProfileState, form: FormData): Promise<MediaProfileState> {
  await requireAdmin();
  if (await getActiveScenario()) return { message: "Indisponible en simulation." };
  const clientId = z.uuid().safeParse(form.get("client_id"));
  if (!clientId.success) return { message: "Client invalide." };
  try {
    if (form.get("intent") === "sync_drive") {
      const result = await syncDriveLibrary(clientId.data);
      revalidatePath(`/clients/${clientId.data}`);
      return result.folders ? { message: `${result.added} photo(s) ajoutée(s) depuis Drive${result.skipped ? `, ${result.skipped} ignorée(s)` : ""}.`, ok: true }
        : { message: "Aucun dossier Drive confirmé dans la configuration de l’agent Publications de ce client." };
    }
    if (form.get("intent") === "analyze_new") {
      const result = await classifyClientMedia(clientId.data, { limit: 20 });
      revalidatePath(`/clients/${clientId.data}`);
      return { message: classifyMessage(result), ok: result.analyzed > 0 };
    }
    return { message: "Action inconnue." };
  } catch {
    return { message: "Photothèque indisponible. Vérifiez la migration de la photothèque intelligente et l’accès Drive." };
  }
}

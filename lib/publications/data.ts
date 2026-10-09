import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeSupabaseReadError } from "@/lib/supabase/read-error";
import { PUBLICATION_SETTINGS_ID } from "./transitions";
import { missingMediaMessage, revisionChannelsWithoutMedia, type MediaRuleDb } from "./media-rule";
import { isPublicationUuid, validateManualPublication, validateRevision, validateReview } from "./validation";
import type { PublicationListItem, PublicationSettings, PublicationStatus, PublicationResult } from "./types";

const columns = "*,client:clients(name),project:projects(id,name)";
const unavailable = "Le stockage Publications est indisponible. Vérifiez que les migrations ont été appliquées.";
const listUnavailable = "Impossible de charger les publications. Réessayez dans quelques instants.";
const invalid = "Données de publication invalides.";
const mutationFailure = "Impossible de confirmer cette opération. Rechargez les publications avant de réessayer.";

export async function getPublicationSettings(): Promise<PublicationSettings> {
  await requireAdmin();
  return readSettings();
}

async function readSettings(): Promise<PublicationSettings> {
  try {
    const { data, error } = await getSupabaseServerClient().from("publication_settings")
      .select("id,generation_enabled,automation_enabled,publishing_enabled,emergency_stop,created_at,updated_at")
      .eq("id", PUBLICATION_SETTINGS_ID).single();
    if (error || !data) throw new Error();
    return data;
  } catch { console.error("[publications] Lecture des réglages indisponible."); throw new Error(unavailable); }
}

export async function getPublicationSettingsState(): Promise<PublicationSettings | null> {
  // Auth interruptions are outside the catch; missing storage is never an empty list.
  await requireAdmin();
  try { return await readSettings(); } catch { return null; }
}

export async function listPublications(clientId?: string, projectId?: string): Promise<PublicationListItem[]> {
  await requireAdmin();
  if (clientId !== undefined && !isPublicationUuid(clientId)) throw new Error(invalid);
  if (projectId !== undefined && !isPublicationUuid(projectId)) throw new Error(invalid);
  try {
    const results: PublicationListItem[] = [];
    for (let offset = 0; ; offset += 100) {
      let query = getSupabaseServerClient().from("publications").select(columns)
        .order("updated_at", { ascending: false }).order("id");
      if (clientId) query = query.eq("client_id", clientId);
      if (projectId) query = query.eq("project_id",projectId);
      const { data, error } = await query.range(offset, offset + 99);
      if (error) throw error;
      results.push(...(data ?? []));
      if (!data || data.length < 100) return results;
    }
  } catch (error) {
    console.error("[publications] Lecture de la liste indisponible.", safeSupabaseReadError(error));
    throw new Error(listUnavailable);
  }
}

export async function createManualPublication(input: unknown): Promise<PublicationResult<string>> {
  const { userId } = await requireAdmin();
  const valid = validateManualPublication(input);
  if (!valid) return { ok: false, message: invalid };
  try {
    const args = {
      p_client_id: valid.client_id, p_editorial_week: valid.editorial_week, p_slot: valid.slot,
      p_subject: valid.subject, p_variants: valid.variants, p_actor_id: userId,
    };
    const {data,error}= valid.project_id
      ? await getSupabaseServerClient().rpc("publication_create_project_manual",{...args,p_project_id:valid.project_id})
      : await getSupabaseServerClient().rpc("publication_create_manual",args);
    if (error || !isPublicationUuid(data)) throw new Error();
    return { ok: true, data };
  } catch { console.error("[publications] Création interne non confirmée."); return { ok: false, message: mutationFailure }; }
}

export async function setPublicationProject(publicationId:string, expectedRevisionId:string|null, projectId:string|null):Promise<PublicationResult<string|null>> {
  const {userId}=await requireAdmin();
  if (!isPublicationUuid(publicationId) || (expectedRevisionId!==null && !isPublicationUuid(expectedRevisionId)) || (projectId!==null && !isPublicationUuid(projectId))) return {ok:false,message:invalid};
  try {
    const {data,error}=await getSupabaseServerClient().rpc("publication_set_project",{p_publication_id:publicationId,p_expected_revision_id:expectedRevisionId,p_project_id:projectId,p_actor_id:userId});
    if (error) throw new Error();
    return {ok:true,data};
  } catch { console.error("[publications] Rattachement non confirmé."); return {ok:false,message:mutationFailure}; }
}

export async function reviseManualPublication(input: unknown): Promise<PublicationResult<string>> {
  const { userId } = await requireAdmin();
  const valid = validateRevision(input);
  if (!valid) return { ok: false, message: invalid };
  try {
    const { data, error } = await getSupabaseServerClient().rpc("publication_revise_manual", {
      p_publication_id: valid.publication_id, p_expected_revision_id: valid.expected_revision_id,
      p_variants: valid.variants, p_actor_id: userId,
    });
    if (error || !isPublicationUuid(data)) throw new Error();
    return { ok: true, data };
  } catch { console.error("[publications] Révision interne non confirmée."); return { ok: false, message: mutationFailure }; }
}

export async function reviewPublication(input: unknown): Promise<PublicationResult<PublicationStatus>> {
  const { userId } = await requireAdmin();
  const valid = validateReview(input);
  if (!valid) return { ok: false, message: invalid };
  try {
    if (valid.decision === "approved") {
      const missing = await revisionChannelsWithoutMedia(getSupabaseServerClient() as unknown as MediaRuleDb, valid.revision_id);
      if (missing === null) throw new Error();
      if (missing.length) return { ok: false, message: missingMediaMessage(missing) };
    }
    const { data, error } = await getSupabaseServerClient().rpc("publication_review", {
      p_publication_id: valid.publication_id, p_revision_id: valid.revision_id, p_variant_id: valid.variant_id,
      p_decision: valid.decision, p_reason: valid.reason, p_actor_id: userId,
    });
    if (error || !["pending_review", "approved", "rejected"].includes(data)) throw new Error();
    return { ok: true, data };
  } catch { console.error("[publications] Validation interne non confirmée."); return { ok: false, message: mutationFailure }; }
}

"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { savePhotoRecord } from "@/lib/photo-records/service";

export async function savePhotoRecordAction(_: MutationState, form: FormData): Promise<MutationState> {
  const clientId = String(form.get("client_id") ?? "");
  return adminMutation("photo-records", (actor) => savePhotoRecord(actor.userId, clientId, String(form.get("asset_id") ?? ""), {
    decision: form.get("decision"), intervention: form.get("intervention"), commune: form.get("commune"), month: form.get("month"),
    doneByClient: form.get("done_by_client"), publicationAllowed: form.get("publication_allowed"), note: form.get("note"),
  }), [`/clients/${clientId}`]);
}

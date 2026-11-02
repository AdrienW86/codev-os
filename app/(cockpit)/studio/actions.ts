"use server";
import { revalidatePath } from "next/cache";
import { createDraftFromVideo, deleteStudioVideo } from "@/lib/studio/videos";

export type StudioActionState = { ok?: boolean; message?: string; publicationId?: string };

export async function deleteStudioVideoAction(_state: StudioActionState, form: FormData): Promise<StudioActionState> {
  const result = await deleteStudioVideo(form.get("video_id"));
  if (result.ok) revalidatePath("/studio");
  return result;
}
export async function createVideoDraftAction(_state: StudioActionState, form: FormData): Promise<StudioActionState> {
  const result = await createDraftFromVideo(form.get("platform"), form.get("video_id"), form.get("caption"));
  if (result.ok) revalidatePath("/studio");
  return result;
}

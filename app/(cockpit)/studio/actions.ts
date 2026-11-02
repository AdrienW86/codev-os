"use server";
import { revalidatePath } from "next/cache";
import { createTikTokDraftFromVideo, deleteStudioVideo } from "@/lib/studio/videos";

export type StudioActionState = { ok?: boolean; message?: string; publicationId?: string };

export async function deleteStudioVideoAction(_state: StudioActionState, form: FormData): Promise<StudioActionState> {
  const result = await deleteStudioVideo(form.get("video_id"));
  if (result.ok) revalidatePath("/studio");
  return result;
}
export async function createTikTokDraftAction(_state: StudioActionState, form: FormData): Promise<StudioActionState> {
  const result = await createTikTokDraftFromVideo(form.get("video_id"), form.get("caption"));
  if (result.ok) revalidatePath("/studio");
  return result;
}

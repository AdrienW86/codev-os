"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { saveVideoAgent } from "@/lib/video-agent/service";

export type VideoAgentState = { ok?: boolean; message?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function saveVideoAgentAction(_state: VideoAgentState, form: FormData): Promise<VideoAgentState> {
  const { userId } = await requireAdmin();
  const clientId = form.get("client_id");
  if (typeof clientId !== "string" || !UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const result = await saveVideoAgent(userId, clientId, form);
  if (result.ok) revalidatePath(`/clients/${clientId}`);
  return result;
}

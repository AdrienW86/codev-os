"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { saveBlogAgent } from "@/lib/blog-agent/service";

export type BlogAgentState = { ok?: boolean; message?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function saveBlogAgentAction(_state: BlogAgentState, form: FormData): Promise<BlogAgentState> {
  const { userId } = await requireAdmin();
  const clientId = form.get("client_id");
  if (typeof clientId !== "string" || !UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const result = await saveBlogAgent(userId, clientId, form);
  if (result.ok) revalidatePath(`/clients/${clientId}`);
  return result;
}

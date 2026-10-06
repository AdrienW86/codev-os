"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { createAgent } from "@/lib/agents/data";
import type { AgentFormState } from "@/lib/agents/types";

export async function createAgentAction(_previousState: AgentFormState, formData: FormData): Promise<AgentFormState> {
  await requireAdmin();
  const result = await createAgent(formData);
  if (!result.ok) return result.state;
  revalidatePath("/agents");
  redirect(`/agents/${result.id}`);
}
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { createClientRecord } from "@/lib/clients/data";
import { ensureGlobalAgents } from "@/lib/services/domain";
import type { ClientFormState } from "@/lib/clients/types";

export async function createClientAction(_previousState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const { userId } = await requireAdmin();
  // Les interruptions d’authentification ne doivent jamais être absorbées.
  // La fonction de stockage refait elle aussi le contrôle d’admin.
  const result = await createClientRecord(formData);
  if (!result.ok) return result.state;
  // Agent Rapport attaché d’office ; un échec n’empêche pas la création (rattrapé par le planificateur).
  try { await ensureGlobalAgents({ kind: "admin", userId }, [result.client.id]); } catch { console.error("[services] Rattachement des agents globaux différé."); }
  revalidatePath("/clients");
  redirect(`/clients/${result.client.id}`);
}

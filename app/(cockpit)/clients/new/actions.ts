"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { createClientRecord } from "@/lib/clients/data";
import type { ClientFormState } from "@/lib/clients/types";

export async function createClientAction(_previousState: ClientFormState, formData: FormData): Promise<ClientFormState> {
  await requireAdmin();
  // Les interruptions d’authentification ne doivent jamais être absorbées.
  // La fonction de stockage refait elle aussi le contrôle d’admin.
  const result = await createClientRecord(formData);
  if (!result.ok) return result.state;
  revalidatePath("/clients");
  redirect(`/clients/${result.client.id}`);
}
